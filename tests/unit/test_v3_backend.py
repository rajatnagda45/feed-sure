"""Moto-backed persistence/auth tests; injected saved fixtures are not a runtime planner."""

from __future__ import annotations

import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import quote

import boto3
import pytest
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.handlers.operations import handle_request
from moto import mock_aws
from seed_data import ensure_v3_tables, seed_v3_database

CONTRACTS = Path(__file__).parents[1] / "contracts"
NOW = datetime(2026, 10, 10, 13, tzinfo=UTC)
DAY = "2026-10-11"


def fixture(name: str) -> dict:
    return json.loads((CONTRACTS / (name + ".json")).read_text(encoding="utf-8"))


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-dispatcher")
    monkeypatch.setenv("DRIVER_TOKEN_SECRET", "test-only-secret-not-a-production-credential")
    monkeypatch.setenv("MOCK_LOCATION", "true")
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    with mock_aws():
        config = get_config()
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        ensure_v3_tables(config, resource)
        database = DynamoDB(config, resource)
        for gid in ("hotel-a", "hostel-b"):
            database.put(
                "generators",
                {
                    "generatorId": gid,
                    "name": "Fictional " + gid,
                    "lat": 12.69,
                    "lng": 77.474,
                    "type": "hotel",
                    "simulated": True,
                    "pickupStart": "06:00",
                    "pickupEnd": "09:00",
                    "tokenHash": hashlib.sha256((gid + "-token").encode()).hexdigest(),
                },
            )
        planner = Mock(side_effect=lambda _inputs: copy.deepcopy(fixture("planner-result")))
        reconciler = Mock(
            side_effect=lambda _inputs: copy.deepcopy(fixture("reconciliation-result"))
        )

        def call(
            path,
            method="GET",
            payload=None,
            *,
            role="admin",
            token=None,
            key="test-key",
            now=NOW,
            query=None,
        ):
            name = {
                "admin": "X-Admin-Token",
                "generator": "X-Generator-Token",
                "driver": "X-Driver-Token",
            }[role]
            token = token if token is not None else "test-dispatcher"
            event = {
                "rawPath": path,
                "headers": {name: token, "Idempotency-Key": key},
                "body": json.dumps(payload) if payload is not None else None,
                "queryStringParameters": query or {},
                "requestContext": {"http": {"method": method}},
            }
            result = handle_request(
                event,
                config=config,
                database=database,
                now=now,
                planner=planner,
                reconciler=reconciler,
            )
            return result["statusCode"], json.loads(result["body"])

        call.db, call.config, call.planner, call.reconciler = database, config, planner, reconciler
        yield call


def confirm(api, gid="hotel-a", **changes):
    payload = {**fixture("ready-request"), "generatorId": gid, **changes}
    return api("/submissions", "POST", payload, role="generator", token=gid + "-token")


def draft(api):
    assert confirm(api)[0] == 200
    assert confirm(api, "hostel-b", confirmedKg=200)[0] == 200
    # Calculation fixture mirrors this test's two confirmations; not a replacement algorithm.
    api.planner.side_effect = lambda inputs: {
        **copy.deepcopy(fixture("planner-result")),
        "inputRevision": inputs["inputRevision"],
        "params": inputs["params"],
    }
    status, plan = api("/plans", "POST", {"collectionDate": DAY, "targetKg": 200})
    assert status == 200, plan
    return plan


def dispatch(api, plan=None):
    plan = plan or draft(api)
    path = "/plans/" + quote(plan["planKey"], safe="") + "/dispatch"
    request = {"expectedVersion": plan["version"], "expectedInputRevision": plan["inputRevision"]}
    status, response = api(path, "POST", request, key="dispatch-1")
    assert status == 200, response
    return response, path, request


def collect(api, dispatched, **changes):
    request = {**fixture("collected-request"), "planKey": dispatched["plan"]["planKey"], **changes}
    return api(
        "/pickups",
        "POST",
        request,
        role="driver",
        token=dispatched["driverAccess"]["token"],
        key=changes.pop("_key", "pickup-1"),
    )


