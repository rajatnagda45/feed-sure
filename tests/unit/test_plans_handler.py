"""Moto-backed M4 plan-handler tests."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import boto3
import pytest
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.handlers.operations import Service
from feedsure.handlers.plans import handle_create_plan
from moto import mock_aws
from seed_data import ensure_v3_tables


def _event(token: str = "secret", **changes: object) -> dict[str, object]:
    body: dict[str, object] = {
        "collectionDate": "2026-10-10",
        "targetKg": 80,
        "truckCapacityKg": 100,
    }
    body.update(changes)
    return {"headers": {"X-Admin-Token": token}, "body": json.dumps(body)}


def _tables(resource: object, config: object) -> None:
    resource.create_table(
        TableName=config.generators_table,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "generatorId", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "generatorId", "KeyType": "HASH"}],
    )
    resource.create_table(
        TableName=config.history_table,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "generatorId", "AttributeType": "S"},
            {"AttributeName": "date", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "generatorId", "KeyType": "HASH"},
            {"AttributeName": "date", "KeyType": "RANGE"},
        ],
    )
    resource.create_table(
        TableName=config.submissions_table,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "generatorId", "AttributeType": "S"},
            {"AttributeName": "ts", "AttributeType": "S"},
            {"AttributeName": "date", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "generatorId", "KeyType": "HASH"},
            {"AttributeName": "ts", "KeyType": "RANGE"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "byDate",
                "KeySchema": [
                    {"AttributeName": "date", "KeyType": "HASH"},
                    {"AttributeName": "ts", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )
    resource.create_table(
        TableName=config.plans_table,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "date", "AttributeType": "S"},
            {"AttributeName": "planId", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "date", "KeyType": "HASH"},
            {"AttributeName": "planId", "KeyType": "RANGE"},
        ],
    )


@mock_aws
def test_plan_handler_authenticates_uses_fallback_and_persists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STAGE", "plan-test")
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    monkeypatch.setenv("MOCK_LOCATION", "true")
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    config = get_config()
    resource = boto3.resource("dynamodb", region_name=config.aws_region)
    ensure_v3_tables(config, resource)
    database = DynamoDB(config=config, resource=resource)
    database.put(
        "generators",
        {
            "generatorId": "hotel-a",
            "lat": 12.682,
            "lng": 77.474,
            "pickupStart": "06:00",
            "pickupEnd": "09:00",
            "priorAccept": 0.7,
            "priorContamPct": 2,
            "simulated": True,
        },
    )
    database.put("history", {"generatorId": "hotel-a", "date": "2026-10-08", "kg": 60})
    database.put(
        "submissions",
        {
            "generatorId": "hotel-a",
            "ts": "2026-10-09T18:00:00Z",
            "date": "2026-10-09",
            "reportedKg": 90,
            "verdict": "ACCEPT",
            "visibleContaminantPct": 0,
        },
    )
    now = datetime(2026, 10, 9, 19, tzinfo=UTC)

    readiness_service = Service({"headers": {"X-Admin-Token": "secret"}}, config, database, now)
    readiness_service.readiness(
        {
            "generatorId": "hotel-a",
            "collectionDate": "2026-10-10",
            "status": "READY",
            "confirmedKg": 90,
            "weightSource": "ESTIMATE",
            "window": {"start": "06:00", "end": "09:00"},
            "confirmedBy": "Synthetic supervisor",
            "reason": "Phone confirmation",
        }
    )
    unauthorized = handle_create_plan(_event("wrong"), config=config, database=database, now=now)
    response = handle_create_plan(_event(), config=config, database=database, now=now)

    assert unauthorized["statusCode"] == 401
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["planId"].startswith("2026-10-10#p-")
    assert body["matrixSource"] == "fallback"
    assert body["plan"]["stops"][0]["generatorId"] == "hotel-a"
    assert body["plan"]["totals"]["reservedLoadKg"] == 99.0
    assert body["plan"]["totals"]["expectedCollectionKg"] == 72.0
    short_id = body["planId"].split("#", 1)[1]
    stored = database.get("plans", {"date": "2026-10-10", "planId": short_id})
    assert stored is not None
    for key in (
        "collectionDate",
        "simulated",
        "matrixSource",
        "params",
        "plan",
        "baseline",
        "shortfall",
        "excluded",
    ):
        assert stored[key] == body[key]


def test_plan_request_rejects_bad_date_values_and_large_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    config = get_config()
    bad_date = handle_create_plan(_event(collectionDate="2026-02-30"), config=config)
    bad_capacity = handle_create_plan(_event(truckCapacityKg=0), config=config)
    huge = handle_create_plan(
        {"headers": {"x-admin-token": "secret"}, "body": "{" + " " * 17000 + "}"},
        config=config,
    )
    assert bad_date["statusCode"] == 400
    assert bad_capacity["statusCode"] == 400
    assert huge["statusCode"] == 400
