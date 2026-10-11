"""Hand-calculated boundaries and shared-policy invariants beyond contract snapshots."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from eval_routes import evaluate, scenario_input
from feedsure.planner.forecast import forecast_kg
from feedsure.planner.greedy import evaluate_route, time_to_minutes
from feedsure.planner.plan import build_plan
from feedsure.planner.shortfall import explain_shortfall
from feedsure.planner.two_opt import improve_route
from feedsure.planner.usable import collection_quantities

ROOT = Path(__file__).parents[2]


def single(**params: Any) -> dict[str, Any]:
    """Build a valid one-stop synthetic snapshot."""
    return scenario_input(
        {
            "generators": [{"generatorId": "a", "confirmedKg": 100}],
            "params": {"targetKg": 80, **params},
            "km": [[0, 2], [2, 0]],
            "min": [[0, 5], [5, 0]],
        }
    )


def ids(result: dict[str, Any], key: str = "plan") -> list[str]:
    """Read route IDs for behaviour assertions."""
    return [stop["generatorId"] for stop in result[key]["stops"]]


def test_saved_scenarios_are_deterministic_and_validate_both_routes() -> None:
    data = evaluate(ROOT / "eval" / "route-scenarios")
    assert data["scenarioCount"] >= 13
    assert data == evaluate(ROOT / "eval" / "route-scenarios")
    assert data["mandatoryConflictScenarios"] >= 1
    assert data["summary"]["TIE"] > 0
    # A larger baseline load must remain in the report; no expected kg is called actual.
    tradeoff = next(r for r in data["results"] if r["scenarioId"] == "primary-capacity-tradeoff")
    assert tradeoff["primary"]["expectedCollectionKg"] == 176
    assert tradeoff["baseline"]["expectedCollectionKg"] == 240
    assert tradeoff["shortfallKg"] == 64
    assert tradeoff["baseline"]["shortfallKg"] == 0
    colocated = next(r for r in data["results"] if r["scenarioId"] == "co-located-stops")
    assert colocated["primary"]["expectedKgPerKm"] is None


def test_target_uses_unrounded_quantities() -> None:
    spec = json.loads((ROOT / "tests/fixtures/planner_v3/precision.json").read_text())
    result = build_plan(scenario_input(spec))
    assert set(ids(result)) == {"a", "b"}
    assert set(ids(result, "baseline")) == {"a", "b"}
    spec["params"]["targetKg"] = 0.4000006
    result = build_plan(scenario_input(spec))
    assert ids(result) == ["a"]
    assert ids(result, "baseline") == ["a"]


def test_wait_service_and_return_equal_boundaries_are_allowed() -> None:
    value = single(shiftEnd="06:35")
    value["generators"][0]["readiness"]["window"] = {"start": "06:20", "end": "06:30"}
    result = build_plan(value)
    stop = result["plan"]["stops"][0]
    assert (stop["arrivalAt"], stop["serviceStartAt"], stop["serviceEndAt"]) == (
        "06:05",
        "06:20",
        "06:30",
    )
    assert result["plan"]["returnAt"] == "06:35"
    assert result["plan"]["totals"]["waitingMin"] == 15
    assert result["plan"]["totals"]["totalMin"] == 35
    assert result["plan"] == result["baseline"]


def test_fractional_travel_keeps_seconds() -> None:
    value = single()
    value["matrix"]["min"] = [[0, 0.5], [0.75, 0]]
    result = build_plan(value)
    assert result["plan"]["stops"][0]["arrivalAt"] == "06:00:30"
    assert result["plan"]["returnAt"] == "06:11:15"
    assert result["plan"]["totals"]["totalMin"] == 11.25


@pytest.mark.parametrize("capacity, selected", [(110, True), (109.99, False)])
def test_capacity_equal_boundary(capacity: float, selected: bool) -> None:
    result = build_plan(single(truckCapacityKg=capacity))
    assert bool(ids(result)) == selected
    assert bool(ids(result, "baseline")) == selected


def test_mandatory_processed_even_for_zero_target() -> None:
    result = build_plan(single(targetKg=0, mandatoryIds=["a"]))
    assert ids(result) == ids(result, "baseline") == ["a"]
    assert result["plan"]["stops"][0]["mandatory"] is True


@pytest.mark.parametrize("change", ["stale", "legacy", "absent"])
def test_old_or_missing_readiness_cannot_authorise_collection(change: str) -> None:
    value = single()
    ready = value["generators"][0]["readiness"]
    if change == "stale":
        ready["collectionDate"] = "2026-10-10"
    elif change == "legacy":
        ready["schemaVersion"] = 1
        ready["verdict"] = "ACCEPT"
    else:
        value["generators"][0]["readiness"] = None
    result = build_plan(value)
    assert ids(result) == ids(result, "baseline") == []
    assert result["excluded"][0]["reason"] == "UNCONFIRMED"


def test_radius_uses_outbound_distance_and_preserves_return_direction() -> None:
    value = single(maxRadiusKm=2)
    value["matrix"]["km"][1][0] = 20
    result = build_plan(value)
    assert ids(result) == ["a"]
    assert result["plan"]["totals"]["totalKm"] == 22
    value["matrix"]["km"][0][1] = 2.001
    result = build_plan(value)
    assert result["excluded"] == [{"generatorId": "a", "reason": "OUT_OF_RADIUS"}]


def test_quantity_ratio_reserves_maximum_full_load() -> None:
    below = collection_quantities(100, readiness_prior=0.8, capacity_buffer=0.1, volume_ratio=0.5)
    above = collection_quantities(100, readiness_prior=0.8, capacity_buffer=0.1, volume_ratio=1.5)
    assert below["reservedLoadKg"] == pytest.approx(110)
    assert above["reservedLoadKg"] == pytest.approx(165)


def test_shortfall_codes_are_context_not_summed_hypothetical_losses() -> None:
    result = explain_shortfall(
        100,
        20,
        [
            {"generatorId": "a", "reason": "CAPACITY"},
            {"generatorId": "b", "reason": "CAPACITY"},
            {"generatorId": "c", "reason": "WINDOW"},
        ],
    )
    assert result == {"kg": 80, "reasons": ["CAPACITY", "WINDOW"]}
    assert explain_shortfall(100, 101, [{"reason": "CAPACITY"}]) == {"kg": 0, "reasons": []}


@pytest.mark.parametrize(
    "field,bad",
    [
        ("targetKg", True),
        ("truckCapacityKg", float("inf")),
        ("capacityBuffer", -0.01),
        ("readinessPrior", 1.01),
        ("serviceMin", -1),
        ("shiftStart", "+1:00"),
        ("shiftEnd", "06:00"),
        ("mandatoryIds", ["missing"]),
        ("mandatoryIds", ["a", "a"]),
    ],
)
def test_invalid_params_fail_clearly(field: str, bad: Any) -> None:
    value = single()
    value["params"][field] = bad
    with pytest.raises(ValueError):
        build_plan(value)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda v: v["generators"][0].__setitem__("readinessStatus", []),
        lambda v: v["generators"][0]["readiness"].__setitem__("weightSource", {}),
        lambda v: v["generators"][0]["readiness"].__setitem__("confirmedKg", 0),
        lambda v: v["generators"][0].__setitem__("lat", float("nan")),
        lambda v: v["matrix"].__setitem__("source", []),
        lambda v: v["matrix"]["km"][0].__setitem__(0, False),
        lambda v: v["matrix"]["km"][0].__setitem__(1, -1),
        lambda v: v.__setitem__("inputRevision", True),
    ],
)
def test_malformed_shapes_raise_value_error(mutate: Any) -> None:
    value = single()
    mutate(value)
    with pytest.raises(ValueError):
        build_plan(value)


def test_input_permutation_preserves_id_mapping_and_no_mutation() -> None:
    value = json.loads((ROOT / "tests/contracts/planner-input.json").read_text())
    original = copy.deepcopy(value)
    first = build_plan(value)
    assert value == original
    value["generators"].reverse()
    perm = [0, 2, 1, 4, 3]
    matrix = value["matrix"]
    matrix["pointIds"] = [matrix["pointIds"][i] for i in perm]
    for field in ("km", "min"):
        matrix[field] = [[matrix[field][i][j] for j in perm] for i in perm]
    assert build_plan(value) == first


def test_2opt_shortens_and_preserves_windows_when_reversal_unavailable() -> None:
    candidates = {
        i: {
            "generatorId": str(i),
            "name": str(i),
            "address": "Synthetic",
            "lat": 0,
            "lng": 0,
            "window": {"start": "06:00", "end": "10:00"},
            "submissionId": str(i),
            "confirmedKg": 1,
            "weightSource": "SCALE",
            "expectedCollectionKg": 0.8,
            "reservedLoadKg": 1.1,
            "mandatory": False,
            "simulated": True,
        }
        for i in (1, 2, 3)
    }
    km = [[0, 1, 2, 3], [1, 0, 1, 5], [2, 1, 0, 1], [3, 5, 1, 0]]
    options = dict(capacity_kg=10, shift_start="06:00", shift_end="10:00", service_min=0)
    before = evaluate_route([0, 1, 3, 2, 0], candidates, km, km, **options)
    after = improve_route([0, 1, 3, 2, 0], candidates, km, km, **options)
    assert after["totals"]["totalKm"] == 6
    assert after["totals"]["totalKm"] < before["totals"]["totalKm"]
    assert set(after["routeIndices"][1:-1]) == {1, 2, 3}
    km[1][2] = None
    after = improve_route([0, 1, 3, 2, 0], candidates, km, km, **options)
    assert after["totals"]["totalKm"] <= before["totals"]["totalKm"]
    # Constraint checker also rejects a duplicate served stop, rather than double-counting.
    with pytest.raises(ValueError, match="duplicate"):
        evaluate_route([0, 1, 1, 0], candidates, km, km, **options)


@pytest.mark.parametrize("value", ["+1:00", "01: 1", "6:00", "24:00", "06:60"])
def test_clock_requires_canonical_same_day_time(value: str) -> None:
    with pytest.raises(ValueError):
        time_to_minutes(value)


def test_legacy_forecast_guidance_excludes_future_history() -> None:
    history = [
        {"date": "2026-10-04", "kg": 100},
        {"date": "2026-10-11", "kg": 999},
        {"date": "2026-10-18", "kg": 999},
    ]
    assert forecast_kg(history, None, "2026-10-11") == 100
    assert forecast_kg(history[1:], None, "2026-10-11") == 0


def test_hazard_reason_outranks_other_eligibility_causes_without_double_counting() -> None:
    value = single(mandatoryIds=["a"])
    generator = value["generators"][0]
    generator.update(
        readiness=None,
        readinessStatus="UNCONFIRMED",
        supportedMaterial=False,
        unresolvedHazards=[{"reason": "Glass"}],
    )
    result = build_plan(value)
    assert result["status"] == "MANDATORY_CONFLICT"
    assert result["excluded"] == [{"generatorId": "a", "reason": "HAZARD_REVIEW"}]
    assert result["shortfall"]["reasons"] == ["HAZARD_REVIEW"]
