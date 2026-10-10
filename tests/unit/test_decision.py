"""Exhaustive tests for the pure screening decision rules."""

from typing import Any

import pytest
from feedsure.screening.decision import HAZARD_TYPES, decide_verdict
from feedsure.screening.prompt import ALLOWED_ITEM_TYPES


def _observations(**changes: Any) -> dict[str, Any]:
    result: dict[str, Any] = {
        "items": [],
        "visible_contaminant_pct": 0.0,
        "hazard": False,
        "image_quality": "ok",
        "confidence": 0.9,
        "notes": "",
    }
    result.update(changes)
    return result


def _decide(observations: dict[str, Any], language: str = "en") -> dict[str, str]:
    return decide_verdict(
        observations,
        hold_threshold_pct=5,
        inspect_min_pct=1,
        min_confidence=0.6,
        language=language,
    )


def test_zero_observations_are_accepted() -> None:
    assert _decide(_observations()) == {
        "verdict": "ACCEPT",
        "reason": "clean",
        "instruction": "Looks clean. Ready for pickup.",
    }


@pytest.mark.parametrize("item_type", ALLOWED_ITEM_TYPES)
def test_every_contaminant_type_has_a_deterministic_verdict(item_type: str) -> None:
    observations = _observations(
        items=[{"type": item_type, "count": 1, "confidence": 0.9}],
        visible_contaminant_pct=2,
    )

    result = _decide(observations)

    assert result["verdict"] == ("HOLD" if item_type in HAZARD_TYPES else "INSPECT")
    assert result["reason"] == ("hazard" if item_type in HAZARD_TYPES else "minor_contamination")
    assert result["instruction"]


def test_multiple_contaminants_over_five_percent_are_held() -> None:
    observations = _observations(
        items=[
            {"type": "plastic_wrapper", "count": 3, "confidence": 0.9},
            {"type": "foil", "count": 2, "confidence": 0.8},
        ],
        visible_contaminant_pct=6,
    )

    result = _decide(observations)

    assert result["verdict"] == "HOLD"
    assert result["reason"] == "over_threshold"
    assert "3 plastic wrappers" in result["instruction"]
    assert "2 pieces of foil" in result["instruction"]


@pytest.mark.parametrize(
    ("percentage", "expected"),
    [(0.999, "ACCEPT"), (1, "INSPECT"), (5, "INSPECT"), (5.001, "HOLD")],
)
def test_contamination_boundaries(percentage: float, expected: str) -> None:
    assert _decide(_observations(visible_contaminant_pct=percentage))["verdict"] == expected


def test_low_overall_confidence_requires_inspection() -> None:
    result = _decide(_observations(confidence=0.59))

    assert result["verdict"] == "INSPECT"
    assert result["reason"] == "low_confidence"


@pytest.mark.parametrize("quality", ["too_dark", "blurry", "not_waste"])
def test_bad_image_quality_requires_a_retake(quality: str) -> None:
    result = _decide(_observations(image_quality=quality, hazard=True))

    assert result["verdict"] == "INSPECT"
    assert result["reason"] == "retake_photo"


def test_hazard_flag_takes_precedence_over_contamination() -> None:
    result = _decide(_observations(hazard=True, visible_contaminant_pct=0))

    assert result["verdict"] == "HOLD"
    assert result["reason"] == "hazard"


def test_screening_failed_always_returns_safe_inspect() -> None:
    result = _decide(_observations(reason="screening_failed", hazard=True))

    assert result == {
        "verdict": "INSPECT",
        "reason": "screening_failed",
        "instruction": "We couldn't check this photo. Plant staff will inspect it at pickup.",
    }


def test_hindi_path_also_returns_one_instruction() -> None:
    result = _decide(_observations(), language="hi")

    assert result["verdict"] == "ACCEPT"
    assert result["instruction"]