def test_readiness_is_durable_without_s3_bedrock_and_unique_at_same_instant(api):
    first_status, first = confirm(api)
    second_status, second = confirm(api, confirmedKg=120)
    assert first_status == second_status == 200
    assert first["submission"]["submissionId"] != second["submission"]["submissionId"]
    assert second["inputRevision"] == first["inputRevision"] + 1
    status, snapshot = api("/operations", query={"date": DAY})
    assert status == 200
    assert (
        next(g for g in snapshot["generators"] if g["generatorId"] == "hotel-a")["readinessStatus"]
        == "READY"
    )
    assert (
        next(g for g in snapshot["generators"] if g["generatorId"] == "hotel-a")["readiness"][
            "confirmedKg"
        ]
        == 120
    )
    assert (
        next(g for g in snapshot["generators"] if g["generatorId"] == "hostel-b")["readinessStatus"]
        == "UNCONFIRMED"
    )
    assert first["submission"]["simulated"] is True
    assert first["submission"]["photoStatus"] == "NOT_CHECKED"
    assert first["submission"]["recordedAt"].startswith("2026-10-10")
    assert first["submission"]["collectionDate"] == DAY
    api.planner.assert_not_called()


@pytest.mark.parametrize(
    "change",
    [
        {"confirmedKg": float("nan")},
        {"confirmedKg": float("inf")},
        {"confirmedKg": -1},
        {"confirmedKg": True},
        {"collectionDate": "2026-02-30"},
        {"window": {"start": "23:00", "end": "01:00"}},
        {"window": {"start": "06:00", "end": "06:00"}},
        {"photoKeys": ["submissions/hostel-b/stolen.jpg"]},
    ],
)
def test_invalid_readiness_does_not_write(api, change):
    assert confirm(api, **change)[0] == 400
    assert api.db.scan("submissions") == []


def test_not_ready_normalises_and_legacy_does_not_confirm(api):
    api.db.put(
        "submissions",
        {
            "generatorId": "hostel-b",
            "ts": "legacy",
            "date": DAY,
            "verdict": "ACCEPT",
            "reportedKg": 200,
        },
    )
    status, response = confirm(api, status="NOT_READY", confirmedKg=999, photoKeys=["old"])
    assert status == 200
    record = response["submission"]
    assert record["confirmedKg"] == 0 and record["weightSource"] is None
    assert record["window"] is None and record["photoKeys"] == []
    _, snapshot = api("/operations", query={"date": DAY})
    assert (
        next(g for g in snapshot["generators"] if g["generatorId"] == "hostel-b")["readinessStatus"]
        == "UNCONFIRMED"
    )


def test_auth_phone_confirmation_hazard_and_late_update(api):
    assert confirm(api)[0] == 200
    assert api("/operations", token="wrong", query={"date": DAY})[0] == 401
    assert api("/generators/hotel-a", role="generator", token="hostel-b-token")[0] == 401
    payload = {
        **fixture("ready-request"),
        "confirmedBy": "Kitchen supervisor",
        "reason": "Confirmed by phone",
    }
    status, response = api("/submissions", "POST", payload, now=NOW + timedelta(hours=3))
    assert status == 200 and response["submission"]["late"] is True
    assert response["submission"]["actor"] == {"type": "ADMIN", "id": "dispatcher"}
    status, hazard = api(
        "/generators/hotel-a/hazard-reviews",
        "POST",
        {"collectionDate": DAY, "action": "ENTER", "reason": "Glass seen"},
    )
    assert status == 200
    _, snapshot = api("/operations", query={"date": DAY})
    assert next(g for g in snapshot["generators"] if g["generatorId"] == "hotel-a")[
        "unresolvedHazards"
    ]
    status, resolved = api(
        "/generators/hotel-a/hazard-reviews",
        "POST",
        {"collectionDate": DAY, "action": "RESOLVE", "reason": "Removed"},
    )
    assert status == 200 and resolved["inputRevision"] == hazard["inputRevision"] + 1
    assert len(api.db.scan("mutation_log")) == 2


