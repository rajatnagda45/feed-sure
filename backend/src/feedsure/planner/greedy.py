"""Pure deterministic route scheduling and greedy insertion."""

from __future__ import annotations

import math
import re
from typing import Any

Matrix = list[list[float | None]]


def time_to_minutes(value: str) -> int:
    """Convert a validated same-day HH:MM value to minutes after midnight."""
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{2}:[0-9]{2}", value) is None:
        raise ValueError("time must use HH:MM")
    try:
        hour, minute = (int(part) for part in value.split(":"))
    except ValueError as error:
        raise ValueError("time must use HH:MM") from error
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError("time must use HH:MM")
    return hour * 60 + minute


def minutes_to_time(value: float) -> str:
    """Format minutes after midnight, retaining seconds when travel is fractional."""
    if not math.isfinite(value) or value < 0 or value >= 24 * 60:
        raise ValueError("route time must be within one day")
    seconds = int(round(value * 60))
    hour, remainder = divmod(seconds, 3600)
    minute, second = divmod(remainder, 60)
    return f"{hour:02d}:{minute:02d}" if second == 0 else f"{hour:02d}:{minute:02d}:{second:02d}"


def route_distance(route: list[int], kilometres: Matrix) -> float:
    """Return directed route distance; unavailable legs make the route invalid."""
    total = 0.0
    for first, second in zip(route, route[1:], strict=False):
        value = kilometres[first][second]
        if value is None:
            raise ValueError("route contains an unavailable leg")
        total += value
    return total


def route_failure(
    route: list[int],
    candidates_by_index: dict[int, dict[str, Any]],
    kilometres: Matrix,
    durations: Matrix,
    *,
    capacity_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: float,
) -> str | None:
    """Return the first stable feasibility failure for a complete depot route."""
    if len(route) < 2 or route[0] != 0 or route[-1] != 0:
        raise ValueError("route must start and end at the depot")
    if len(set(route[1:-1])) != len(route[1:-1]):
        raise ValueError("route cannot contain duplicate stops")
    if any(index not in candidates_by_index for index in route[1:-1]):
        raise ValueError("route references an unknown stop")
    reserved = sum(candidates_by_index[index]["reservedLoadKg"] for index in route[1:-1])
    if reserved > capacity_kg + 1e-9:
        return "CAPACITY"

    current = float(time_to_minutes(shift_start))
    for previous, index in zip(route, route[1:-1], strict=False):
        travel = durations[previous][index]
        distance = kilometres[previous][index]
        if travel is None or distance is None:
            return "UNREACHABLE"
        candidate = candidates_by_index[index]
        arrival = current + travel
        service_start = max(arrival, float(time_to_minutes(candidate["window"]["start"])))
        service_end = service_start + service_min
        if service_end > time_to_minutes(candidate["window"]["end"]) + 1e-9:
            return "WINDOW"
        current = service_end

    return_travel = durations[route[-2]][0]
    return_distance = kilometres[route[-2]][0]
    if return_travel is None or return_distance is None:
        return "UNREACHABLE"
    if current + return_travel > time_to_minutes(shift_end) + 1e-9:
        return "SHIFT"
    return None


def evaluate_route(
    route: list[int],
    candidates_by_index: dict[int, dict[str, Any]],
    kilometres: Matrix,
    durations: Matrix,
    *,
    capacity_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: float,
) -> dict[str, Any] | None:
    """Schedule a directed depot route when capacity, windows and return shift are feasible."""
    failure = route_failure(
        route,
        candidates_by_index,
        kilometres,
        durations,
        capacity_kg=capacity_kg,
        shift_start=shift_start,
        shift_end=shift_end,
        service_min=service_min,
    )
    if failure is not None:
        return None

    start = float(time_to_minutes(shift_start))
    current = start
    waiting = 0.0
    stop_rows: list[dict[str, Any]] = []
    for previous, index in zip(route, route[1:-1], strict=False):
        candidate = candidates_by_index[index]
        travel = durations[previous][index]
        assert travel is not None
        arrival = current + travel
        service_start = max(arrival, float(time_to_minutes(candidate["window"]["start"])))
        waiting += service_start - arrival
        service_end = service_start + service_min
        stop_rows.append(
            {
                "generatorId": candidate["generatorId"],
                "name": candidate["name"],
                "address": candidate["address"],
                "lat": candidate["lat"],
                "lng": candidate["lng"],
                "window": dict(candidate["window"]),
                "submissionId": candidate["submissionId"],
                "confirmedKg": candidate["confirmedKg"],
                "weightSource": candidate["weightSource"],
                "expectedCollectionKg": present(candidate["expectedCollectionKg"]),
                "reservedLoadKg": present(candidate["reservedLoadKg"]),
                "mandatory": candidate["mandatory"],
                "arrivalAt": minutes_to_time(arrival),
                "serviceStartAt": minutes_to_time(service_start),
                "serviceEndAt": minutes_to_time(service_end),
                "simulated": candidate["simulated"],
            }
        )
        current = service_end

    return_travel = durations[route[-2]][0]
    assert return_travel is not None
    current += return_travel
    expected = sum(candidates_by_index[index]["expectedCollectionKg"] for index in route[1:-1])
    reserved = sum(candidates_by_index[index]["reservedLoadKg"] for index in route[1:-1])
    return {
        "stops": stop_rows,
        "startAt": minutes_to_time(start),
        "returnAt": minutes_to_time(current),
        "totals": {
            "expectedCollectionKg": present(expected),
            "reservedLoadKg": present(reserved),
            "totalKm": present(route_distance(route, kilometres)),
            "totalMin": present(current - start),
            "serviceMin": present(service_min * len(stop_rows)),
            "waitingMin": present(waiting),
        },
        "routeIndices": list(route),
    }


