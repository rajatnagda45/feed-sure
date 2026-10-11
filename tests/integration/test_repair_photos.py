"""Photo bytes, privacy and model failure through real HTTP handlers and Moto storage."""

from __future__ import annotations

import base64
import hashlib
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from urllib.parse import quote

import boto3
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.common.v3 import ApiError
from feedsure.handlers.operations import Service
from feedsure.handlers.photos import LocalPhotoStore, Photos, validate_image
from moto import mock_aws
from photo_fixture import png
from seed_data import seed_v3_database

DAY = "2026-10-12"
GID = "demo-kitchen-01"
OTHER = "demo-kitchen-02"


@pytest.fixture
def photo_http(monkeypatch, tmp_path):
    monkeypatch.setenv("ADMIN_TOKEN", "photo-test-admin")
    monkeypatch.setenv("DRIVER_TOKEN_SECRET", "photo-tests-driver-secret-at-least-32-characters")
    monkeypatch.setenv("MOCK_LOCATION", "true")
    monkeypatch.setenv("MOCK_BEDROCK", "true")
    monkeypatch.setenv("MOCK_BEDROCK_FIXTURE", "clean")
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    with mock_aws():
        config = replace(get_config(), aws_endpoint_url="moto://in-process")
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        tokens = seed_v3_database(config, resource, date.fromisoformat(DAY))
        database = DynamoDB(config, resource)
        import dev_server

        monkeypatch.setattr(dev_server.app.state, "config", config, raising=False)
        monkeypatch.setattr(dev_server.app.state, "database", database, raising=False)
        monkeypatch.setattr(
            dev_server.app.state, "photo_store", LocalPhotoStore(tmp_path), raising=False
        )
        with TestClient(dev_server.app) as http:
            http.tokens, http.db, http.state = tokens, database, dev_server.app.state
            yield http


def auth(http, gid=GID):
    return {"X-Generator-Token": http.tokens[gid]}


