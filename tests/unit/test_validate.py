"""Pure schema-validation tests using hand-written model-response fixtures."""

import pytest
from feedsure.common.errors import ScreeningInvalid
from feedsure.screening.mock import load_fixture
from feedsure.screening.validate import validate_observations


def test_valid_fixture_is_normalized() -> None:
    observations = validate_observations(load_fixture("plastic"))

    assert observations == {
        "items": [{"type": "plastic_wrapper", "count": 3, "confidence": 0.91}],
        "visible_contaminant_pct": 8.0,
        "hazard": False,
        "image_quality": "ok",
        "confidence": 0.86,
        "notes": "Several plastic wrappers are visible across the top and tray views.",
    }


def test_json_can_be_extracted_and_values_are_safely_normalized() -> None:
    raw = """Model response:
    {"items":[{"type":"unknown_object","count":1,"confidence":1.4}],
    "visible_contaminant_pct":-4,"hazard":false,"image_quality":"ok",
    "confidence":2,"notes":" visible object "}
    end"""

    observations = validate_observations(raw)

    assert observations["items"] == [
        {"type": "other_non_food", "count": 1, "confidence": 1.0}
    ]
    assert observations["visible_contaminant_pct"] == 0
    assert observations["confidence"] == 1
    assert observations["notes"] == "visible object"


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "empty"),
        (load_fixture("malformed"), "malformed JSON"),
        ('{"items":[]}', "missing required fields"),
        (
            '{"items":"none","visible_contaminant_pct":0,"hazard":false,'
            '"image_quality":"ok","confidence":1,"notes":"clean"}',
            "items must be a list",
        ),
        (
            '{"items":[],"visible_contaminant_pct":"zero","hazard":false,'
            '"image_quality":"ok","confidence":1,"notes":"clean"}',
            "visible_contaminant_pct must be a number",
        ),
        (
            '{"items":[],"visible_contaminant_pct":0,"hazard":"false",'
            '"image_quality":"ok","confidence":1,"notes":"clean"}',
            "hazard must be a boolean",
        ),
        (
            '{"items":[],"visible_contaminant_pct":0,"hazard":false,'
            '"image_quality":"great","confidence":1,"notes":"clean"}',
            "image_quality is invalid",
        ),
    ],
)
def test_invalid_outputs_raise_clear_validation_failure(raw: str, message: str) -> None:
    with pytest.raises(ScreeningInvalid, match=message):
        validate_observations(raw)
