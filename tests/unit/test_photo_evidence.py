"""Real HTTP + Moto transactions + persisted image bytes, without real AWS requests."""

from __future__ import annotations

import base64
import hashlib
import json
import random
import struct
import zlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from urllib.parse import quote

import boto3
import pytest
from fastapi.testclient import TestClient
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.common.errors import ScreeningInvalid
from feedsure.common.v3 import ApiError
from feedsure.handlers.photos import LocalPhotoStore, validate_image
from feedsure.screening.validate import validate_photo_observations
from moto import mock_aws
from seed_data import ensure_v3_tables

DAY = "2026-10-12"
ADMIN = {"X-Admin-Token": "photo-admin"}


def png() -> bytes:
    """Generate a real deterministic PNG with checksummed chunks and compressed RGB data."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    rng = random.Random(81)
    pixels = b"".join(b"\x00" + rng.randbytes(64 * 3) for _ in range(64))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )


@pytest.fixture
def http(monkeypatch, tmp_path):
    monkeypatch.setenv("ADMIN_TOKEN", "photo-admin")
    monkeypatch.setenv("DRIVER_TOKEN_SECRET", "photo-driver-secret-with-at-least-32-characters")
    monkeypatch.setenv("MOCK_LOCATION", "true")
    monkeypatch.setenv("MOCK_BEDROCK", "true")
    monkeypatch.setenv("MOCK_BEDROCK_FIXTURE", "clean")
    with mock_aws():
        config = replace(get_config(), aws_endpoint_url="moto://in-process")
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        ensure_v3_tables(config, resource)
        database = DynamoDB(config, resource)
        for index, gid in enumerate(("hotel-a", "hotel-b")):
            database.put(
                "generators",
                {
                    "generatorId": gid,
                    "name": gid,
                    "type": "hotel",
                    "address": "Synthetic",
                    "lat": 12.685 + index * 0.001,
                    "lng": 77.474,
                    "simulated": True,
                    "pickupStart": "06:00",
                    "pickupEnd": "09:00",
                    "tokenHash": hashlib.sha256((gid + "-secret").encode()).hexdigest(),
                },
            )
        import dev_server

        monkeypatch.setattr(dev_server.app.state, "database", database, raising=False)
        monkeypatch.setattr(dev_server.app.state, "config", config, raising=False)
        monkeypatch.setattr(
            dev_server.app.state, "photo_store", LocalPhotoStore(tmp_path), raising=False
        )
        with TestClient(dev_server.app) as client:
            client.state = dev_server.app.state
            client.photo_root = tmp_path
            yield client


def auth(gid="hotel-a", key=None):
    headers = {"X-Generator-Token": gid + "-secret"}
    if key:
        headers["Idempotency-Key"] = key
    return headers


def ready(http, gid="hotel-a", status="READY"):
    response = http.post(
        "/submissions",
        headers=auth(gid),
        json={
            "generatorId": gid,
            "collectionDate": DAY,
            "status": status,
            "confirmedKg": 100,
            "weightSource": "SCALE",
            "window": {"start": "06:00", "end": "09:00"},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["submission"]


def prepare(http, gid="hotel-a"):
    response = http.post(
        "/uploads", headers=auth(gid), json={"generatorId": gid, "contentType": "image/png"}
    )
    assert response.status_code == 200, response.text
    return response.json()["uploads"][0]


def upload(http, prepared, data=None, gid="hotel-a"):
    return http.post(
        prepared["url"],
        headers={**auth(gid), "Content-Type": "image/png"},
        content=png() if data is None else data,
    )


def path(record, action):
    return "/submissions/" + quote(record["submissionId"], safe="") + "/" + action


def attach(http, record, key, *, event_key="attach", expected=None):
    return http.post(
        path(record, "photo"),
        headers=auth(key=event_key),
        json={
            "photoKey": key,
            "expectedPhotoRevision": record.get("photoRevision", 0)
            if expected is None
            else expected,
        },
    )


def screen(http, record, key="screen"):
    response = http.post(
        path(record, "screen"),
        headers=auth(key=key),
        json={"expectedPhotoRevision": record.get("photoRevision", 0)},
    )
    assert response.status_code == 200, response.text
    return response.json()["submission"]


def test_actual_bytes_retry_link_refresh_and_cross_kitchen_isolation(http):
    record = ready(http)
    prepared = prepare(http)
    assert upload(http, prepared).status_code == 204
    assert upload(http, prepared).status_code == 204  # dropped upload response retry
    assert upload(http, prepared, png() + b"different").status_code == 400
    assert upload(http, prepared, gid="hotel-b").status_code == 401
    assert (http.photo_root / prepared["key"]).read_bytes() == png()
    response = attach(http, record, prepared["key"])
    assert response.status_code == 200, response.text
    assert attach(http, record, prepared["key"]).json() == response.json()  # dropped link response
    saved = response.json()["submission"]
    assert saved["confirmedKg"] == record["confirmedKg"] and saved["status"] == "READY"
    assert attach(http, record, None).status_code == 409  # changed dedup payload
    assert attach(http, record, prepared["key"], event_key="stale", expected=0).status_code == 409
    evidence = http.get(path(saved, "evidence"), headers=auth())
    assert evidence.status_code == 200
    assert base64.b64decode(evidence.json()["url"].split(",")[1]) == png()
    assert http.get(path(saved, "evidence"), headers=auth("hotel-b")).status_code == 401
    assert http.get(path(saved, "evidence"), headers=ADMIN).status_code == 200
    assert (
        http.post(
            path(saved, "screen"),
            headers=auth("hotel-b", "stolen"),
            json={"expectedPhotoRevision": 1},
        ).status_code
        == 401
    )
    assert (
        http.get("/generators/hotel-a/readiness?date=" + DAY, headers=auth("hotel-b")).status_code
        == 401
    )
    analyzed = screen(http, saved)
    assert analyzed["photoStatus"] == "NO_ISSUE_OBSERVED"
    assert analyzed["analysis"]["mode"] == "mock"
    assert "visible_contaminant_pct" not in analyzed["analysis"]["observations"]
    refreshed = http.get("/generators/hotel-a/readiness?date=" + DAY, headers=auth()).json()[
        "submission"
    ]
    assert refreshed == analyzed
    assert http.get(path(analyzed, "evidence")).status_code == 401


@pytest.mark.parametrize(
    "data,content_type",
    [
        (b"fake" * 400, "image/jpeg"),
        (b"fake" * 400, "image/png"),
        (b"", "image/png"),
        (b"x" * 3_500_001, "image/png"),
    ],
    ids=["fake-jpeg", "fake-png", "empty", "oversized"],
)
def test_invalid_bytes_never_link_or_lose_readiness(http, data, content_type):
    record = ready(http)
    prepared = prepare(http)
    response = http.post(
        prepared["url"], headers={**auth(), "Content-Type": content_type}, content=data
    )
    assert response.status_code == 400
    assert attach(http, record, prepared["key"]).status_code == 404
    head = http.get("/generators/hotel-a/readiness?date=" + DAY, headers=auth()).json()[
        "submission"
    ]
    assert head["submissionId"] == record["submissionId"] and head["photoKeys"] == []


def test_hazard_stays_after_failed_analysis_removal_and_new_readiness(http, monkeypatch):
    record = ready(http)
    prepared = prepare(http)
    assert upload(http, prepared).status_code == 204
    record = attach(http, record, prepared["key"]).json()["submission"]
    http.state.config = replace(http.state.config, mock_bedrock_fixture="hazard")
    record = screen(http, record)
    assert record["photoStatus"] == "REVIEW_HAZARD"  # hazard outranks blurry
    http.state.config = replace(http.state.config, mock_bedrock_fixture="malformed")
    import feedsure.handlers.photos as photos

    fixture = Mock(side_effect=ValueError("provider failed"))
    monkeypatch.setattr(photos, "load_fixture", fixture)
    record = screen(http, record, "screen-failure")
    assert fixture.call_count == 2
    assert record["photoStatus"] == "NOT_CHECKED" and record["analysis"]["state"] == "FAILED"
    assert record["status"] == "READY"
    removed = attach(http, record, None, event_key="remove").json()["submission"]
    assert removed["photoKeys"] == []
    assert http.get("/generators/hotel-a/readiness?date=" + DAY, headers=auth()).json()[
        "unresolvedHazard"
    ]
    ready(http, status="NOT_READY")
    assert http.get("/generators/hotel-a/readiness?date=" + DAY, headers=auth()).json()[
        "unresolvedHazard"
    ]
    assert attach(http, removed, prepared["key"], event_key="old-readiness").status_code == 409
    response = http.post(
        "/generators/hotel-a/hazard-reviews",
        headers=ADMIN,
        json={
            "collectionDate": DAY,
            "action": "RESOLVE",
            "reason": "Human inspected and removed glass.",
        },
    )
    assert response.status_code == 200
    assert (
        http.get("/generators/hotel-a/readiness?date=" + DAY, headers=auth()).json()[
            "unresolvedHazard"
        ]
        is None
    )


def test_photo_change_stales_draft_and_preserves_dispatched_snapshot(http):
    record = ready(http)
    plan = http.post("/plans", headers=ADMIN, json={"collectionDate": DAY}).json()
    prepared = prepare(http)
    assert upload(http, prepared).status_code == 204
    record = attach(http, record, prepared["key"]).json()["submission"]
    payload = {"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]}
    assert (
        http.post(
            "/plans/" + quote(plan["planKey"], safe="") + "/dispatch",
            headers={**ADMIN, "Idempotency-Key": "stale-plan"},
            json=payload,
        ).status_code
        == 409
    )
    plan = http.post("/plans", headers=ADMIN, json={"collectionDate": DAY}).json()
    encoded = quote(plan["planKey"], safe="")
    dispatched = http.post(
        "/plans/" + encoded + "/dispatch",
        headers={**ADMIN, "Idempotency-Key": "dispatch"},
        json={"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]},
    )
    assert dispatched.status_code == 200, dispatched.text
    frozen = dispatched.json()["plan"]["inputs"]
    http.state.config = replace(http.state.config, mock_bedrock_fixture="hazard")
    screen(http, record)
    latest = http.get("/plans/" + encoded + "/details", headers=ADMIN).json()
    assert latest["plan"]["inputs"] == frozen and latest["alerts"]
    driver = {
        "X-Driver-Token": dispatched.json()["driverAccess"]["token"],
        "Idempotency-Key": "load-hazard",
    }
    assert (
        http.post(
            "/pickups",
            headers=driver,
            json={
                "planKey": plan["planKey"],
                "generatorId": "hotel-a",
                "outcome": "COLLECTED",
                "kg": 100,
                "weightSource": "SCALE",
                "expectedRevision": 0,
            },
        ).status_code
        == 409
    )


def test_missing_photo_and_not_ready_work_without_model(http):
    record = ready(http)
    assert record["photoStatus"] == "NOT_CHECKED"
    assert (
        http.post(
            path(record, "screen"), headers=auth(key="no-photo"), json={"expectedPhotoRevision": 0}
        ).status_code
        == 400
    )
    assert ready(http, "hotel-b", "NOT_READY")["status"] == "NOT_READY"


def test_image_structure_and_retention(tmp_path):
    config = get_config()
    validate_image(png(), "image/png", config)
    with pytest.raises(ApiError):
        validate_image(png()[:-12], "image/png", config)
    data = bytearray(png())
    data[45] ^= 1
    with pytest.raises(ApiError):
        validate_image(bytes(data), "image/png", config)
    store = LocalPhotoStore(tmp_path)
    service = Mock(config=config, now=datetime.now(UTC))
    key = "submissions/hotel-a/" + "a" * 32 + ".png"
    store.issue(key, "image/png", service)
    store.put(key, png(), "image/png", service)
    service.now += timedelta(days=31)
    with pytest.raises(ApiError):
        store.get(key, service)
    assert not store.paths(key)[0].exists()
    with pytest.raises(ApiError):
        store.paths("submissions/hotel-a/../../credentials")


def test_strict_observation_schema():
    valid = {
        "items": [],
        "hazard": False,
        "image_quality": "ok",
        "confidence": 0.8,
        "notes": "Visible surface",
    }
    assert validate_photo_observations(json.dumps(valid))["items"] == []
    for invalid in (
        {**valid, "verdict": "ACCEPT"},
        {**valid, "confidence": 3},
        {**valid, "hazard": "false"},
        {**valid, "items": [{"type": "unknown", "count": 1, "confidence": 0.8}]},
    ):
        with pytest.raises(ScreeningInvalid):
            validate_photo_observations(json.dumps(invalid))
