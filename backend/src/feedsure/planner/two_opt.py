"""Pure deterministic, feasibility-preserving directed 2-opt improvement."""

from __future__ import annotations

from typing import Any

from feedsure.planner.greedy import Matrix, evaluate_route, route_distance


def improve_route(
    route: list[int],
    candidates_by_index: dict[int, dict[str, Any]],
    kilometres: Matrix,
    durations: Matrix,
    *,
    capacity_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: float,
) -> dict[str, Any]:
    """Apply only feasible full-route distance reductions, including directed reversed edges."""
    current = evaluate_route(
        route,
        candidates_by_index,
        kilometres,
        durations,
        capacity_kg=capacity_kg,
        shift_start=shift_start,
        shift_end=shift_end,
        service_min=service_min,
    )
    if current is None:
        raise ValueError("2-opt requires a feasible starting route")
    while True:
        current_distance = route_distance(route, kilometres)
        improvements: list[tuple[float, tuple[str, ...], list[int], dict[str, Any]]] = []
        for start in range(1, len(route) - 2):
            for end in range(start + 1, len(route) - 1):
                proposed = [
                    *route[:start],
                    *reversed(route[start : end + 1]),
                    *route[end + 1 :],
                ]
                evaluated = evaluate_route(
                    proposed,
                    candidates_by_index,
                    kilometres,
                    durations,
                    capacity_kg=capacity_kg,
                    shift_start=shift_start,
                    shift_end=shift_end,
                    service_min=service_min,
                )
                if evaluated is None:
                    continue
                proposed_distance = route_distance(proposed, kilometres)
                if proposed_distance < current_distance - 1e-9:
                    identifiers = tuple(
                        str(candidates_by_index[index]["generatorId"]) for index in proposed[1:-1]
                    )
                    improvements.append((proposed_distance, identifiers, proposed, evaluated))
        if not improvements:
            current["routeIndices"] = route
            return current
        _distance, _identifiers, route, current = min(improvements, key=lambda item: item[:2])
