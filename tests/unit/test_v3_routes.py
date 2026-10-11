"""Real local HTTP handlers with moto transport; no planner/reconciliation fixture callback."""

from __future__ import annotations

import hashlib
from urllib.parse import quote

import boto3
import pytest
from fastapi.testclient import TestClient
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.common.routes import ROUTES
from moto import mock_aws
from seed_data import ensure_v3_tables


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "route-test-admin")
    monkeypatch.setenv("DRIVER_TOKEN_SECRET", "test-only-driver-secret-with-at-least-32-characters")
    monkeypatch.setenv("MOCK_LOCATION", "true")
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    with mock_aws():
        config = get_config()
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        ensure_v3_tables(config, resource)
        database = DynamoDB(config, resource)
        for index, gid in enumerate(("hotel-a", "hostel-b")):
            database.put(
                "generators",
                {
                    "generatorId": gid,
                    "name": "Fictional " + gid,
                    "address": "Synthetic kitchen",
                    "type": "hotel",
                    "lat": 12.685 + index * 0.001,
                    "lng": 77.474,
                    "pickupStart": "06:00",
                    "pickupEnd": "09:00",
                    "simulated": True,
                    "supportedMaterial": True,
                    "tokenHash": hashlib.sha256((gid + "-test-token").encode()).hexdigest(),
                },
            )
        import dev_server

        with TestClient(dev_server.app) as http:
            http.db = database
            yield http


ADMIN = {"X-Admin-Token": "route-test-admin"}
DAY = "2026-10-11"


