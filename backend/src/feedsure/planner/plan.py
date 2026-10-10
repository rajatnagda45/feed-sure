"""Pure deterministic planner orchestration."""

from __future__ import annotations

from typing import Any

from feedsure.planner.baseline import build_baseline
from feedsure.planner.forecast import forecast_kg
from feedsure.planner.greedy import build_greedy_route
from feedsure.planner.shortfall import explain_shortfall
from feedsure.planner.two_opt import improve_route
from feedsure.planner.usable import expected_usable_kg


def _public_metrics(result: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in result.items() if key != "routeIndices"}


def build_plan(inputs: dict[str, Any]) -> dict[str, Any]:
    """Forecast, route, compare, and explain a plan without clocks or AWS calls."""
    plan_date = str(inputs["date"])
    generators = sorted(inputs.get("generators", []), key=lambda item: str(item["generatorId"]))
    histories = inputs.get("history", {})
    submissions = inputs.get("submissions", {})
    matrix = inputs["matrix"]
    params = inputs["params"]
    index_by_id = {identifier: index for index, identifier in enumerate(matrix["pointIds"])}
    enriched: list[dict[str, Any]] = []
    for generator in generators:
        generator_id = str(generator["generatorId"])
        submission = submissions.get(generator_id)
        forecast = forecast_kg(histories.get(generator_id, []), submission, plan_date)
        usable = expected_usable_kg(
            forecast,
            submission,
            prior_accept=float(generator.get("priorAccept", params["defaultPriorAccept"])),
            prior_contam_pct=float(
                generator.get("priorContamPct", params["defaultPriorContamPct"])
            ),
        )
        enriched.append(
            {
                **generator,
                "matrixIndex": index_by_id[generator_id],
                "forecastKg": forecast,
                "usableKg": usable,
                "verdict": submission["verdict"] if submission else "UNSCREENED",
                "contaminationPct": float(
                    submission.get("visibleContaminantPct", 0)
                    if submission
                    else generator.get("priorContamPct", params["defaultPriorContamPct"])
                ),
                "screened": submission is not None,
            }
        )

    kilometres, durations = matrix["km"], matrix["min"]
    optimized_candidates = [
        item
        for item in enriched
        if item["forecastKg"] > 0
        and item["usableKg"] > 0
        and item["verdict"] != "HOLD"
        and float(kilometres[0][item["matrixIndex"]]) <= float(params["maxRadiusKm"])
    ]
    greedy = build_greedy_route(
        optimized_candidates,
        kilometres,
        durations,
        capacity_kg=float(params["truckCapacityKg"]),
        target_kg=float(params["targetKg"]),
        shift_start=params["shiftStart"],
        shift_end=params["shiftEnd"],
        service_min=int(params["serviceMin"]),
        stop_at_target=bool(params["stopAtTarget"]),
    )
    by_index = {int(item["matrixIndex"]): item for item in optimized_candidates}
    optimized = improve_route(
        greedy["routeIndices"],
        by_index,
        kilometres,
        durations,
        capacity_kg=float(params["truckCapacityKg"]),
        shift_start=params["shiftStart"],
        shift_end=params["shiftEnd"],
        service_min=int(params["serviceMin"]),
    )
    baseline_candidates = [
        item
        for item in enriched
        if item["forecastKg"] > 0
        and float(kilometres[0][item["matrixIndex"]]) <= float(params["maxRadiusKm"])
    ]
    baseline = build_baseline(
        baseline_candidates,
        kilometres,
        durations,
        capacity_kg=float(params["truckCapacityKg"]),
        shift_start=params["shiftStart"],
        shift_end=params["shiftEnd"],
        service_min=int(params["serviceMin"]),
    )

    planned = set(optimized["routeIndices"][1:-1])
    exclusions: list[dict[str, str]] = []
    contributions: list[dict[str, Any]] = []
    for item in enriched:
        index = int(item["matrixIndex"])
        identifier = str(item["generatorId"])
        if not item["screened"]:
            full_accept = item["forecastKg"] * 0.95 * (1 - item["contaminationPct"] / 100)
            contributions.append(
                {
                    "code": "unscreened_risk",
                    "kg": full_accept - item["usableKg"],
                    "generatorId": identifier,
                }
            )
        if item["forecastKg"] <= 0 or item["usableKg"] <= 0 and item["verdict"] != "HOLD":
            exclusions.append({"generatorId": identifier, "code": "zero_forecast"})
            continue
        if item["verdict"] == "HOLD":
            counterfactual = item["forecastKg"] * 0.95 * (1 - item["contaminationPct"] / 100)
            contributions.append({"code": "held", "kg": counterfactual, "generatorId": identifier})
            exclusions.append({"generatorId": identifier, "code": "held"})
            continue
        if float(kilometres[0][index]) > float(params["maxRadiusKm"]):
            contributions.append(
                {"code": "out_of_radius", "kg": item["usableKg"], "generatorId": identifier}
            )
            exclusions.append({"generatorId": identifier, "code": "out_of_radius"})
            continue
        if index in planned:
            continue
        code = (
            "capacity"
            if optimized["loadKg"] + item["forecastKg"] > float(params["truckCapacityKg"])
            else "time_window"
        )
        contributions.append({"code": code, "kg": item["usableKg"], "generatorId": identifier})
        exclusions.append({"generatorId": identifier, "code": code})

    shortfall = explain_shortfall(float(params["targetKg"]), optimized["usableKg"], contributions)
    public_params = {
        "targetKg": float(params["targetKg"]),
        "truckCapacityKg": float(params["truckCapacityKg"]),
        "shiftStart": params["shiftStart"],
        "shiftEnd": params["shiftEnd"],
        "serviceMin": int(params["serviceMin"]),
        "maxRadiusKm": float(params["maxRadiusKm"]),
    }
    return {
        "date": plan_date,
        "simulated": True,
        "matrixSource": matrix["source"],
        "params": public_params,
        "plan": _public_metrics(optimized),
        "baseline": _public_metrics(baseline),
        "shortfall": shortfall,
        "excluded": sorted(exclusions, key=lambda item: (item["generatorId"], item["code"])),
    }
