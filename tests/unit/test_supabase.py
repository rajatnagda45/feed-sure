"""Real HTTP/domain persistence with mocked external Supabase REST transport."""

from __future__ import annotations

import io
import json
from dataclasses import replace
from email.message import Message
from urllib.error import HTTPError, URLError
from urllib.parse import quote

import pytest
from feedsure.common.supabase import NoRedirects, request
from feedsure.common.v3 import ApiError
from test_photo_evidence import DAY, http, png  # noqa: F401

AUTH = {"Authorization": "Bearer verified-user-token"}


@pytest.fixture
def cloud(http, monkeypatch):  # noqa: F811
    """Keep real handlers and DynamoDB; replace only the external HTTP boundary."""
    http.state.config = replace(
        http.state.config,
        auth_provider="supabase",
        photo_storage_provider="supabase",
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="public-key",
        supabase_service_role_key="server-secret",
    )
    user = {
        "id": "user-123",
        "app_metadata": {"feedsure_role": "GENERATOR", "generator_id": "hotel-a"},
    }
    objects, calls = {}, []

    def open_request(req, timeout):
        calls.append(req)
        url = req.full_url.split("https://project.supabase.co")[1]
        mime = "application/json"
        if url == "/auth/v1/user":
            if req.get_header("Authorization") != AUTH["Authorization"]:
                raise HTTPError(req.full_url, 401, "Unauthorized", {}, None)
            data = json.dumps(user).encode()
        elif url.startswith("/storage/v1/object/upload/sign/"):
            data = json.dumps(
                {"url": url[len("/storage/v1") :] + "?token=upload-capability"}
            ).encode()
        elif url.startswith("/storage/v1/object/sign/"):
            data = json.dumps(
                {"signedURL": url[len("/storage/v1") :] + "?token=read-capability"}
            ).encode()
        elif url.startswith("/storage/v1/object/feedsure-photos/"):
            key = url.split("/object/feedsure-photos/")[1]
            if req.method == "POST":
                objects[key] = req.data
                data = b"{}"
            else:
                data, mime = objects[key], "image/png"
        else:
            raise AssertionError(url)
        reply = io.BytesIO(data)
        reply.headers = Message()
        reply.headers["Content-Type"] = mime
        return reply

    class Opener:
        open = staticmethod(open_request)

    monkeypatch.setattr("urllib.request.build_opener", lambda *args: Opener())
    http.cloud_user, http.cloud_objects, http.cloud_calls = user, objects, calls
    return http