def present(value: float) -> int | float:
    """Round only a public presentation value while preserving useful precision."""
    rounded = round(float(value), 6)
    return int(rounded) if rounded.is_integer() else rounded


def marginal_distance(
    route: list[int], position: int, index: int, kilometres: Matrix
) -> float | None:
    """Return directed distance added by inserting an index at a route position."""
    previous, following = route[position - 1], route[position]
    first = kilometres[previous][index]
    second = kilometres[index][following]
    replaced = kilometres[previous][following]
    if first is None or second is None or replaced is None:
        return None
    return first + second - replaced


def insert_mandatory(
    route: list[int],
    remaining: set[int],
    candidates_by_index: dict[int, dict[str, Any]],
    kilometres: Matrix,
    durations: Matrix,
    *,
    capacity_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: float,
) -> tuple[list[int], set[int]]:
    """Insert mandatory stops before optionals using stable minimum-extra-distance choices."""
    pending = set(remaining)
    while pending:
        choices: list[tuple[float, str, int, int]] = []
        for index in pending:
            for position in range(1, len(route)):
                extra = marginal_distance(route, position, index, kilometres)
                if extra is None:
                    continue
                proposed = [*route[:position], index, *route[position:]]
                if (
                    evaluate_route(
                        proposed,
                        candidates_by_index,
                        kilometres,
                        durations,
                        capacity_kg=capacity_kg,
                        shift_start=shift_start,
                        shift_end=shift_end,
                        service_min=service_min,
                    )
                    is not None
                ):
                    choices.append(
                        (extra, str(candidates_by_index[index]["generatorId"]), position, index)
                    )
        if not choices:
            break
        _extra, _identifier, position, index = min(choices)
        route.insert(position, index)
        pending.remove(index)
    return route, pending


def classify_insertion_failure(
    route: list[int],
    index: int,
    candidates_by_index: dict[int, dict[str, Any]],
    kilometres: Matrix,
    durations: Matrix,
    *,
    capacity_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: float,
) -> str:
    """Return one honest, stable exclusion reason for an unselected eligible stop."""
    reasons = {
        route_failure(
            [*route[:position], index, *route[position:]],
            candidates_by_index,
            kilometres,
            durations,
            capacity_kg=capacity_kg,
            shift_start=shift_start,
            shift_end=shift_end,
            service_min=service_min,
        )
        for position in range(1, len(route))
    }
    if None in reasons:
        return "NOT_SELECTED_BY_HEURISTIC"
    for reason in ("CAPACITY", "WINDOW", "SHIFT"):
        if reason in reasons:
            return reason
    return "NOT_SELECTED_BY_HEURISTIC"


def build_greedy_route(
    candidates: list[dict[str, Any]],
    kilometres: Matrix,
    durations: Matrix,
    *,
    capacity_kg: float,
    target_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: float,
) -> dict[str, Any]:
    """Insert mandatory stops, then maximize remaining-target contribution per extra km."""
    by_index = {int(candidate["matrixIndex"]): candidate for candidate in candidates}
    route, unserved = insert_mandatory(
        [0, 0],
        {index for index, item in by_index.items() if item["mandatory"]},
        by_index,
        kilometres,
        durations,
        capacity_kg=capacity_kg,
        shift_start=shift_start,
        shift_end=shift_end,
        service_min=service_min,
    )
    remaining = set(by_index) - set(route[1:-1]) - unserved
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
    expected = sum(by_index[i]["expectedCollectionKg"] for i in route[1:-1])
    while remaining and expected < target_kg:
        gap = target_kg - expected
        choices: list[tuple[float, str, int, int, dict[str, Any]]] = []
        for index in remaining:
            candidate = by_index[index]
            contribution = min(candidate["expectedCollectionKg"], gap)
            for position in range(1, len(route)):
                extra = marginal_distance(route, position, index, kilometres)
                if extra is None:
                    continue
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
                if evaluated is not None:
                    score = contribution / max(extra, 0.1)
                    choices.append(
                        (-score, str(candidate["generatorId"]), position, index, evaluated)
                    )
        if not choices:
            break
        _score, _identifier, position, index, result = min(choices, key=lambda item: item[:3])
        route.insert(position, index)
        remaining.remove(index)
        expected += by_index[index]["expectedCollectionKg"]
    result["routeIndices"] = route
    result["unservedMandatoryIndices"] = sorted(unserved)
    return result