def saved(http, **changes):
    response = http.post(
        "/submissions",
        headers=auth(http),
        json={
            "generatorId": GID,
            "collectionDate": DAY,
            "status": "READY",
            "confirmedKg": 100,
            "weightSource": "ESTIMATE",
            "window": {"start": "06:00", "end": "09:00"},
            **changes,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["submission"]


def prepare(http):
    response = http.post(
        "/uploads",
        headers=auth(http),
        json={
            "generatorId": GID,
            "contentType": "image/png",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["uploads"][0]


def mutation(http, record, action, payload=None, key="photo-test", headers=None):
    return http.post(
        "/submissions/" + quote(record["submissionId"], safe="") + "/" + action,
        headers={**(headers or auth(http)), "Idempotency-Key": key},
        json={"expectedPhotoRevision": record.get("photoRevision", 0), **(payload or {})},
    )


def attached(http, record=None):
    record = record or saved(http)
    upload = prepare(http)
    response = http.post(
        upload["url"], headers={**auth(http), "Content-Type": "image/png"}, content=png()
    )
    assert response.status_code == 204, response.text
    response = mutation(http, record, "photo", {"photoKey": upload["key"]})
    assert response.status_code == 200, response.text
    return response.json()["submission"], upload


def evidence(http, record, headers=None):
    return http.get(
        "/submissions/" + quote(record["submissionId"], safe="") + "/evidence",
        headers=headers or auth(http),
    )


def test_actual_bytes_persist_refresh_and_retry(photo_http):
    http = photo_http
    record, upload = attached(http)
    again = http.post(
        upload["url"], headers={**auth(http), "Content-Type": "image/png"}, content=png()
    )
    assert again.status_code == 204
    retry = mutation(http, {**record, "photoRevision": 0}, "photo", {"photoKey": upload["key"]})
    assert retry.status_code == 200 and retry.json()["submission"] == record
    assert (
        record["photoRevision"] == 1 and record["photoSha256"] == hashlib.sha256(png()).hexdigest()
    )
    read = evidence(http, record)
    assert read.status_code == 200 and read.headers["cache-control"] == "no-store"
    assert base64.b64decode(read.json()["url"].split(",", 1)[1]) == png()
    root = http.state.photo_store.root
    assert (root / upload["key"]).read_bytes() == png()
    http.state.photo_store = LocalPhotoStore(root)  # New store instance still reads disk bytes.
    assert evidence(http, record).json() == read.json()
    fresh = http.get(f"/generators/{GID}/readiness?date={DAY}", headers=auth(http)).json()
    assert fresh["submission"] == record
    assert mutation(http, record, "photo", {"photoKey": None}, key="photo-test").status_code == 409


def test_cross_kitchen_and_unauthenticated_upload_attach_view_screen(photo_http):
    http = photo_http
    record, upload = attached(http)
    wrong = auth(http, OTHER)
    for headers in ({}, wrong):
        assert (
            http.post(
                upload["url"], headers={**headers, "Content-Type": "image/png"}, content=png()
            ).status_code
            == 401
        )
        assert (
            evidence(http, record, headers={**headers, "accept": "application/json"}).status_code
            == 401
        )
        assert (
            mutation(
                http, record, "screen", headers={**headers, "accept": "application/json"}
            ).status_code
            == 401
        )
        assert (
            mutation(
                http,
                record,
                "photo",
                {"photoKey": None},
                headers={**headers, "accept": "application/json"},
            ).status_code
            == 401
        )
    own_other = http.post(
        "/uploads", headers=wrong, json={"generatorId": OTHER, "contentType": "image/png"}
    ).json()["uploads"][0]
    assert (
        mutation(http, record, "photo", {"photoKey": own_other["key"]}, key="cross-key").status_code
        == 400
    )
    assert evidence(http, record, headers={"X-Admin-Token": "photo-test-admin"}).status_code == 200


@pytest.mark.parametrize(
    "data,content_type",
    [
        (b"pretend JPEG" * 100, "image/jpeg"),
        (png()[:-20], "image/png"),
        (png(), "image/jpeg"),
        (b"x" * 3_500_001, "image/png"),
        (b"", "image/png"),
        (png()[:100] + b"bad" + png()[103:], "image/png"),
    ],
    ids=["fake-jpeg", "truncated-png", "wrong-type", "oversized", "empty", "bad-crc"],
)
def test_invalid_bytes_do_not_attach_or_change_readiness(photo_http, data, content_type):
    http = photo_http
    record = saved(http)
    upload = prepare(http)
    response = http.post(
        upload["url"], headers={**auth(http), "Content-Type": content_type}, content=data
    )
    assert response.status_code == 400
    assert mutation(http, record, "photo", {"photoKey": upload["key"]}).status_code == 404
    fresh = http.get(f"/generators/{GID}/readiness?date={DAY}", headers=auth(http)).json()[
        "submission"
    ]
    assert fresh == record and fresh["photoKeys"] == []


@pytest.mark.parametrize(
    "fixture,status,state",
    [
        ("auto", "NO_ISSUE_OBSERVED", "COMPLETE"),
        ("clean", "NO_ISSUE_OBSERVED", "COMPLETE"),
        ("plastic", "ADVICE", "COMPLETE"),
        ("low_confidence", "ADVICE", "COMPLETE"),
        ("hazard", "REVIEW_HAZARD", "COMPLETE"),
        ("malformed", "NOT_CHECKED", "FAILED"),
    ],
)
def test_analysis_states_are_observation_only_explicit_mock(photo_http, fixture, status, state):
    http = photo_http
    record, _ = attached(http)
    http.state.config = replace(http.state.config, mock_bedrock_fixture=fixture)
    response = mutation(http, record, "screen", key="analysis-state")
    assert response.status_code == 200, response.text
    result = response.json()["submission"]
    assert result["photoStatus"] == status and result["analysis"]["state"] == state
    assert result["analysis"]["mode"] == "mock"
    assert result["status"] == "READY" and result["confirmedKg"] == record["confirmedKg"]
    assert "visible_contaminant_pct" not in str(result["analysis"])
    assert "verdict" not in str(result["analysis"])
    if state == "COMPLETE":
        assert "does not describe the selected photo" in result["analysis"]["observations"]["notes"]
    assert mutation(http, record, "screen", key="analysis-state").json() == response.json()


def test_hazard_survives_failed_real_model_and_photo_removal(photo_http, monkeypatch):
    http = photo_http
    record, _ = attached(http)
    http.state.config = replace(http.state.config, mock_bedrock_fixture="hazard")
    record = mutation(http, record, "screen", key="hazard-analysis").json()["submission"]
    calls = []

    def unavailable(*args):
        calls.append(args)
        raise RuntimeError("private upstream detail")

    monkeypatch.setattr("feedsure.handlers.photos.invoke_screening", unavailable)
    http.state.config = replace(http.state.config, mock_bedrock=False, aws_endpoint_url="")
    failed = mutation(http, record, "screen", key="failed-analysis")
    assert failed.status_code == 200 and len(calls) == 2
    record = failed.json()["submission"]
    assert record["photoStatus"] == "NOT_CHECKED" and record["analysis"]["mode"] == "aws"
    assert "private" not in failed.text
    record = mutation(http, record, "photo", {"photoKey": None}, key="remove").json()["submission"]
    assert record["photoKeys"] == [] and record["analysis"] is None
    assert evidence(http, record).status_code == 404
    fresh = http.get(f"/generators/{GID}/readiness?date={DAY}", headers=auth(http)).json()
    assert fresh["unresolvedHazard"]["action"] == "ENTER"
    assert fresh["unresolvedHazard"]["source"] == "mock"


def test_no_photo_ready_and_not_ready_never_call_storage_or_model(photo_http, monkeypatch):
    def forbidden(*_args):
        pytest.fail("Readiness must not call a photo/model service")

    monkeypatch.setattr(Photos, "s3", forbidden)
    monkeypatch.setattr("feedsure.handlers.photos.invoke_screening", forbidden)
    for status in ("READY", "NOT_READY"):
        record = saved(photo_http, status=status)
        assert record["status"] == status and record["photoKeys"] == []
        assert mutation(photo_http, record, "screen", key=status).status_code == 400


def test_failed_upload_preparation_does_not_affect_saved_ready(photo_http, monkeypatch):
    record = saved(photo_http)
    photo_http.state.photo_store = None

    def unavailable(_self):
        raise ClientError({"Error": {"Code": "InternalError", "Message": "secret"}}, "Post")

    monkeypatch.setattr(Photos, "s3", unavailable)
    response = photo_http.post(
        "/uploads", headers=auth(photo_http), json={"generatorId": GID, "contentType": "image/png"}
    )
    assert response.status_code == 502 and "secret" not in response.text
    assert (
        photo_http.get(f"/generators/{GID}/readiness?date={DAY}", headers=auth(photo_http)).json()[
            "submission"
        ]
        == record
    )


def test_expired_and_immutable_local_upload(photo_http):
    http = photo_http
    record, upload = attached(http)
    assert (
        http.post(
            upload["url"], headers={**auth(http), "Content-Type": "image/png"}, content=png(65)
        ).status_code
        == 409
    )
    now = datetime.now(UTC)
    service = Service(
        {"headers": auth(http)}, http.state.config, http.db, now, photo_store=http.state.photo_store
    )
    expired = Service(
        {"headers": auth(http)},
        http.state.config,
        http.db,
        now + timedelta(seconds=301),
        photo_store=http.state.photo_store,
    )
    with pytest.raises(ApiError, match="expired"):
        http.state.photo_store.put(upload["key"], png(), "image/png", expired)
    assert http.state.photo_store.get(upload["key"], service)[0] == png()
    expired.now = now + timedelta(days=http.state.config.photo_retention_days + 1)
    with pytest.raises(ApiError, match="retention"):
        http.state.photo_store.get(upload["key"], expired)
    assert evidence(http, record).status_code == 404


def test_revision_missing_key_new_readiness_and_atomic_race(photo_http, monkeypatch):
    http = photo_http
    record, upload = attached(http)
    assert mutation(http, record, "photo", key="missing-key").status_code == 400
    assert (
        mutation(
            http, {**record, "photoRevision": 0}, "photo", {"photoKey": None}, key="stale"
        ).status_code
        == 409
    )
    original = http.db.transact
    raced = False

    def race(actions):
        nonlocal raced
        if not raced:
            raced = True
            Service(
                {"headers": auth(http)}, http.state.config, http.db, datetime.now(UTC)
            ).readiness(
                {
                    "generatorId": GID,
                    "collectionDate": DAY,
                    "status": "READY",
                    "confirmedKg": 200,
                    "weightSource": "ESTIMATE",
                    "window": {"start": "06:00", "end": "09:00"},
                }
            )
        return original(actions)

    monkeypatch.setattr(http.db, "transact", race)
    assert mutation(http, record, "screen", key="racing-screen").status_code == 409
    assert (
        mutation(
            http, record, "photo", {"photoKey": upload["key"]}, key="old-submission"
        ).status_code
        == 409
    )
    retained = http.db.get("submissions", {"generatorId": GID, "ts": record["submissionId"]})
    assert retained == record


def test_screen_advances_inputs_but_never_changes_dispatched_route(photo_http):
    http = photo_http
    record, _ = attached(http)
    admin = {"X-Admin-Token": "photo-test-admin"}
    plan = http.post("/plans", headers=admin, json={"collectionDate": DAY}).json()
    path = "/plans/" + quote(plan["planKey"], safe="")
    dispatch = http.post(
        path + "/dispatch",
        headers={**admin, "Idempotency-Key": "photo-dispatch"},
        json={
            "expectedVersion": plan["version"],
            "expectedInputRevision": plan["inputRevision"],
        },
    )
    assert dispatch.status_code == 200, dispatch.text
    http.state.config = replace(http.state.config, mock_bedrock_fixture="hazard")
    assert mutation(http, record, "screen", key="dispatched-screen").status_code == 200
    driver = {"X-Driver-Token": dispatch.json()["driverAccess"]["token"]}
    current = http.get(path + "/driver", headers=driver).json()
    assert current["plan"]["plan"]["stops"] == plan["plan"]["stops"]
    assert any(alert["code"] == "INPUTS_CHANGED" for alert in current["alerts"])


def test_private_s3_forms_freeze_uploaded_bytes_before_attachment(photo_http, monkeypatch):
    http = photo_http
    http.state.photo_store = None
    client = boto3.client("s3", region_name=http.state.config.aws_region)
    client.create_bucket(
        Bucket=http.state.config.photos_bucket,
        CreateBucketConfiguration={"LocationConstraint": http.state.config.aws_region},
    )
    monkeypatch.setattr(Photos, "s3", lambda _self: client)
    record = saved(http)
    upload = prepare(http)
    assert upload["transport"] == "s3" and upload["fields"]["key"] == upload["key"]
    policy = __import__("json").loads(base64.b64decode(upload["fields"]["policy"]))
    assert ["content-length-range", 1024, 3_500_000] in policy["conditions"]
    client.put_object(
        Bucket=http.state.config.photos_bucket,
        Key=upload["key"],
        Body=png(),
        ContentType="image/png",
    )
    result = mutation(http, record, "photo", {"photoKey": upload["key"]})
    assert result.status_code == 200, result.text
    record = result.json()["submission"]
    assert record["photoKeys"][0] != upload["key"]
    client.put_object(
        Bucket=http.state.config.photos_bucket,
        Key=upload["key"],
        Body=png(65),
        ContentType="image/png",
    )
    assert (
        client.get_object(Bucket=http.state.config.photos_bucket, Key=record["photoKeys"][0])[
            "Body"
        ].read()
        == png()
    )
    assert evidence(http, record).json()["transport"] == "s3"
    client.put_object(
        Bucket=http.state.config.photos_bucket,
        Key=record["photoKeys"][0],
        Body=png(65),
        ContentType="image/png",
    )
    assert evidence(http, record).status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"generatorId": None},
        {"generatorId": []},
        {"generatorId": GID, "contentType": "image/gif"},
    ],
)
def test_upload_request_validation_is_safe(photo_http, payload):
    assert photo_http.post("/uploads", headers=auth(photo_http), json=payload).status_code == 400


def test_photo_transport_disabled_without_store_and_for_non_loopback(photo_http):
    import dev_server

    with TestClient(dev_server.app, client=("203.0.113.5", 1234)) as remote:
        assert (
            remote.post("/local-photos/submissions/test/x.jpg", content=b"invalid").status_code
            == 404
        )
    photo_http.state.photo_store = None
    assert (
        photo_http.post("/local-photos/submissions/test/x.jpg", content=b"invalid").status_code
        == 404
    )


def test_dimension_and_decoded_scanline_limits(photo_http):
    with pytest.raises(ApiError):
        validate_image(png(), "image/png", replace(photo_http.state.config, photo_max_pixels=1))
    with pytest.raises(ApiError):
        validate_image(
            png(), "image/png", replace(photo_http.state.config, photo_max_decoded_bytes=100)
        )
