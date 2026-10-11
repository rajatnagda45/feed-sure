"""Run deterministic FeedSure route scenarios through the production pure planner."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from feedsure.planner.greedy import (  # noqa: E402
    classify_insertion_failure,
    evaluate_route,
    time_to_minutes,
)
from feedsure.planner.plan import build_plan  # noqa: E402

DEFAULT_SCENARIOS = ROOT / "eval" / "route-scenarios"
DEFAULT_JSON = ROOT / "eval" / "route-results.json"
DEFAULT_REPORT = ROOT / "eval" / "route-results.md"


def _generator(spec: dict[str, Any], collection_date: str) -> dict[str, Any]:
    identifier = str(spec["generatorId"])
    status = spec.get("status", "READY")
    window = spec.get("window", {"start": "06:00", "end": "09:00"})
    readiness = None
    if status in {"READY", "NOT_READY"}:
        readiness = {
            "generatorId": identifier,
            "collectionDate": collection_date,
            "status": status,
            "schemaVersion": 3,
            "confirmedKg": spec["confirmedKg"] if status == "READY" else 0,
            "weightSource": (spec.get("weightSource", "SCALE") if status == "READY" else None),
            "window": window if status == "READY" else None,
            "submissionId": f"{identifier}#fixture",
        }
    return {
        "generatorId": identifier,
        "name": f"Synthetic {identifier}",
        "address": "Synthetic evaluation address",
        "lat": 12.681 + float(spec.get("coordinateOffset", 0.01)),
        "lng": 77.474,
        "supportedMaterial": spec.get("supportedMaterial", True),
        "simulated": True,
        "readinessStatus": status,
        "readiness": readiness,
        "unresolvedHazards": (
            [{"action": "ENTER", "reason": "Synthetic hazard"}] if spec.get("hazard", False) else []
        ),
    }


def scenario_input(spec: dict[str, Any]) -> dict[str, Any]:
    """Expand one compact saved scenario into the frozen planner input."""
    collection_date = spec.get("collectionDate", "2026-10-11")
    generators = [_generator(item, collection_date) for item in spec["generators"]]
    point_ids = ["plant", *[item["generatorId"] for item in generators]]
    params = {
        "targetKg": 200,
        "truckCapacityKg": 500,
        "capacityBuffer": 0.1,
        "readinessPrior": 0.8,
        "shiftStart": "06:00",
        "shiftEnd": "11:00",
        "serviceMin": 10,
        "maxRadiusKm": 15,
        "mandatoryIds": [],
        **spec.get("params", {}),
    }
    return {
        "collectionDate": collection_date,
        "inputRevision": 1,
        "generators": generators,
        "history": {},
        "depot": {"id": "plant", "lat": 12.681, "lng": 77.474},
        "matrix": {
            "pointIds": point_ids,
            "km": spec["km"],
            "min": spec["min"],
            "source": "fixture",
        },
        "params": params,
        "simulated": True,
    }


def _load_scenarios(directory: Path) -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data if isinstance(data, list) else data.get("scenarios", [data])
        for row in rows:
            scenarios.append({**row, "fixtureFile": path.name})
    identifiers = [row.get("scenarioId") for row in scenarios]
    if not scenarios or any(not isinstance(item, str) or not item for item in identifiers):
        raise ValueError("scenario fixtures require nonempty scenarioId values")
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("scenarioId values must be unique")
    return scenarios


def _comparison(plan: dict[str, Any]) -> str:
    primary = plan["plan"]["totals"]
    baseline = plan["baseline"]["totals"]
    if (
        primary["expectedCollectionKg"] == baseline["expectedCollectionKg"]
        and primary["totalKm"] == baseline["totalKm"]
    ):
        return "TIE"
    if primary["expectedCollectionKg"] != baseline["expectedCollectionKg"]:
        return "TRADE_OFF"
    return "PRIMARY_LOWER_KM" if primary["totalKm"] < baseline["totalKm"] else "BASELINE_LOWER_KM"


def evaluate(directory: Path) -> dict[str, Any]:
    """Run every saved fixture twice and return deterministic machine-readable metrics."""
    results: list[dict[str, Any]] = []
    for scenario in _load_scenarios(directory):
        inputs = scenario_input(scenario)
        before = copy.deepcopy(inputs)
        first = build_plan(inputs)
        second = build_plan(inputs)
        if first != second or inputs != before:
            raise RuntimeError(f"planner is not deterministic for {scenario['scenarioId']}")
        baseline_excluded = _check_routes(inputs, first)
        results.append(
            {
                "scenarioId": scenario["scenarioId"],
                "description": scenario["description"],
                "fixtureFile": scenario["fixtureFile"],
                "inputSha256": hashlib.sha256(
                    json.dumps(inputs, sort_keys=True, allow_nan=False).encode()
                ).hexdigest(),
                "inputs": inputs,
                "calculation": first,
                "matrixSource": first["matrixSource"],
                "status": first["status"],
                "comparison": _comparison(first),
                "primary": {
                    "order": [stop["generatorId"] for stop in first["plan"]["stops"]],
                    **first["plan"]["totals"],
                    "expectedKgPerKm": (
                        first["plan"]["totals"]["expectedCollectionKg"]
                        / first["plan"]["totals"]["totalKm"]
                        if first["plan"]["totals"]["totalKm"]
                        else None
                    ),
                },
                "baseline": {
                    "order": [stop["generatorId"] for stop in first["baseline"]["stops"]],
                    **first["baseline"]["totals"],
                    "expectedKgPerKm": (
                        first["baseline"]["totals"]["expectedCollectionKg"]
                        / first["baseline"]["totals"]["totalKm"]
                        if first["baseline"]["totals"]["totalKm"]
                        else None
                    ),
                    "shortfallKg": max(
                        0,
                        inputs["params"]["targetKg"]
                        - first["baseline"]["totals"]["expectedCollectionKg"],
                    ),
                    "excluded": baseline_excluded,
                },
                "shortfallKg": first["shortfall"]["kg"],
                "shortfallReasons": first["shortfall"]["reasons"],
                "excluded": first["excluded"],
                "mandatoryConflicts": first["mandatoryConflicts"],
                "assumptions": first["assumptions"],
            }
        )
    summary = dict(sorted(Counter(row["comparison"] for row in results).items()))
    return {
        "schemaVersion": 1,
        "command": (
            "python scripts/eval_routes.py --scenarios eval/route-scenarios "
            "--json-output eval/route-results.json --report-output eval/route-results.md"
        ),
        "seed": None,
        "summary": summary,
        "mandatoryConflictScenarios": sum(row["status"] == "MANDATORY_CONFLICT" for row in results),
        "emptyPrimaryRoutes": sum(not row["primary"]["order"] for row in results),
        "primaryUnmetTargets": sum(row["shortfallKg"] > 0 for row in results),
        "baselineUnmetTargets": sum(row["baseline"]["shortfallKg"] > 0 for row in results),
        "scenarioCount": len(results),
        "dataProvenance": "synthetic deterministic fixtures; no AWS calls",
        "metricDefinitions": {
            "expectedCollectionKg": "sum of P0 confirmedKg * readinessPrior for selected stops",
            "reservedLoadKg": "sum of full-load reservations including capacity buffer",
            "totalKm": "sum of directed fixture-matrix legs including depot return",
            "totalMin": "travel, waiting and service from shift start through depot return",
            "shortfallKg": "max(0, targetKg - primary expectedCollectionKg)",
            "expectedKgPerKm": "expectedCollectionKg / totalKm, null if totalKm is zero",
            "comparison": ("distance comparison only when expected kg tie; otherwise TRADE_OFF"),
        },
        "limitations": [
            "Fixtures are not field measurements or evidence of environmental savings.",
            "No realised-weight replay is reported; expected kilograms are not ground truth.",
            "The insertion and 2-opt heuristics do not prove global optimality.",
        ],
        "results": results,
    }


def _check_routes(inputs: dict[str, Any], result: dict[str, Any]) -> list[dict[str, str]]:
    """Independently verify both route schedules and report baseline's own omissions."""
    from feedsure.planner.plan import _candidate

    params, matrix = result["params"], inputs["matrix"]
    by_index, ineligible = {}, {}
    for generator in inputs["generators"]:
        candidate, reason = _candidate(generator, inputs["collectionDate"], params, matrix)
        if candidate is None:
            ineligible[generator["generatorId"]] = reason
        else:
            by_index[candidate["matrixIndex"]] = candidate
    options = dict(
        capacity_kg=params["truckCapacityKg"],
        shift_start=params["shiftStart"],
        shift_end=params["shiftEnd"],
        service_min=params["serviceMin"],
    )
    baseline_excluded = []
    for key in ("plan", "baseline"):
        route = result[key]
        ids = [stop["generatorId"] for stop in route["stops"]]
        assert len(ids) == len(set(ids))
        assert not set(ids) & set(ineligible)
        indices = [0, *[matrix["pointIds"].index(identifier) for identifier in ids], 0]
        checked = evaluate_route(indices, by_index, matrix["km"], matrix["min"], **options)
        assert checked is not None
        assert checked["totals"] == route["totals"]
        assert checked["returnAt"] == route["returnAt"]
        assert route["totals"]["reservedLoadKg"] <= params["truckCapacityKg"] + 1e-6
        if result["status"] == "FEASIBLE":
            assert set(params["mandatoryIds"]) <= set(ids)
        for stop in route["stops"]:

            def minutes(value: str) -> float:
                parts = value.split(":")
                return time_to_minutes(":".join(parts[:2])) + (
                    int(parts[2]) / 60 if len(parts) == 3 else 0
                )

            assert minutes(stop["serviceStartAt"]) >= time_to_minutes(stop["window"]["start"])
            assert minutes(stop["serviceEndAt"]) <= time_to_minutes(stop["window"]["end"]) + 1e-6
        if key == "baseline":
            for generator in inputs["generators"]:
                gid = generator["generatorId"]
                if gid in ids:
                    continue
                if gid in ineligible:
                    reason = ineligible[gid]
                elif route["totals"]["expectedCollectionKg"] >= params["targetKg"]:
                    reason = "TARGET_REACHED"
                else:
                    reason = classify_insertion_failure(
                        indices,
                        matrix["pointIds"].index(gid),
                        by_index,
                        matrix["km"],
                        matrix["min"],
                        **options,
                    )
                baseline_excluded.append({"generatorId": gid, "reason": reason})
    return sorted(baseline_excluded, key=lambda row: row["generatorId"])