def test_no_plan_is_explicit_and_history_excludes_future(api):
    assert api("/plans/" + DAY) == (200, {"plan": None})
    for day in ("2026-10-09", DAY, "2026-10-12"):
        api.db.put("history", {"generatorId": "hotel-a", "date": day, "kg": 100})
    plan = draft(api)
    assert [r["date"] for r in api.planner.call_args.args[0]["history"]["hotel-a"]] == [
        "2026-10-09"
    ]
    _, latest = api("/plans/" + DAY)
    assert latest["plan"]["planKey"] == plan["planKey"]
    assert latest["plan"]["state"] == "DRAFT"
    assert "driverTokenHash" not in json.dumps(latest)


def test_stale_dispatch_after_confirmation_and_hazard(api):
    plan = draft(api)
    assert confirm(api, status="NOT_READY")[0] == 200
    request = {"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]}
    assert api("/plans/" + plan["planKey"] + "/dispatch", "POST", request)[0] == 409
    assert api.db.scan("pickups") == []
    assert (
        api(
            "/generators/hotel-a/hazard-reviews",
            "POST",
            {"collectionDate": DAY, "action": "ENTER", "reason": "Glass"},
        )[0]
        == 200
    )
    assert api("/plans/" + plan["planKey"] + "/dispatch", "POST", request)[0] == 409


def test_confirmation_racing_dispatch_is_atomically_rejected(api, monkeypatch):
    plan = draft(api)
    original = api.db.transact
    raced = False

    def race(actions):
        nonlocal raced
        if not raced and actions[0].get("Put", {}).get("Item", {}).get("activePlanKey"):
            raced = True
            assert confirm(api, status="NOT_READY")[0] == 200
        return original(actions)

    monkeypatch.setattr(api.db, "transact", race)
    status, _ = api(
        "/plans/" + plan["planKey"] + "/dispatch",
        "POST",
        {"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]},
    )
    assert raced and status == 409
    assert (
        api.db.get("plans", {"date": DAY, "planId": plan["planKey"].split("#")[1]})["state"]
        == "DRAFT"
    )
    assert api.db.scan("mutation_log") == []


def test_dispatch_retry_scoped_access_expiry_and_frozen_stops(api):
    response, path, request = dispatch(api)
    assert api(path, "POST", request, key="dispatch-1")[1] == response
    assert api(path, "POST", {**request, "expectedVersion": 99}, key="dispatch-1")[0] == 409
    logs = json.dumps(api.db.scan("mutation_log"))
    assert response["driverAccess"]["token"] not in logs
    assert confirm(api, status="NOT_READY")[0] == 200
    driver_path = path.replace("/dispatch", "/driver")
    _, driver = api(driver_path, role="driver", token=response["driverAccess"]["token"])
    assert len(driver["plan"]["plan"]["stops"]) == 2
    assert driver["alerts"][0]["code"] == "INPUTS_CHANGED"
    assert api(driver_path, role="driver", token="wrong")[0] == 401
    assert (
        api(
            driver_path,
            role="driver",
            token=response["driverAccess"]["token"],
            now=NOW + timedelta(hours=13),
        )[0]
        == 401
    )


def test_pickup_retry_correction_no_double_count_and_gps_unknown(api):
    response, _, _ = dispatch(api)
    status, first = collect(api, response)
    assert status == 200, first
    assert first["pickup"]["gpsStatus"] == "UNKNOWN"
    assert collect(api, response)[1] == first
    assert collect(api, response, kg=99)[0] == 409
    payload = {
        **fixture("collected-request"),
        "planKey": response["plan"]["planKey"],
        "kg": 90,
        "expectedRevision": 1,
        "correctionReason": "Scale correction",
    }
    status, corrected = api(
        "/pickups",
        "POST",
        payload,
        role="driver",
        token=response["driverAccess"]["token"],
        key="correction-1",
    )
    assert status == 200 and corrected["pickup"]["revision"] == 2
    rows = api.db.scan("pickups")
    assert len(rows) == 1 and sum(r["kg"] for r in rows) == 90
    audits = [r for r in api.db.scan("mutation_log") if r["idempotencyKey"].startswith("AUDIT#")]
    assert all("ttl" not in r for r in audits)
    assert any(r["previous"].get("kg") == 98 for r in audits)
    assert collect(api, response, generatorId="unknown")[0] == 401


def test_partial_gate_and_own_generator_record(api):
    response, _, _ = dispatch(api)
    payload = {
        **fixture("partial-request"),
        "planKey": response["plan"]["planKey"],
        "gps": {"lat": 12.69, "lng": 77.474, "accuracyM": 300, "deviceAt": None},
    }
    status, result = api(
        "/pickups",
        "POST",
        payload,
        role="driver",
        token=response["driverAccess"]["token"],
        key="partial-1",
    )
    assert status == 200 and result["pickup"]["gpsStatus"] == "UNKNOWN"
    assert result["pickup"]["remainingKg"] == 40
    gate = {**fixture("gate-request"), "planKey": response["plan"]["planKey"]}
    status, gate_result = api("/gate-logs", "POST", gate, key="gate-1")
    assert status == 200
    assert api("/gate-logs", "POST", gate, key="gate-1")[1] == gate_result
    assert (
        api(
            "/gate-logs",
            "POST",
            {
                **gate,
                "grossKg": 10,
                "tareKg": 20,
                "expectedRevision": 1,
                "correctionReason": "Test",
            },
            key="badgate",
        )[0]
        == 400
    )
    assert (
        api(
            "/gate-logs",
            "POST",
            {**gate, "netKg": float("inf"), "expectedRevision": 1, "correctionReason": "Test"},
            key="badgate2",
        )[0]
        == 400
    )
    assert (
        api("/generators/hotel-a/receipts", role="generator", token="hotel-a-token")[1]["records"]
        == []
    )
    _, own = api(
        "/generators/hostel-b/receipts",
        role="generator",
        token="hostel-b-token",
        query={"month": "2026-10"},
    )
    assert len(own["records"]) == 1 and own["records"][0]["pickup"]["generatorId"] == "hostel-b"
    assert "allocatedGateKg" not in json.dumps(own)
    # Reconciliation math is Session 2's responsibility; validate exact inputs here.
    assert api.reconciler.call_args.args[0]["stops"][0]["pickup"] is None


def test_transaction_failure_rolls_back_pickup_and_audit(api, monkeypatch):
    response, _, _ = dispatch(api)
    original = api.db.transact
    before_logs = api.db.scan("mutation_log")

    def fail_condition(actions):
        actions[0]["Put"]["ConditionExpression"] = "attribute_exists(impossible)"
        return original(actions)

    monkeypatch.setattr(api.db, "transact", fail_condition)
    assert collect(api, response)[0] == 409
    assert api.db.scan("pickups") == []
    assert api.db.scan("mutation_log") == before_logs


def test_v3_seed_is_local_only_and_preserves_edits(api):
    from dataclasses import replace

    with pytest.raises(ValueError, match="local"):
        seed_v3_database(api.config, api.db.resource, datetime.fromisoformat(DAY).date())
    local = replace(api.config, aws_endpoint_url="http://localhost:5000")
    tokens = seed_v3_database(local, api.db.resource, datetime.fromisoformat(DAY).date())
    assert len(tokens) == 10
    edited = api.db.get("generators", {"generatorId": "demo-kitchen-01"})
    edited["name"] = "Preserved user edit"
    api.db.put("generators", edited)
    assert seed_v3_database(local, api.db.resource, datetime.fromisoformat(DAY).date()) == {}
    assert (
        api.db.get("generators", {"generatorId": "demo-kitchen-01"})["name"]
        == "Preserved user edit"
    )
