"""Pure READY v3.0 planner orchestration; no clock, database or AWS imports."""

from __future__ import annotations

from typing import Any

from feedsure.planner.baseline import build_baseline
from feedsure.planner.greedy import build_greedy_route, classify_insertion_failure
from feedsure.planner.shortfall import explain_shortfall
from feedsure.planner.two_opt import improve_route
from feedsure.planner.usable import collection_quantities
from feedsure.planner.validation import (
    boolean,
    coordinates,
    number,
    service_date,
    text,
    validate_matrix,
    window,
)

PARAMS = {
    "targetKg",
    "truckCapacityKg",
    "capacityBuffer",
    "readinessPrior",
    "shiftStart",
    "shiftEnd",
    "serviceMin",
    "maxRadiusKm",
    "mandatoryIds",
}


def _validate(inputs: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(inputs, dict):
        raise ValueError("planner inputs must be an object")
    service_date(inputs.get("collectionDate"))
    revision = inputs.get("inputRevision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError("inputRevision must be a nonnegative integer")
    boolean(inputs.get("simulated"), "simulated")
    depot = inputs.get("depot")
    if not isinstance(depot, dict) or depot.get("id") != "plant":
        raise ValueError("depot must identify plant")
    coordinates(depot)
    params = inputs.get("params")
    if not isinstance(params, dict) or set(params) != PARAMS:
        raise ValueError("params must contain the exact READY v3.0 fields")
    params = dict(params)
    window({"start": params["shiftStart"], "end": params["shiftEnd"]})
    for field, low, high in (
        ("targetKg", 0, 100000),
        ("truckCapacityKg", 0, 100000),
        ("capacityBuffer", 0, 1),
        ("readinessPrior", 0, 1),
        ("serviceMin", 0, 1440),
        ("maxRadiusKm", 0, 200),
    ):
        params[field] = number(params[field], field, low, high)
    generators = inputs.get("generators")
    if not isinstance(generators, list) or any(not isinstance(g, dict) for g in generators):
        raise ValueError("generators must be a list of objects")
    ids = [text(g.get("generatorId"), "generatorId") for g in generators]
    if "plant" in ids or len(ids) != len(set(ids)):
        raise ValueError("generator IDs must be unique and distinct from plant")
    mandatory = params["mandatoryIds"]
    if (
        not isinstance(mandatory, list)
        or any(not isinstance(g, str) for g in mandatory)
        or len(mandatory) != len(set(mandatory))
        or set(mandatory) - set(ids)
    ):
        raise ValueError("mandatoryIds must be unique enrolled generator IDs")
    params["mandatoryIds"] = sorted(mandatory)
    matrix = inputs.get("matrix")
    if not isinstance(matrix, dict):
        raise ValueError("matrix must be an object")
    points = matrix.get("pointIds")
    if (
        not isinstance(points, list)
        or any(not isinstance(p, str) for p in points)
        or set(points) != {"plant", *ids}
    ):
        raise ValueError("matrix pointIds must map all enrolled generators and plant")
    validate_matrix(matrix, points)
    history = inputs.get("history")
    if not isinstance(history, dict) or set(history) - set(ids):
        raise ValueError("history must map enrolled generator IDs to records")
    for rows in history.values():
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError("history must contain record lists")
        for row in rows:
            if service_date(row.get("date")) >= inputs["collectionDate"]:
                raise ValueError("history must be strictly before collectionDate")
            number(row.get("kg"), "history kg", 0, 5000)
    return params, sorted(generators, key=lambda g: g["generatorId"])


def _candidate(
    generator: dict[str, Any],
    day: str,
    params: dict[str, Any],
    matrix: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None]:
    coordinates(generator)
    for field in ("name", "address"):
        text(generator.get(field), field)
    boolean(generator.get("simulated"), "generator simulated")
    boolean(generator.get("supportedMaterial"), "supportedMaterial")
    status = generator.get("readinessStatus")
    if not isinstance(status, str) or status not in {"READY", "NOT_READY", "UNCONFIRMED"}:
        raise ValueError("invalid readinessStatus")
    hazards = generator.get("unresolvedHazards")
    if not isinstance(hazards, list) or any(not isinstance(h, dict) for h in hazards):
        raise ValueError("unresolvedHazards must be a list of objects")
    readiness = generator.get("readiness")
    if readiness is not None and not isinstance(readiness, dict):
        raise ValueError("readiness must be an object or null")
    current = (
        readiness is not None
        and readiness.get("schemaVersion") == 3
        and readiness.get("collectionDate") == day
    )
    if current:
        if readiness.get("generatorId") != generator["generatorId"]:
            raise ValueError("readiness generatorId mismatch")
        if not isinstance(readiness.get("status"), str) or readiness["status"] not in {
            "READY",
            "NOT_READY",
        }:
            raise ValueError("invalid readiness status")
        if status != readiness["status"]:
            raise ValueError("readinessStatus disagrees with readiness")
        quantity = number(readiness.get("confirmedKg"), "confirmedKg", 0, 5000)
        if status == "READY":
            source = readiness.get("weightSource")
            if quantity <= 0 or not isinstance(source, str) or source not in {"SCALE", "ESTIMATE"}:
                raise ValueError("READY requires positive kg and SCALE/ESTIMATE")
            window(readiness.get("window"))
            text(readiness.get("submissionId"), "submissionId")
        elif (
            quantity != 0
            or readiness.get("weightSource") is not None
            or readiness.get("window") is not None
        ):
            raise ValueError("NOT_READY requires zero kg and null source/window")
    else:
        status = "UNCONFIRMED"
    # Safety-first stable precedence; every supplier has at most one exclusion.
    if hazards:
        return None, "HAZARD_REVIEW"
    if not generator["supportedMaterial"]:
        return None, "UNSUPPORTED_MATERIAL"
    if status != "READY":
        return None, status
    index = matrix["pointIds"].index(generator["generatorId"])
    outbound = matrix["km"][0][index]
    if outbound is not None and outbound > params["maxRadiusKm"]:
        return None, "OUT_OF_RADIUS"
    assert readiness is not None
    quantities = collection_quantities(
        readiness["confirmedKg"],
        readiness_prior=params["readinessPrior"],
        capacity_buffer=params["capacityBuffer"],
    )
    return {
        **generator,
        **quantities,
        "matrixIndex": index,
        "window": dict(readiness["window"]),
        "submissionId": readiness["submissionId"],
        "confirmedKg": readiness["confirmedKg"],
        "weightSource": readiness["weightSource"],
        "mandatory": generator["generatorId"] in params["mandatoryIds"],
    }, None


def build_plan(inputs: dict[str, Any]) -> dict[str, Any]:
    """Plan confirmed collections and a fair nearest-first comparison under READY v3.0."""
    params, generators = _validate(inputs)
    matrix = inputs["matrix"]
    candidates, excluded, conflicts = [], [], []
    for generator in generators:
        candidate, reason = _candidate(generator, inputs["collectionDate"], params, matrix)
        if candidate is not None:
            candidates.append(candidate)
        else:
            row = {"generatorId": generator["generatorId"], "reason": reason}
            excluded.append(row)
            if generator["generatorId"] in params["mandatoryIds"]:
                conflicts.append(dict(row))
    options = {
        "capacity_kg": params["truckCapacityKg"],
        "shift_start": params["shiftStart"],
        "shift_end": params["shiftEnd"],
        "service_min": params["serviceMin"],
    }
    km, durations = matrix["km"], matrix["min"]
    greedy = build_greedy_route(candidates, km, durations, target_kg=params["targetKg"], **options)
    by_index = {c["matrixIndex"]: c for c in candidates}
    optimized = improve_route(greedy["routeIndices"], by_index, km, durations, **options)
    baseline = build_baseline(candidates, km, durations, target_kg=params["targetKg"], **options)
    unserved = set(greedy["unservedMandatoryIndices"]) | set(baseline["unservedMandatoryIndices"])
    for index in sorted(unserved, key=lambda i: by_index[i]["generatorId"]):
        route = (greedy if index in greedy["unservedMandatoryIndices"] else baseline)[
            "routeIndices"
        ]
        reason = classify_insertion_failure(route, index, by_index, km, durations, **options)
        if reason == "NOT_SELECTED_BY_HEURISTIC":
            reason = "MANDATORY_CONFLICT"
        conflicts.append({"generatorId": by_index[index]["generatorId"], "reason": reason})
    served = set(optimized["routeIndices"][1:-1])
    expected = sum(by_index[i]["expectedCollectionKg"] for i in sorted(served))
    for index, candidate in by_index.items():
        if index in served:
            continue
        if index in unserved:
            reason = next(
                row["reason"] for row in conflicts if row["generatorId"] == candidate["generatorId"]
            )
        elif expected >= params["targetKg"]:
            reason = "TARGET_REACHED"
        else:
            reason = classify_insertion_failure(
                optimized["routeIndices"],
                index,
                by_index,
                km,
                durations,
                **options,
            )
        excluded.append({"generatorId": candidate["generatorId"], "reason": reason})
    excluded.sort(key=lambda row: row["generatorId"])
    return {
        "collectionDate": inputs["collectionDate"],
        "inputRevision": inputs["inputRevision"],
        "status": "MANDATORY_CONFLICT" if conflicts else "FEASIBLE",
        "params": params,
        "plan": {key: optimized[key] for key in ("stops", "startAt", "returnAt", "totals")},
        "baseline": {key: baseline[key] for key in ("stops", "startAt", "returnAt", "totals")},
        "excluded": excluded,
        "shortfall": explain_shortfall(params["targetKg"], expected, excluded),
        "mandatoryConflicts": sorted(conflicts, key=lambda row: row["generatorId"]),
        "matrixSource": matrix["source"],
        "simulated": inputs["simulated"],
        "assumptions": {
            "readinessPrior": params["readinessPrior"],
            "volumeRatio": 1,
            "capacityBuffer": params["capacityBuffer"],
        },
    }
