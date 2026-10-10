"""Pure M4 forecast, usable-weight, routing, and shortfall tests."""

from __future__ import annotations

import json

import pytest
from feedsure.planner.forecast import forecast_kg
from feedsure.planner.plan import build_plan
from feedsure.planner.shortfall import explain_shortfall
from feedsure.planner.two_opt import improve_route
from feedsure.planner.usable import expected_usable_kg


def test_forecast_submission_weekday_fallback_and_empty() -> None:
    history = [
        {"date": "2026-09-23", "kg": 100},
        {"date": "2026-09-30", "kg": 120},
        {"date": "2026-10-01", "kg": 300},
    ]
    assert forecast_kg(history, {"reportedKg": 151.26}, "2026-10-07") == 151.3
    assert forecast_kg(history, None, "2026-10-07") == 110.0
    assert forecast_kg(history, None, "2026-10-09") == pytest.approx(173.3)
    assert forecast_kg([], None, "2026-10-09") == 0.0


@pytest.mark.parametrize(
    ("screening", "prior_accept", "prior_contam", "expected"),
    [
        ({"verdict": "ACCEPT", "visibleContaminantPct": 2}, 0.7, 2, 93.1),
        ({"verdict": "INSPECT", "visibleContaminantPct": 5}, 0.7, 2, 57.0),
        ({"verdict": "HOLD", "visibleContaminantPct": 8}, 0.7, 2, 0.0),
        (None, 0.7, 2, 68.6),
    ],
)
def test_usable_probability_cases(
    screening: dict[str, object] | None,
    prior_accept: float,
    prior_contam: float,
    expected: float,
) -> None:
    assert (
        expected_usable_kg(100, screening, prior_accept=prior_accept, prior_contam_pct=prior_contam)
        == expected
    )


def _params(**changes: object) -> dict[str, object]:
    values: dict[str, object] = {
        "targetKg": 150,
        "truckCapacityKg": 150,
        "shiftStart": "06:00",
        "shiftEnd": "06:10",
        "serviceMin": 1,
        "maxRadiusKm": 15,
        "stopAtTarget": False,
        "defaultPriorAccept": 0.7,
        "defaultPriorContamPct": 2,
    }
    values.update(changes)
    return values


def _generator(identifier: str, end: str, *, prior: float = 1.0) -> dict[str, object]:
    return {
        "generatorId": identifier,
        "pickupStart": "06:00",
        "pickupEnd": end,
        "priorAccept": prior,
        "priorContamPct": 0,
    }


def test_known_answer_is_unique_outward_order_and_deterministic() -> None:
    ids = ["plant", "A", "B", "C"]
    kilometres = [[float(abs(first - second)) for second in range(4)] for first in range(4)]
    durations = [[float(abs(first - second)) for second in range(4)] for first in range(4)]
    inputs = {
        "date": "2026-10-08",
        "generators": [
            _generator("C", "06:06"),
            _generator("A", "06:02"),
            _generator("B", "06:04"),
        ],
        "history": {},
        "submissions": {
            identifier: {"reportedKg": 50, "verdict": "ACCEPT", "visibleContaminantPct": 0}
            for identifier in ids[1:]
        },
        "matrix": {"pointIds": ids, "km": kilometres, "min": durations, "source": "fallback"},
        "params": _params(),
    }
    first = build_plan(inputs)
    second = build_plan(inputs)
    assert [stop["generatorId"] for stop in first["plan"]["stops"]] == ["A", "B", "C"]
    assert first["plan"]["totalKm"] == 6.0
    assert first["plan"]["loadKg"] == 150.0
    assert json.dumps(first, sort_keys=True, separators=(",", ":")) == json.dumps(
        second, sort_keys=True, separators=(",", ":")
    )


def test_two_opt_only_accepts_feasible_distance_reduction() -> None:
    candidates = {
        index: {
            "generatorId": identifier,
            "forecastKg": 10,
            "usableKg": 9,
            "verdict": "ACCEPT",
            "pickupStart": "06:00",
            "pickupEnd": "10:00",
        }
        for index, identifier in enumerate(["unused", "A", "B", "C"])
        if index
    }
    km = [
        [0, 1, 2, 3],
        [1, 0, 1, 5],
        [2, 1, 0, 1],
        [3, 5, 1, 0],
    ]
    result = improve_route(
        [0, 1, 3, 2, 0],
        candidates,
        km,
        km,
        capacity_kg=100,
        shift_start="06:00",
        shift_end="10:00",
        service_min=0,
    )
    assert result["routeIndices"] == [0, 1, 2, 3, 0]
    assert result["totalKm"] == 6.0


def test_shortfall_aggregates_and_sorts_reasons() -> None:
    result = explain_shortfall(
        100,
        20,
        [
            {"code": "capacity", "kg": 10, "generatorId": "b"},
            {"code": "held", "kg": 30, "generatorId": "z"},
            {"code": "capacity", "kg": 25, "generatorId": "a"},
            {"code": "time_window", "kg": 5, "generatorId": "c"},
            {"code": "out_of_radius", "kg": 4, "generatorId": "d"},
            {"code": "unscreened_risk", "kg": 3, "generatorId": "e"},
        ],
    )
    assert result["kg"] == 80.0
    assert [reason["code"] for reason in result["reasons"]] == [
        "capacity",
        "held",
        "time_window",
        "out_of_radius",
        "unscreened_risk",
    ]
    assert result["reasons"][0]["generatorIds"] == ["a", "b"]
    assert explain_shortfall(10, 10, result["reasons"])["reasons"] == []


def test_empty_inputs_return_empty_routes() -> None:
    result = build_plan(
        {
            "date": "2026-10-08",
            "generators": [],
            "history": {},
            "submissions": {},
            "matrix": {"pointIds": ["plant"], "km": [[0]], "min": [[0]], "source": "fallback"},
            "params": _params(),
        }
    )
    assert result["plan"]["stops"] == []
    assert result["baseline"]["stops"] == []
    assert result["shortfall"]["kg"] == 150.0