def _markdown(data: dict[str, Any]) -> str:
    lines = [
        "# FeedSure v3 route evaluation",
        "",
        "Synthetic deterministic fixtures; no AWS calls and no claimed field savings.",
        f"Scenario count: {data['scenarioCount']}; seed: none (fixed hand-authored scenarios).",
        f"Observed comparison counts: {json.dumps(data['summary'], sort_keys=True)}.",
        f"Mandatory-conflict scenarios: {data['mandatoryConflictScenarios']}.",
        f"Empty primary routes: {data['emptyPrimaryRoutes']}; unmet targets primary/baseline: "
        f"{data['primaryUnmetTargets']} / {data['baselineUnmetTargets']}.",
        "",
        "Run:",
        "",
        f"`{data['command']}`",
        "",
        "Metrics: expected kg uses the disclosed P0 readiness assumption; reserved kg is",
        "the capacity quantity; km is directed matrix travel including return; minutes include",
        "travel, waiting and service. Comparisons use identical inputs. Expected kg is not",
        "substituted for realised collection ground truth.",
        "",
        "| Scenario | Status | Primary order | Baseline order | Expected kg P/B | "
        "km P/B | Gap kg P/B | Result |",
        "|---|---|---|---|---:|---:|---:|---|",
    ]
    for row in data["results"]:
        primary_order = " → ".join(row["primary"]["order"]) or "(empty)"
        baseline_order = " → ".join(row["baseline"]["order"]) or "(empty)"
        lines.append(
            f"| {row['scenarioId']} | {row['status']} | {primary_order} | "
            f"{baseline_order} | {row['primary']['expectedCollectionKg']} / "
            f"{row['baseline']['expectedCollectionKg']} | {row['primary']['totalKm']} / "
            f"{row['baseline']['totalKm']} | {row['shortfallKg']} / "
            f"{row['baseline']['shortfallKg']} | "
            f"{row['comparison']} |"
        )
    lines.extend(
        [
            "",
            "Observed ties and losses are retained in the table; no scenario is discarded for",
            "making the primary heuristic look worse. A TRADE_OFF means achieved expected "
            "kg differs,",
            "so a distance-only winner would be misleading.",
            "In primary-capacity-tradeoff the primary's 176 kg misses target by 64 kg;",
            "nearest-first reaches 240 kg on a 0.2 km longer route.",
            "In primary-distance-improvement both expect 240 kg, with primary 6 km versus",
            "baseline 10 km. These are fixture outputs.",
            "",
            "Assumptions: readiness prior 0.8, volume ratio 1.0, capacity buffer 0.10 unless",
            "the saved scenario overrides capacity/target/time controls. Matrix source is fixture.",
            "No information-value replay or P1 reliability model is included.",
            "Full inputs, input SHA256, primary/baseline schedules, reservations, gap and",
            "each route's exclusions are saved in route-results.json. A TIE compares expected",
            "kg and km, and can still have different stop orders or service minutes.",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse documented evaluation paths."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenarios", type=Path, default=DEFAULT_SCENARIOS)
    parser.add_argument("--json-output", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--report-output", type=Path, default=DEFAULT_REPORT)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Evaluate fixtures and write deterministic JSON plus Markdown reports."""
    args = parse_args(argv)
    data = evaluate(args.scenarios)
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.report_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.report_output.write_text(_markdown(data), encoding="utf-8")
    print(f"evaluated {len(data['results'])} scenarios")
    print(args.json_output)
    print(args.report_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
