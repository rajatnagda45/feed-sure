"""Pure v3 pickup-to-gate reconciliation tests."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import pytest
from feedsure.planner.reconcile import reconcile_trip

CONTRACTS = Path(__file__).parents[1] / "contracts"


def _contract(name: str) -> dict[str, object]:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def _pickup(
    identifier: str,
    kilograms: float,
    *,
    source: str = "SCALE",
    gps: str = "UNKNOWN",
) -> dict[str, object]:
    return {
        "generatorId": identifier,
        "outcome": "COLLECTED",
        "kg": kilograms,
        "weightSource": source,
        "gpsStatus": gps,
    }


def _inputs(
    pickup_kg: float = 100,
    gate_kg: float | None = 100,
) -> dict[str, object]:
    return {
        "stops": [{"generatorId": "g-a", "pickup": _pickup("g-a", pickup_kg)}],
        "gate": (None if gate_kg is None else {"netKg": gate_kg, "weightSource": "SCALE"}),
        "absoluteToleranceKg": 20,
        "percentageTolerancePct": 5,
    }


def test_frozen_reconciliation_contract() -> None:
    assert reconcile_trip(_contract("reconciliation-input.json")) == _contract(
        "reconciliation-result.json"
    )


def test_pending_gate_precedes_pending_stop() -> None:
    inputs = {"stops": [{"generatorId": "g-a", "pickup": None}], "gate": None}
    result = reconcile_trip(inputs)
    assert result["status"] == "PENDING_GATE"
    assert result["pendingStopIds"] == ["g-a"]
    assert result["deltaKg"] is None


def test_gate_with_unresolved_stop_is_incomplete() -> None:
    inputs = {
        "stops": [{"generatorId": "g-a", "pickup": None}],
        "gate": {"netKg": 20, "weightSource": "SCALE"},
    }
    assert reconcile_trip(inputs)["status"] == "INCOMPLETE"


@pytest.mark.parametrize(
    ("pickup_kg", "gate_kg", "expected"),
    [(0, 10, "UNMATCHED_INTAKE"), (0, 0, "NO_LOAD")],
)
def test_zero_pickup_states(pickup_kg: float, gate_kg: float, expected: str) -> None:
    inputs = {
        "stops": [
            {
                "generatorId": "g-a",
                "pickup": {
                    "generatorId": "g-a",
                    "outcome": "SKIPPED",
                    "reason": "Vehicle issue",
                    "kg": pickup_kg,
                    "weightSource": None,
                    "gpsStatus": "UNKNOWN",
                },
            }
        ],
        "gate": {"netKg": gate_kg, "weightSource": "SCALE"},
    }
    result = reconcile_trip(inputs)
    assert result["status"] == expected
    assert result["deltaPct"] is None


def test_equality_at_max_tolerance_stays_within() -> None:
    assert reconcile_trip(_inputs(100, 120))["status"] == "WITHIN_TOLERANCE"
    assert reconcile_trip(_inputs(100, 120.0001))["status"] == "REVIEW"
    assert reconcile_trip(_inputs(1_000, 1_050))["status"] == "WITHIN_TOLERANCE"
    assert reconcile_trip(_inputs(1_000, 1_050.1))["status"] == "REVIEW"


def test_gain_is_reviewed_and_gps_remains_independent() -> None:
    inputs = _inputs(100, 140)
    inputs["stops"][0]["pickup"]["gpsStatus"] = "OUT_OF_RANGE"
    result = reconcile_trip(inputs)
    assert result["status"] == "REVIEW"
    assert result["deltaKg"] == 40
    assert result["gpsFlags"] == [{"generatorId": "g-a", "status": "OUT_OF_RANGE"}]


def test_estimates_make_reconciliation_provisional() -> None:
    inputs = _inputs()
    inputs["stops"][0]["pickup"]["weightSource"] = "ESTIMATE"
    assert reconcile_trip(inputs)["provisional"] is True
    inputs["stops"][0]["pickup"]["weightSource"] = "SCALE"
    inputs["gate"]["weightSource"] = "ESTIMATE"
    assert reconcile_trip(inputs)["provisional"] is True


@pytest.mark.parametrize(
    "inputs",
    [
        {
            "stops": [
                {"generatorId": "x", "pickup": _pickup("x", 1)},
                {"generatorId": "x", "pickup": _pickup("x", 1)},
            ],
            "gate": None,
        },
        {
            "stops": [{"generatorId": "x", "pickup": _pickup("x", -1)}],
            "gate": None,
        },
        {
            "stops": [{"generatorId": "x", "pickup": _pickup("x", math.nan)}],
            "gate": None,
        },
        {
            "stops": [
                {
                    "generatorId": "x",
                    "pickup": {
                        **_pickup("x", 1),
                        "outcome": "UNKNOWN",
                    },
                }
            ],
            "gate": None,
        },
    ],
)
def test_bad_reconciliation_inputs_raise(inputs: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        reconcile_trip(inputs)


def test_partial_is_resolved_and_current_correction_is_counted_once() -> None:
    inputs = _contract("reconciliation-input.json")
    original = copy.deepcopy(inputs)
    result = reconcile_trip(inputs)
    assert inputs == original
    assert result["pendingStopIds"] == []
    inputs["stops"][0]["pickup"].update(kg=90, revision=2)
    corrected = reconcile_trip(inputs)
    assert corrected["pickedKg"] == 240
    assert corrected["deltaKg"] == 0


def test_gps_review_survives_matching_weights_and_unknown_is_visible() -> None:
    inputs = _inputs()
    inputs["stops"][0]["pickup"]["gpsStatus"] = "OUT_OF_RANGE"
    result = reconcile_trip(inputs)
    assert result["status"] == "WITHIN_TOLERANCE"
    assert result["gpsFlags"][0]["status"] == "OUT_OF_RANGE"
    del inputs["stops"][0]["pickup"]["gpsStatus"]
    assert reconcile_trip(inputs)["gpsFlags"][0]["status"] == "UNKNOWN"


def test_loss_thresholds_and_custom_tolerance() -> None:
    assert reconcile_trip(_inputs(100, 80))["status"] == "WITHIN_TOLERANCE"
    assert reconcile_trip(_inputs(100, 79.999))["status"] == "REVIEW"
    inputs = _inputs(100, 95)
    inputs.update(absoluteToleranceKg=0, percentageTolerancePct=5)
    assert reconcile_trip(inputs)["status"] == "WITHIN_TOLERANCE"
    inputs["gate"]["netKg"] = 94.999
    assert reconcile_trip(inputs)["status"] == "REVIEW"


def test_gross_tare_validation_keeps_net_comparison() -> None:
    inputs = _inputs()
    inputs["gate"].update(grossKg=1100, tareKg=1000)
    assert reconcile_trip(inputs)["netGateKg"] == 100
    inputs["gate"]["netKg"] = 1100
    with pytest.raises(ValueError, match="netKg"):
        reconcile_trip(inputs)


@pytest.mark.parametrize(
    "field,bad",
    [
        ("kg", True),
        ("kg", float("inf")),
        ("kg", 5001),
        ("weightSource", []),
        ("gpsStatus", "PASSED"),
        ("gpsStatus", {}),
        ("remainingUnknown", 1),
        ("outcome", []),
    ],
)
def test_invalid_pickup_fields_raise_value_error(field: str, bad: object) -> None:
    inputs = _inputs()
    inputs["stops"][0]["pickup"][field] = bad
    with pytest.raises(ValueError):
        reconcile_trip(inputs)


@pytest.mark.parametrize(
    "field,bad",
    [
        ("netKg", -1),
        ("netKg", float("nan")),
        ("netKg", True),
        ("weightSource", {}),
        ("grossKg", -1),
        ("tareKg", 10),
    ],
)
def test_invalid_gate_fields_raise_value_error(field: str, bad: object) -> None:
    inputs = _inputs()
    inputs["gate"][field] = bad
    with pytest.raises(ValueError):
        reconcile_trip(inputs)


@pytest.mark.parametrize(
    "remaining,unknown,valid",
    [
        (None, True, True),
        (10, False, True),
        (None, False, False),
        (0, False, False),
        (10, True, False),
        (-1, False, False),
    ],
)
def test_partial_remaining_preconditions(
    remaining: float | None,
    unknown: bool,
    valid: bool,
) -> None:
    inputs = _inputs()
    inputs["stops"][0]["pickup"].update(
        outcome="PARTIAL",
        reason="Truck limited",
        remainingKg=remaining,
        remainingUnknown=unknown,
    )
    if valid:
        assert reconcile_trip(inputs)["status"] == "WITHIN_TOLERANCE"
    else:
        with pytest.raises(ValueError):
            reconcile_trip(inputs)
