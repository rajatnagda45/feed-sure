"""Pure nearest-first comparison route."""

from __future__ import annotations

from typing import Any

from feedsure.planner.greedy import evaluate_route


def build_baseline(
    candidates: list[dict[str, Any]],
    kilometres: list[list[float]],
    durations: list[list[float]],
    *,
    capacity_kg: float,
    shift_start: str,
    shift_end: str,
    service_min: int,
) -> dict[str, Any]:
    """Build a deterministic nearest-first route, including HOLD generators."""
    by_index = {int(candidate["matrixIndex"]): candidate for candidate in candidates}
    remaining = set(by_index)
    route = [0, 0]
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
    while remaining:
        current = route[-2]
        added = False
        for index in sorted(
            remaining,
            key=lambda value: (float(kilometres[current][value]), by_index[value]["generatorId"]),
        ):
            proposed = [*route[:-1], index, 0]
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
                route, result, added = proposed, evaluated, True
                remaining.remove(index)
                break
        if not added:
            break
    result["routeIndices"] = route
    return result
