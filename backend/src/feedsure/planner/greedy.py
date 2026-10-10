"""Pure deterministic greedy-insertion routing."""

from __future__ import annotations

from typing import Any


def time_to_minutes(value: str) -> int:
    """Convert an HH:MM wall-clock value to minutes after midnight."""
    hour, minute = (int(part) for part in value.split(":"))
    return hour * 60 + minute


def minutes_to_time(value: float) -> str:
    """Format route time to the nearest minute as HH:MM."""
    rounded = int(round(value))
    return f"{rounded // 60:02d}:{rounded % 60:02d}"


def route_distance(route: list[int], kilometres: list[list[float]]) -> float:
    """Return total distance for a depot-indexed route."""
    return sum(
        float(kilometres[first][second]) for first, second in zip(route, route[1:], strict=False)
    )


def evaluate_route(
    route: list[int],
    candidates_by_index: dict[int, dict[str, Any]],
    kilometres: list[list[float]],
    durations: list[list[float]],
    *,
    capacity_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: int,
) -> dict[str, Any] | None:
    """Schedule a route, returning metrics only when every constraint is feasible."""
    load = sum(float(candidates_by_index[index]["forecastKg"]) for index in route[1:-1])
    if load > capacity_kg + 1e-9:
        return None
    start = time_to_minutes(shift_start)
    end = time_to_minutes(shift_end)
    current = float(start)
    stop_rows: list[dict[str, Any]] = []
    cumulative = 0.0
    for sequence, (previous, index) in enumerate(zip(route, route[1:-1], strict=False), start=1):
        candidate = candidates_by_index[index]
        raw_arrival = current + float(durations[previous][index])
        arrival = max(raw_arrival, time_to_minutes(candidate["pickupStart"]))
        if arrival > time_to_minutes(candidate["pickupEnd"]) + 1e-9:
            return None
        departure = arrival + service_min
        cumulative += float(candidate["forecastKg"])
        stop_rows.append(
            {
                "seq": sequence,
                "generatorId": candidate["generatorId"],
                "arrive": minutes_to_time(arrival),
                "depart": minutes_to_time(departure),
                "forecastKg": round(float(candidate["forecastKg"]), 1),
                "usableKg": round(float(candidate["usableKg"]), 1),
                "verdict": candidate["verdict"],
                "cumLoadKg": round(cumulative, 1),
            }
        )
        current = departure
    if len(route) > 1:
        current += float(durations[route[-2]][0])
    if current > end + 1e-9:
        return None
    usable = sum(float(candidates_by_index[index]["usableKg"]) for index in route[1:-1])
    total_km = route_distance(route, kilometres)
    return {
        "stops": stop_rows,
        "totalKm": round(total_km, 1),
        "totalMin": int(round(current - start)),
        "loadKg": round(load, 1),
        "usableKg": round(usable, 1),
        "usableKgPerKm": round(usable / total_km, 1) if total_km else 0.0,
        "wastedStops": sum(
            candidate["verdict"] == "HOLD"
            for candidate in (candidates_by_index[index] for index in route[1:-1])
        ),
        "geometry": None,
        "routeIndices": route,
    }


def build_greedy_route(
    candidates: list[dict[str, Any]],
    kilometres: list[list[float]],
    durations: list[list[float]],
    *,
    capacity_kg: float,
    target_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: int,
    stop_at_target: bool = False,
) -> dict[str, Any]:
    """Build a feasible route by expected-usable-kg per incremental kilometre."""
    by_index = {int(candidate["matrixIndex"]): candidate for candidate in candidates}
    route = [0, 0]
    remaining = set(by_index)
    result = evaluate_route(
        route,
        by_index,
        kilometres,
        durations,
        capacity_kg=capacity_kg,
        shift_start=shift_start,
        shift_end=shift_end,
        service_min=service_min,
    )
    assert result is not None
    while remaining and not (stop_at_target and result["usableKg"] >= target_kg):
        choices: list[tuple[float, str, int, int, dict[str, Any]]] = []
        for index in remaining:
            candidate = by_index[index]
            for position in range(1, len(route)):
                proposed = [*route[:position], index, *route[position:]]
                evaluated = evaluate_route(
                    proposed,
                    by_index,
                    kilometres,
                    durations,
                    capacity_kg=capacity_kg,
                    shift_start=shift_start,
                    shift_end=shift_end,
                    service_min=service_min,
                )
                if evaluated is None:
                    continue
                previous, following = route[position - 1], route[position]
                extra = (
                    float(kilometres[previous][index])
                    + float(kilometres[index][following])
                    - float(kilometres[previous][following])
                )
                score = float(candidate["usableKg"]) / max(extra, 0.1)
                choices.append((-score, str(candidate["generatorId"]), position, index, evaluated))
        if not choices:
            break
        _score, _identifier, position, index, result = min(choices, key=lambda item: item[:3])
        route.insert(position, index)
        remaining.remove(index)
    result["routeIndices"] = route
    return result
