"""Saved interface examples are valid and compatible with real pure calculations."""

from __future__ import annotations

import json
from pathlib import Path

from feedsure.planner.plan import build_plan
from feedsure.planner.reconcile import reconcile_trip

ROOT = Path(__file__).parents[1] / "contracts"


def load(name: str) -> dict:
    return json.loads((ROOT / (name + ".json")).read_text(encoding="utf-8"))


def test_saved_calculation_examples_have_consistent_quantities_and_schedules():
    result = build_plan(load("planner-input"))
    expected = load("planner-result")
    assert result["status"] == expected["status"]
    assert result["plan"]["totals"] == expected["plan"]["totals"]
    assert result["baseline"]["totals"] == expected["baseline"]["totals"]
    assert result["shortfall"]["kg"] == expected["shortfall"]["kg"]
    assert {s["generatorId"] for s in result["plan"]["stops"]} == {"hotel-a", "hostel-b"}
    assert reconcile_trip(load("reconciliation-input")) == load("reconciliation-result")


def test_saved_examples_are_objects_with_no_real_bearer_credentials():
    assert len(list(ROOT.glob("*.json"))) >= 23
    for path in ROOT.glob("*.json"):
        value = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(value, dict), path
        assert "tokenHash" not in path.read_text(encoding="utf-8")
    assert load("dispatch-response")["driverAccess"]["token"] == "EXAMPLE_NOT_USABLE"
    assert load("not-ready-response")["submission"]["confirmedKg"] == 0
