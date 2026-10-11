"""Mapped geography remains reproducible, scoped and safe to reseed locally."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date
from pathlib import Path

import boto3
import pytest
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.handlers.operations import Service
from feedsure.planner.matrix import haversine_km
from moto import mock_aws
from seed_data import DEFAULT_DEMO_LOCATIONS, load_demo_locations, seed_v3_database


def test_mapped_catalog_keeps_login_ids_and_pilot_radius():
    """References link to distinct mapped features inside the existing service zone."""
    config = get_config()
    locations = load_demo_locations()
    assert [row["generatorId"] for row in locations] == [
        f"demo-kitchen-{index:02}" for index in range(1, 11)
    ]
    assert len({row["locationSource"]["url"] for row in locations}) == 10
    assert {row["type"] for row in locations} >= {"hostel_mess", "restaurant", "cafe"}
    depot = {"lat": config.plant_lat, "lng": config.plant_lng}
    assert all(haversine_km(depot, row) < config.max_radius_km for row in locations)
    assert any(row["locationSource"]["coordinateKind"] == "feature_center" for row in locations)
    for row in locations:
        assert row["name"] == row["locationSource"]["tags"]["name"]
        assert row["locationSource"]["attribution"] == "© OpenStreetMap contributors"
        assert row["locationSource"]["license"] == "ODbL-1.0"


def test_mapped_seed_reads_and_planning_use_actual_points(monkeypatch):
    """Names and points survive HTTP-domain reads and the real pure planner."""
    monkeypatch.setenv("ADMIN_TOKEN", "mapped-seed-test-admin")
    monkeypatch.setenv("MOCK_LOCATION", "true")
    with mock_aws():
        config = replace(get_config(), aws_endpoint_url="moto://in-process")
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        database = DynamoDB(config, resource)
        tokens = seed_v3_database(config, resource, date(2026, 10, 12))
        gid = "demo-kitchen-01"
        own = Service(
            {"rawPath": f"/generators/{gid}", "headers": {"X-Generator-Token": tokens[gid]}},
            config,
            database,
            None,
        ).route()["generator"]
        assert own["name"] == "Jayaram Breakfast Point (demo)"
        assert (own["lat"], own["lng"]) == (12.6778162, 77.4746671)
        assert own["locationSource"]["url"] == "https://www.openstreetmap.org/node/1304825515"
        assert own["simulated"] is True and "tokenHash" not in own

        dispatcher = Service(
            {"headers": {"X-Admin-Token": config.admin_token}}, config, database, None
        )
        snapshot = dispatcher.snapshot("2026-10-12")
        assert sum(g["readinessStatus"] == "UNCONFIRMED" for g in snapshot["generators"]) == 2
        assert sum(g["readinessStatus"] == "NOT_READY" for g in snapshot["generators"]) == 1
        plan = dispatcher.create_plan({"collectionDate": "2026-10-12"})
        assert plan["status"] == "FEASIBLE" and plan["plan"]["stops"]
        points = {row["generatorId"]: row for row in load_demo_locations()}
        for stop in plan["plan"]["stops"]:
            location = points[stop["generatorId"]]
            assert (stop["lat"], stop["lng"]) == (location["lat"], location["lng"])
            assert stop["name"] == f"{location['name']} (demo)"
            assert stop["simulated"] is True

        edited = database.get("generators", {"generatorId": gid})
        edited.update(name="Existing user venue edit", lat=12.68, lng=77.48)
        database.put("generators", edited)
        before = database.scan("operations")
        assert seed_v3_database(config, resource, date(2026, 10, 12)) == {}
        assert database.get("generators", {"generatorId": gid}) == edited
        assert database.scan("operations") == before
        assert (
            database.get(
                "plans", {"date": plan["collectionDate"], "planId": plan["planKey"].split("#")[1]}
            )["inputs"]
            == plan["inputs"]
        )


@pytest.mark.parametrize("coordinate", [float("nan"), float("inf"), True, 91])
def test_bad_location_file_fails_before_seed_writes(tmp_path: Path, coordinate):
    """Reject invalid geographic data rather than generating unusable demo coordinates."""
    catalog = json.loads(DEFAULT_DEMO_LOCATIONS.read_text(encoding="utf-8"))
    catalog["generators"][0]["lat"] = coordinate
    path = tmp_path / "locations.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    with pytest.raises(ValueError, match="coordinates"):
        load_demo_locations(path)
