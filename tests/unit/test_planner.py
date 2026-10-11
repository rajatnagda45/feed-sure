"""FeedSure v3 pure quantity, constraint, routing, and contract tests."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import pytest
from feedsure.planner.plan import build_plan
from feedsure.planner.two_opt import improve_route
from feedsure.planner.usable import collection_quantities

CONTRACTS = Path(__file__).parents[1] / "contracts"


def _contract(name: str) -> dict[str, object]:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def _single(
    *,
    kilograms: float = 100,
    target: float = 80,
    capacity: float = 500,
    window: tuple[str, str] = ("06:00", "09:00"),
    shift_end: str = "11:00",
    travel_min: float | None = 5,
    distance_km: float | None = 2,
    mandatory: bool = False,
) -> dict[str, object]:
    identifier = "g-a"
    return {
        "collectionDate": "2026-10-11",
        "inputRevision": 1,
        "generators": [
            {
                "generatorId": identifier,
                "name": "Synthetic A",
                "address": "Synthetic address",
                "lat": 12.69,
                "lng": 77.47,
                "supportedMaterial": True,
                "simulated": True,
                "readinessStatus": "READY",
                "unresolvedHazards": [],
                "readiness": {
                    "schemaVersion": 3,
                    "generatorId": identifier,
                    "collectionDate": "2026-10-11",
                    "status": "READY",
                    "confirmedKg": kilograms,
                    "weightSource": "SCALE",
                    "window": {"start": window[0], "end": window[1]},
                    "submissionId": "ready-a",
                },
            }
        ],
        "history": {},
        "depot": {"id": "plant", "lat": 12.681, "lng": 77.474},
        "matrix": {
            "pointIds": ["plant", identifier],
            "km": [[0, distance_km], [distance_km, 0]],
            "min": [[0, travel_min], [travel_min, 0]],
            "source": "fixture",
        },
        "params": {
            "targetKg": target,
            "truckCapacityKg": capacity,
            "capacityBuffer": 0.1,
            "readinessPrior": 0.8,
            "shiftStart": "06:00",
            "shiftEnd": shift_end,
            "serviceMin": 10,
            "maxRadiusKm": 15,
            "mandatoryIds": [identifier] if mandatory else [],
        },
        "simulated": True,
    }


def test_frozen_planner_contract_and_determinism() -> None:
    inputs = _contract("planner-input.json")
    expected = _contract("planner-result.json")
    first = build_plan(inputs)
    assert first == expected
    assert json.dumps(first, sort_keys=True) == json.dumps(build_plan(inputs), sort_keys=True)
    assert first["plan"] == first["baseline"]


def test_frozen_ineligible_mandatory_conflict_contract() -> None:
    inputs = _contract("planner-input.json")
    inputs["params"]["mandatoryIds"] = ["kitchen-d"]
    assert build_plan(inputs) == _contract("mandatory-conflict-response.json")


def test_quantities_use_ready_confirmation_not_photo_quality() -> None:
    quantities = collection_quantities(
        123.456,
        readiness_prior=0.8,
        volume_ratio=1,
        capacity_buffer=0.1,
    )
    assert quantities["expectedCollectionKg"] == pytest.approx(98.7648)
    assert quantities["reservedLoadKg"] == pytest.approx(135.8016)
    assert quantities["baseKg"] == 123.456


def test_reserved_load_blocks_nominal_truck_capacity() -> None:
    result = build_plan(_single(kilograms=2_000, target=100, capacity=2_000))
    assert result["plan"]["stops"] == []
    assert result["excluded"] == [{"generatorId": "g-a", "reason": "CAPACITY"}]
    assert result["shortfall"]["kg"] == 100


def test_service_must_finish_within_window() -> None:
    result = build_plan(_single(window=("06:00", "06:10")))
    assert result["plan"]["stops"] == []
    assert result["excluded"] == [{"generatorId": "g-a", "reason": "WINDOW"}]


def test_route_must_return_before_shift_end() -> None:
    result = build_plan(_single(travel_min=15, shift_end="06:35"))
    assert result["plan"]["stops"] == []
    assert result["excluded"] == [{"generatorId": "g-a", "reason": "SHIFT"}]


def test_mandatory_overload_is_explicit_conflict() -> None:
    result = build_plan(_single(kilograms=2_000, target=100, capacity=2_000, mandatory=True))
    assert result["status"] == "MANDATORY_CONFLICT"
    assert result["mandatoryConflicts"] == [{"generatorId": "g-a", "reason": "CAPACITY"}]
    assert result["excluded"] == [{"generatorId": "g-a", "reason": "CAPACITY"}]


def test_history_never_turns_unconfirmed_generator_ready() -> None:
    inputs = _single()
    generator = inputs["generators"][0]
    generator["readiness"] = None
    generator["readinessStatus"] = "UNCONFIRMED"
    inputs["history"] = {"g-a": [{"date": "2026-10-04", "kg": 100}]}
    result = build_plan(inputs)
    assert result["plan"]["stops"] == []
    assert result["excluded"] == [{"generatorId": "g-a", "reason": "UNCONFIRMED"}]


def test_exclusion_precedence_is_safety_first_without_double_counting() -> None:
    inputs = _single()
    generator = inputs["generators"][0]
    generator["readiness"] = None
    generator["readinessStatus"] = "UNCONFIRMED"
    generator["supportedMaterial"] = False
    generator["unresolvedHazards"] = [{"action": "ENTER", "reason": "Synthetic glass"}]
    result = build_plan(inputs)
    assert result["excluded"] == [{"generatorId": "g-a", "reason": "HAZARD_REVIEW"}]
    assert result["shortfall"]["reasons"] == ["HAZARD_REVIEW"]


def test_unreachable_directed_leg_is_not_fabricated_as_zero_cost() -> None:
    inputs = _single()
    inputs["matrix"]["km"][1][0] = None
    inputs["matrix"]["min"][1][0] = None
    result = build_plan(inputs)
    assert result["plan"]["stops"] == []
    assert result["excluded"] == [{"generatorId": "g-a", "reason": "NOT_SELECTED_BY_HEURISTIC"}]


def test_colocated_optional_tie_is_stable_by_identifier() -> None:
    inputs = _contract("planner-input.json")
    inputs["generators"] = inputs["generators"][:2]
    inputs["matrix"] = {
        "pointIds": ["plant", "hotel-a", "hostel-b"],
        "km": [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        "min": [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        "source": "fixture",
    }
    inputs["params"]["targetKg"] = 80
    result = build_plan(inputs)
    assert [stop["generatorId"] for stop in result["plan"]["stops"]] == ["hostel-b"]
    assert result["excluded"] == [{"generatorId": "hotel-a", "reason": "TARGET_REACHED"}]
    assert result["plan"]["totals"]["totalKm"] == 0


def test_two_opt_evaluates_full_directed_reversal() -> None:
    candidates = {
        index: {
            "generatorId": identifier,
            "name": identifier,
            "address": "Synthetic",
            "lat": 0.0,
            "lng": 0.0,
            "window": {"start": "06:00", "end": "10:00"},
            "submissionId": identifier,
            "confirmedKg": 1,
            "weightSource": "SCALE",
            "expectedCollectionKg": 1.0,
            "reservedLoadKg": 1.1,
            "mandatory": False,
            "simulated": True,
        }
        for index, identifier in ((1, "A"), (2, "B"), (3, "C"))
    }
    directed = [
        [0, 1, 1, 9],
        [9, 0, 1, 1],
        [1, 100, 0, 1],
        [1, 9, 9, 0],
    ]
    result = improve_route(
        [0, 1, 2, 3, 0],
        candidates,
        directed,
        directed,
        capacity_kg=10,
        shift_start="06:00",
        shift_end="10:00",
        service_min=0,
    )
    assert result["routeIndices"] == [0, 1, 2, 3, 0]
    assert result["totals"]["totalKm"] == 4


def test_empty_plan_is_explicit_and_finite() -> None:
    inputs = _contract("planner-input.json")
    inputs["generators"] = []
    inputs["history"] = {}
    inputs["matrix"] = {
        "pointIds": ["plant"],
        "km": [[0]],
        "min": [[0]],
        "source": "fixture",
    }
    inputs["params"]["mandatoryIds"] = []
    result = build_plan(inputs)
    assert result["plan"] == {
        "stops": [],
        "startAt": "06:00",
        "returnAt": "06:00",
        "totals": {
            "expectedCollectionKg": 0,
            "reservedLoadKg": 0,
            "totalKm": 0,
            "totalMin": 0,
            "serviceMin": 0,
            "waitingMin": 0,
        },
    }
    assert result["shortfall"] == {"kg": 200, "reasons": []}


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["params"].__setitem__("targetKg", math.nan),
        lambda value: value["history"].__setitem__("hotel-a", [{"date": "2026-10-11", "kg": 100}]),
        lambda value: value["matrix"]["pointIds"].reverse(),
        lambda value: value["matrix"]["km"][0].pop(),
        lambda value: value["generators"].append(copy.deepcopy(value["generators"][0])),
    ],
)
def test_malformed_inputs_raise_value_error(mutate: object) -> None:
    inputs = _contract("planner-input.json")
    mutate(inputs)
    with pytest.raises(ValueError):
        build_plan(inputs)
