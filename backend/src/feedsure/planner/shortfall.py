"""Pure target gap calculation without counterfactual mass attribution."""

from __future__ import annotations

from typing import Any

from feedsure.planner.greedy import present
from feedsure.planner.validation import number

REASON_CODES = (
    "NOT_READY",
    "UNCONFIRMED",
    "HAZARD_REVIEW",
    "UNSUPPORTED_MATERIAL",
    "OUT_OF_RADIUS",
    "CAPACITY",
    "WINDOW",
    "SHIFT",
    "MANDATORY_CONFLICT",
    "TARGET_REACHED",
    "NOT_SELECTED_BY_HEURISTIC",
)


def explain_shortfall(
    target_kg: float,
    expected_kg: float,
    exclusions: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Return the exact target gap and unique contextual codes, never summed losses."""
    gap = max(0.0, number(target_kg, "targetKg") - number(expected_kg, "expectedKg"))
    codes = {item["reason"] for item in exclusions or []}
    if codes - set(REASON_CODES):
        raise ValueError("unknown exclusion reason")
    return {"kg": present(gap), "reasons": [code for code in REASON_CODES if gap and code in codes]}
