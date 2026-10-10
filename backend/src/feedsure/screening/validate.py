"""Pure validation and normalization of screening-model observations."""

from __future__ import annotations

import json
from math import isfinite
from typing import Any

from feedsure.common.errors import ScreeningInvalid
from feedsure.screening.prompt import ALLOWED_ITEM_TYPES, IMAGE_QUALITIES


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ScreeningInvalid(f"{field} must be a number")
    number = float(value)
    if not isfinite(number):
        raise ScreeningInvalid(f"{field} must be finite")
    return number


def _json_object(raw_text: str) -> dict[str, Any]:
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise ScreeningInvalid("model output is empty")
    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start < 0 or end < start:
        raise ScreeningInvalid("model output does not contain a JSON object")
    try:
        parsed = json.loads(raw_text[start : end + 1])
    except json.JSONDecodeError as error:
        raise ScreeningInvalid("model output contains malformed JSON") from error
    if not isinstance(parsed, dict):
        raise ScreeningInvalid("model output must be a JSON object")
    return parsed


def validate_observations(raw_text: str) -> dict[str, Any]:
    """Return normalized observations or raise ``ScreeningInvalid``."""
    parsed = _json_object(raw_text)
    required = {
        "items",
        "visible_contaminant_pct",
        "hazard",
        "image_quality",
        "confidence",
        "notes",
    }
    missing = sorted(required.difference(parsed))
    if missing:
        raise ScreeningInvalid(f"missing required fields: {', '.join(missing)}")
    if not isinstance(parsed["items"], list):
        raise ScreeningInvalid("items must be a list")

    items: list[dict[str, Any]] = []
    for index, item in enumerate(parsed["items"]):
        if not isinstance(item, dict):
            raise ScreeningInvalid(f"items[{index}] must be an object")
        item_type = item.get("type")
        count = item.get("count")
        if not isinstance(item_type, str):
            raise ScreeningInvalid(f"items[{index}].type must be a string")
        if isinstance(count, bool) or not isinstance(count, int) or count < 1:
            raise ScreeningInvalid(f"items[{index}].count must be an integer >= 1")
        confidence = _number(item.get("confidence"), f"items[{index}].confidence")
        items.append(
            {
                "type": item_type if item_type in ALLOWED_ITEM_TYPES else "other_non_food",
                "count": count,
                "confidence": min(1.0, max(0.0, confidence)),
            }
        )

    hazard = parsed["hazard"]
    image_quality = parsed["image_quality"]
    notes = parsed["notes"]
    if not isinstance(hazard, bool):
        raise ScreeningInvalid("hazard must be a boolean")
    if image_quality not in IMAGE_QUALITIES:
        raise ScreeningInvalid("image_quality is invalid")
    if not isinstance(notes, str):
        raise ScreeningInvalid("notes must be a string")

    contaminant_pct = _number(parsed["visible_contaminant_pct"], "visible_contaminant_pct")
    confidence = _number(parsed["confidence"], "confidence")
    return {
        "items": items,
        "visible_contaminant_pct": min(100.0, max(0.0, contaminant_pct)),
        "hazard": hazard,
        "image_quality": image_quality,
        "confidence": min(1.0, max(0.0, confidence)),
        "notes": notes.strip()[:500],
    }
