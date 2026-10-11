"""Independent arithmetic checks over fixed-seed synthetic directed route inputs."""

from __future__ import annotations

import copy
import random
from typing import Any

import pytest
from eval_routes import scenario_input
from feedsure.planner.plan import build_plan


def clock(value: str) -> float:
    """Read published route times without importing the production scheduler."""
    parts = [int(part) for part in value.split(":")]
    return parts[0] * 60 + parts[1] + (parts[2] / 60 if len(parts) == 3 else 0)


@pytest.mark.parametrize("seed", range(32))
def test_independent_directed_schedule_capacity_and_shared_policy(seed: int) -> None:
    """Check both algorithms against input arithmetic, including unavailable return legs."""
    rng = random.Random(seed)
    generators = [
        {
            "generatorId": f"k{index}",
            "confirmedKg": rng.randint(10, 350),
            "status": rng.choice(["READY", "READY", "READY", "NOT_READY", "UNCONFIRMED"]),
            "hazard": rng.random() < 0.15,
            "supportedMaterial": rng.random() >= 0.1,
            "window": {"start": rng.choice(["06:00", "06:30"]), "end": "08:00"},
        }
        for index in range(7)
    ]
    km: list[list[float | None]] = [[0.0] * 8 for _ in range(8)]
    minutes: list[list[float | None]] = [[0.0] * 8 for _ in range(8)]
    for first in range(8):
        for second in range(8):
            if first != second:
                km[first][second] = rng.randint(0, 200) / 10
                minutes[first][second] = rng.randint(0, 150) / 2
                if rng.random() < 0.1:
                    km[first][second] = minutes[first][second] = None
    inputs = scenario_input(
        {
            "generators": generators,
            "km": km,
            "min": minutes,
            "params": {
                "targetKg": rng.choice([0, 150, 500, 1200]),
                "truckCapacityKg": 700,
                "shiftEnd": "08:30",
                "mandatoryIds": ["k0"] if seed % 3 == 0 else [],
            },
        }
    )
    frozen = copy.deepcopy(inputs)
    result = build_plan(inputs)
    assert inputs == frozen
    assert result == build_plan(inputs)
    reordered = copy.deepcopy(inputs)
    reordered["generators"].reverse()
    assert result == build_plan(reordered)
    params = inputs["params"]
    by_id = {generator["generatorId"]: generator for generator in inputs["generators"]}
    for route_name in ("plan", "baseline"):
        route = result[route_name]
        ids = [stop["generatorId"] for stop in route["stops"]]
        assert len(ids) == len(set(ids))
        if result["status"] == "FEASIBLE":
            assert set(params["mandatoryIds"]) <= set(ids)
        current = clock(params["shiftStart"])
        previous = 0
        total_km = waiting = confirmed = 0.0
        for stop in route["stops"]:
            generator: dict[str, Any] = by_id[stop["generatorId"]]
            assert generator["readinessStatus"] == "READY"
            assert generator["supportedMaterial"] and not generator["unresolvedHazards"]
            index = inputs["matrix"]["pointIds"].index(stop["generatorId"])
            assert km[0][index] is None or km[0][index] <= params["maxRadiusKm"]
            distance, travel = km[previous][index], minutes[previous][index]
            assert distance is not None and travel is not None
            arrival = current + travel
            start = max(arrival, clock(stop["window"]["start"]))
            current = start + params["serviceMin"]
            assert clock(stop["arrivalAt"]) == pytest.approx(arrival)
            assert clock(stop["serviceStartAt"]) == pytest.approx(start)
            assert clock(stop["serviceEndAt"]) == pytest.approx(current)
            assert current <= clock(stop["window"]["end"])
            waiting += start - arrival
            total_km += distance
            confirmed += generator["readiness"]["confirmedKg"]
            previous = index
        distance, travel = km[previous][0], minutes[previous][0]
        assert distance is not None and travel is not None
        current += travel
        total_km += distance
        assert current <= clock(params["shiftEnd"])
        assert clock(route["returnAt"]) == pytest.approx(current)
        assert route["totals"]["totalKm"] == pytest.approx(total_km)
        assert route["totals"]["totalMin"] == pytest.approx(current - clock(params["shiftStart"]))
        assert route["totals"]["waitingMin"] == pytest.approx(waiting)
        assert route["totals"]["expectedCollectionKg"] == pytest.approx(confirmed * 0.8)
        assert route["totals"]["reservedLoadKg"] == pytest.approx(confirmed * 1.1)
        assert confirmed * 1.1 <= params["truckCapacityKg"] + 1e-9
    assert result["shortfall"]["kg"] == pytest.approx(
        max(0, params["targetKg"] - result["plan"]["totals"]["expectedCollectionKg"])
    )