def plan_and_dispatch(client):
    for gid in ("hotel-a", "hostel-b"):
        response = client.post(
            "/submissions",
            headers={"X-Generator-Token": gid + "-test-token"},
            json={
                "generatorId": gid,
                "collectionDate": DAY,
                "status": "READY",
                "confirmedKg": 100,
                "weightSource": "SCALE",
                "window": {"start": "06:00", "end": "09:00"},
            },
        )
        assert response.status_code == 200, response.text
    response = client.post("/plans", headers=ADMIN, json={"collectionDate": DAY, "targetKg": 150})
    assert response.status_code == 200, response.text
    plan = response.json()
    encoded = quote(plan["planKey"], safe="")
    assert "%23" in encoded
    response = client.post(
        "/plans/" + encoded + "/dispatch",
        headers={**ADMIN, "Idempotency-Key": "dispatch-http"},
        json={"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]},
    )
    assert response.status_code == 200, response.text
    token = response.json()["driverAccess"]["token"]
    return plan, encoded, {"X-Driver-Token": token}


def test_real_http_loop_refresh_retry_partial_gate_and_records(client):
    plan, encoded, driver = plan_and_dispatch(client)
    read = client.get("/plans/" + encoded + "/driver", headers=driver)
    assert read.status_code == 200
    assert read.json()["reconciliation"]["status"] == "PENDING_GATE"
    assert read.json()["reconciliation"]["pendingStopIds"]
    for index, gid in enumerate(("hotel-a", "hostel-b")):
        payload = {
            "planKey": plan["planKey"],
            "generatorId": gid,
            "outcome": "COLLECTED" if index == 0 else "PARTIAL",
            "kg": 100 if index == 0 else 60,
            "weightSource": "SCALE" if index == 0 else "ESTIMATE",
            "gps": None,
            "expectedRevision": 0,
        }
        if index:
            payload.update(reason="Vehicle capacity action", remainingUnknown=True)
        headers = {**driver, "Idempotency-Key": "pickup-http-" + gid}
        response = client.post("/pickups", headers=headers, json=payload)
        assert response.status_code == 200, response.text
        assert client.post("/pickups", headers=headers, json=payload).json() == response.json()
        assert (
            client.post("/pickups", headers=headers, json={**payload, "kg": 99}).status_code == 409
        )
    read = client.get("/plans/" + encoded + "/driver", headers=driver).json()
    assert len(read["pickups"]) == 2 and read["reconciliation"]["pickedKg"] == 160
    gate = {
        "planKey": plan["planKey"],
        "netKg": 155,
        "weightSource": "SCALE",
        "expectedRevision": 0,
    }
    headers = {**ADMIN, "Idempotency-Key": "gate-http"}
    response = client.post("/gate-logs", headers=headers, json=gate)
    assert response.status_code == 200, response.text
    assert response.json()["reconciliation"]["status"] == "WITHIN_TOLERANCE"
    assert response.json()["reconciliation"]["deltaKg"] == -5
    assert response.json()["reconciliation"]["provisional"] is True
    assert client.post("/gate-logs", headers=headers, json=gate).json() == response.json()
    details = client.get("/plans/" + encoded + "/details", headers=ADMIN)
    assert details.status_code == 200
    assert details.json()["execution"]["reconciliation"]["pickedKg"] == 160
    own = client.get(
        "/generators/hotel-a/receipts?month=2026-10",
        headers={"X-Generator-Token": "hotel-a-test-token"},
    )
    assert own.status_code == 200
    assert len(own.json()["records"]) == 1
    assert own.json()["records"][0]["pickup"]["kg"] == 100
    assert own.json()["records"][0]["gateStatus"] == "WITHIN_TOLERANCE"
    assert (
        client.get(
            "/generators/hotel-a/receipts", headers={"X-Generator-Token": "hostel-b-test-token"}
        ).status_code
        == 401
    )
    assert client.get("/plans/" + encoded + "/driver").status_code == 401


def test_real_http_zero_and_missing_gate_and_gain(client):
    plan, encoded, driver = plan_and_dispatch(client)
    gate = {"planKey": plan["planKey"], "netKg": 0, "weightSource": "SCALE", "expectedRevision": 0}
    headers = {**ADMIN, "Idempotency-Key": "zero-gate"}
    response = client.post("/gate-logs", headers=headers, json=gate)
    assert (
        response.status_code == 200 and response.json()["reconciliation"]["status"] == "INCOMPLETE"
    )
    for gid in ("hotel-a", "hostel-b"):
        payload = {
            "planKey": plan["planKey"],
            "generatorId": gid,
            "outcome": "NOT_READY",
            "kg": 0,
            "weightSource": None,
            "reason": "Visited, kitchen unavailable",
            "expectedRevision": 0,
        }
        response = client.post(
            "/pickups", headers={**driver, "Idempotency-Key": "zero-" + gid}, json=payload
        )
        assert response.status_code == 200, response.text
    latest = client.get("/plans/" + encoded + "/driver", headers=driver).json()
    assert latest["reconciliation"]["status"] == "NO_LOAD"
    assert latest["reconciliation"]["deltaPct"] is None
    response = client.post(
        "/gate-logs",
        headers={**ADMIN, "Idempotency-Key": "gain-gate"},
        json={
            **gate,
            "netKg": 100,
            "expectedRevision": 1,
            "correctionReason": "Correct weighbridge entry",
        },
    )
    assert response.status_code == 200
    assert response.json()["reconciliation"]["status"] == "UNMATCHED_INTAKE"


def test_local_and_sam_routes_match_and_cors_lists_headers():
    from pathlib import Path

    import yaml
    from dev_server import app

    class Loader(yaml.SafeLoader):
        pass

    Loader.add_multi_constructor(
        "!",
        lambda loader, tag, node: (
            loader.construct_scalar(node)
            if isinstance(node, yaml.ScalarNode)
            else loader.construct_sequence(node)
        ),
    )
    template = yaml.load(
        (Path(__file__).parents[2] / "backend/template.yaml").read_text(), Loader=Loader
    )
    events = template["Resources"]["OperationsFunction"]["Properties"]["Events"]
    sam = {(r["Properties"]["Method"], r["Properties"]["Path"]) for r in events.values()}
    local = {(m, r.path) for r in app.routes if hasattr(r, "methods") for m in r.methods}
    assert sam == set(ROUTES) and set(ROUTES) <= local
    cors = template["Resources"]["HttpApi"]["Properties"]["CorsConfiguration"]["AllowHeaders"]
    assert {"x-generator-token", "x-driver-token", "idempotency-key"} <= set(cors)


def test_new_hazard_blocks_loading_without_changing_frozen_driver_stops(client):
    plan, encoded, driver = plan_and_dispatch(client)
    response = client.post(
        "/generators/hotel-a/hazard-reviews",
        headers=ADMIN,
        json={"collectionDate": DAY, "action": "ENTER", "reason": "Glass"},
    )
    assert response.status_code == 200
    payload = {
        "planKey": plan["planKey"],
        "generatorId": "hotel-a",
        "outcome": "COLLECTED",
        "kg": 100,
        "weightSource": "SCALE",
        "expectedRevision": 0,
    }
    headers = {**driver, "Idempotency-Key": "hazard-pickup"}
    assert client.post("/pickups", headers=headers, json=payload).status_code == 409
    read = client.get("/plans/" + encoded + "/driver", headers=driver).json()
    assert len(read["plan"]["plan"]["stops"]) == 2 and read["alerts"]
    response = client.post(
        "/generators/hotel-a/hazard-reviews",
        headers=ADMIN,
        json={"collectionDate": DAY, "action": "RESOLVE", "reason": "Removed"},
    )
    assert response.status_code == 200
    assert client.post("/pickups", headers=headers, json=payload).status_code == 200


def test_mandatory_conflict_and_cancellation_block_dispatch(client):
    plan, encoded, _ = plan_and_dispatch(client)
    response = client.post(
        "/submissions",
        headers={"X-Generator-Token": "hotel-a-test-token"},
        json={
            "generatorId": "hotel-a",
            "collectionDate": DAY,
            "status": "NOT_READY",
            "reason": "Kitchen closed",
        },
    )
    assert response.status_code == 200
    response = client.post(
        "/plans", headers=ADMIN, json={"collectionDate": DAY, "mandatoryIds": ["hotel-a"]}
    )
    assert response.status_code == 200 and response.json()["status"] == "MANDATORY_CONFLICT"
    conflict_plan = response.json()
    response = client.post(
        "/plans/" + quote(conflict_plan["planKey"], safe="") + "/dispatch",
        headers={**ADMIN, "Idempotency-Key": "conflict-dispatch"},
        json={"expectedVersion": 1, "expectedInputRevision": conflict_plan["inputRevision"]},
    )
    assert response.status_code == 409


def test_snapshot_reports_configured_matrix_mode(client):
    response = client.get("/operations?date=" + DAY, headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["serviceMode"]["matrix"] == "fallback"
    assert response.json()["defaults"]["readinessPrior"] == 0.8
    assert response.json()["defaults"]["capacityBuffer"] == 0.1


def test_latest_read_keeps_active_trip_visible_after_newer_draft(client):
    plan, encoded, driver = plan_and_dispatch(client)
    newer = client.post("/plans", headers=ADMIN, json={"collectionDate": DAY, "targetKg": 75})
    assert newer.status_code == 200
    assert newer.json()["planKey"] != plan["planKey"]
    latest = client.get("/plans/" + DAY, headers=ADMIN).json()["plan"]
    assert latest["planKey"] == plan["planKey"] and latest["state"] == "DISPATCHED"
    assert client.get("/plans/" + encoded + "/driver", headers=driver).status_code == 200