def ready(cloud):
    response = cloud.post(
        "/submissions",
        headers=AUTH,
        json={
            "generatorId": "hotel-a",
            "collectionDate": DAY,
            "status": "READY",
            "confirmedKg": 100,
            "weightSource": "SCALE",
            "window": {"start": "06:00", "end": "09:00"},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["submission"]["actor"] == {"type": "GENERATOR", "id": "user-123"}
    return response.json()["submission"]


def test_verified_login_scopes_and_no_legacy_bypass(cloud):
    session = cloud.get("/auth/session", headers=AUTH)
    assert session.json()["account"] == {
        "id": "user-123",
        "role": "GENERATOR",
        "generatorId": "hotel-a",
    }
    assert cloud.get("/generators/hotel-a", headers=AUTH).status_code == 200
    assert cloud.get("/generators/hotel-b", headers=AUTH).status_code == 403
    assert cloud.get("/operations?date=" + DAY, headers=AUTH).status_code == 403
    assert cloud.get("/intake?date=" + DAY, headers=AUTH).status_code == 403
    for headers in (
        {},
        {"X-Admin-Token": "photo-admin"},
        {"Authorization": "Bearer bad", "X-Admin-Token": "photo-admin"},
    ):
        assert cloud.get("/operations?date=" + DAY, headers=headers).status_code == 401
    cloud.cloud_user["app_metadata"] = {}
    cloud.cloud_user["user_metadata"] = {"feedsure_role": "ADMIN"}
    assert cloud.get("/auth/session", headers=AUTH).status_code == 403


def test_roles_are_verified_on_each_request(cloud):
    cloud.cloud_user["app_metadata"] = {"feedsure_role": "ADMIN"}
    assert cloud.get("/operations?date=" + DAY, headers=AUTH).status_code == 200
    assert cloud.get("/intake?date=" + DAY, headers=AUTH).status_code == 403
    cloud.cloud_user["app_metadata"] = {"feedsure_role": "PLANT_OWNER"}
    assert cloud.get("/intake?date=" + DAY, headers=AUTH).status_code == 200
    assert cloud.get("/operations?date=" + DAY, headers=AUTH).status_code == 403


def test_driver_trip_assignment_expiry_and_authenticated_audit(cloud):
    ready(cloud)
    cloud.cloud_user["app_metadata"] = {"feedsure_role": "ADMIN"}
    plan = cloud.post("/plans", headers=AUTH, json={"collectionDate": DAY, "targetKg": 75}).json()
    encoded = quote(plan["planKey"], safe="")
    dispatched = cloud.post(
        "/plans/" + encoded + "/dispatch",
        headers={**AUTH, "Idempotency-Key": "cloud-dispatch"},
        json={"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]},
    )
    assert dispatched.status_code == 200, dispatched.text
    cloud.cloud_user["app_metadata"] = {"feedsure_role": "DRIVER", "plan_key": plan["planKey"]}
    assert cloud.get("/plans/" + encoded + "/driver", headers=AUTH).status_code == 200
    assert cloud.get("/operations?date=" + DAY, headers=AUTH).status_code == 403
    pickup = cloud.post(
        "/pickups",
        headers={**AUTH, "Idempotency-Key": "cloud-pickup"},
        json={
            "planKey": plan["planKey"],
            "generatorId": "hotel-a",
            "outcome": "COLLECTED",
            "kg": 100,
            "weightSource": "SCALE",
            "expectedRevision": 0,
        },
    )
    assert pickup.status_code == 200, pickup.text
    assert pickup.json()["pickup"]["actor"] == {"type": "DRIVER", "id": "user-123"}
    cloud.cloud_user["app_metadata"]["plan_key"] = DAY + "#p-other-trip"
    assert cloud.get("/plans/" + encoded + "/driver", headers=AUTH).status_code == 403
    cloud.cloud_user["app_metadata"]["plan_key"] = plan["planKey"]
    stored = cloud.state.database.get(
        "plans", {"date": DAY, "planId": plan["planKey"].split("#")[1]}
    )
    stored["driverExpiresEpoch"] = 0
    cloud.state.database.put("plans", stored)
    assert cloud.get("/plans/" + encoded + "/driver", headers=AUTH).status_code == 401


def test_supabase_image_save_freezes_bytes_and_returns_private_evidence(cloud):
    record = ready(cloud)
    prepared = cloud.post(
        "/uploads", headers=AUTH, json={"generatorId": "hotel-a", "contentType": "image/png"}
    ).json()["uploads"][0]
    assert prepared["transport"] == "supabase" and prepared["fields"] == {}
    assert "server-secret" not in json.dumps(prepared)
    cloud.cloud_objects[prepared["key"]] = png()  # Simulate the browser's signed PUT.
    path = "/submissions/" + quote(record["submissionId"], safe="")
    payload = {"photoKey": prepared["key"], "expectedPhotoRevision": 0}
    headers = {**AUTH, "Idempotency-Key": "save-photo"}
    saved = cloud.post(path + "/photo", headers=headers, json=payload)
    assert saved.status_code == 200, saved.text
    frozen = saved.json()["submission"]["photoKeys"][0]
    assert frozen != prepared["key"] and cloud.cloud_objects[frozen] == png()
    assert cloud.post(path + "/photo", headers=headers, json=payload).json() == saved.json()
    cloud.cloud_objects[prepared["key"]] = b"overwritten staging bytes"
    evidence = cloud.get(path + "/evidence", headers=AUTH)
    assert evidence.status_code == 200
    assert evidence.json()["transport"] == "supabase"
    assert "read-capability" in evidence.json()["url"]
    cloud.cloud_user["app_metadata"]["generator_id"] = "hotel-b"
    assert cloud.get(path + "/evidence", headers=AUTH).status_code == 403
    assert "server-secret" not in saved.text + evidence.text
    for req in cloud.cloud_calls:
        if "/storage/v1/" in req.full_url:
            assert req.get_header("Authorization") == "Bearer server-secret"


def test_invalid_image_and_other_supplier_keys_do_not_attach(cloud):
    record = ready(cloud)
    path = "/submissions/" + quote(record["submissionId"], safe="") + "/photo"
    key = "submissions/hotel-a/" + "a" * 32 + ".png"
    cloud.cloud_objects[key] = b"bad image" * 200
    for photo_key in (key, key.replace("hotel-a", "hotel-b")):
        result = cloud.post(
            path,
            headers={**AUTH, "Idempotency-Key": "invalid-photo"},
            json={"photoKey": photo_key, "expectedPhotoRevision": 0},
        )
        assert result.status_code == 400
    latest = cloud.get("/generators/hotel-a/readiness?date=" + DAY, headers=AUTH).json()
    assert latest["submission"]["photoKeys"] == []
    assert latest["submission"]["confirmedKg"] == 100


def test_upstream_failure_is_safe_and_never_uses_legacy_credentials(cloud, monkeypatch):
    def unavailable(*args, **kwargs):
        raise URLError("network unavailable with private details")

    monkeypatch.setattr("urllib.request.build_opener", unavailable)
    result = cloud.get("/operations?date=" + DAY, headers={**AUTH, "X-Admin-Token": "photo-admin"})
    assert result.status_code == 502
    assert "private details" not in result.text


def test_redirects_are_rejected_and_responses_are_bounded(cloud, monkeypatch):
    assert NoRedirects().redirect_request(None, None, 302, "", None, "https://evil.example") is None
    with pytest.raises(ApiError, match="response exceeds"):
        request(
            cloud.state.config,
            "/auth/v1/user",
            key="public-key",
            token="verified-user-token",
            limit=8,
        )
    with pytest.raises(ApiError, match="Configure Supabase"):
        request(
            replace(cloud.state.config, supabase_url="http://evil.example"),
            "/auth/v1/user",
            key="public-key",
        )
