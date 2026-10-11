"""Pure nearest-first comparison with the primary planner's exact eligibility and constraints."""

from __future__ import annotations

from typing import Any

from feedsure.planner.greedy import Matrix, evaluate_route, insert_mandatory


def build_baseline(
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
    """Serve identical mandatory commitments, then append the nearest feasible optional stop."""
    by_index = {int(candidate["matrixIndex"]): candidate for candidate in candidates}
    options = dict(
        capacity_kg=capacity_kg,
        shift_start=shift_start,
        shift_end=shift_end,
        service_min=service_min,
    )
    route, unserved = insert_mandatory(
        [0, 0],
        {index for index, item in by_index.items() if item["mandatory"]},
        by_index,
        kilometres,
        durations,
        **options,
    )
    remaining = set(by_index) - set(route[1:-1]) - unserved
    result = evaluate_route(route, by_index, kilometres, durations, **options)
    assert result is not None
    expected = sum(by_index[i]["expectedCollectionKg"] for i in route[1:-1])
    while remaining and expected < target_kg:
        current = route[-2]
        available = [i for i in remaining if kilometres[current][i] is not None]
        for index in sorted(
            available, key=lambda i: (kilometres[current][i], by_index[i]["generatorId"])
        ):
            proposed = [*route[:-1], index, 0]
            evaluated = evaluate_route(proposed, by_index, kilometres, durations, **options)
            if evaluated is not None:
                route, result = proposed, evaluated
                remaining.remove(index)
                expected += by_index[index]["expectedCollectionKg"]
                break
        else:
            break
    result["routeIndices"] = route
    result["unservedMandatoryIndices"] = sorted(unserved)
    return result
