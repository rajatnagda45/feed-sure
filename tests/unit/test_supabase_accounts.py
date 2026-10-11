"""Real HTTP/domain integration; external Auth/PostgREST transport is mocked.

The SQL policy itself is executed by tests/sql, rather than reimplemented here.
"""

from __future__ import annotations

import base64
import io
import json
from dataclasses import replace
from email.message import Message
from urllib.error import HTTPError

import pytest
from test_photo_evidence import DAY, http  # noqa: F401

UID = "00000000-0000-4000-8000-000000000001"
SID = "00000000-0000-4000-8000-000000000101"
TARGET = "00000000-0000-4000-8000-000000000002"
GID = "registered-00000000000040008000000000000002"
CLAIMS = base64.urlsafe_b64encode(json.dumps({"session_id": SID}).encode()).decode().rstrip("=")
AUTH = {"Authorization": "Bearer header." + CLAIMS + ".signature"}


def row(uid=UID, role="admin", status="ACTIVE"):
    return {
        "id": uid,
        "email": "person@example.test",
        "role": role,
        "status": status,
        "revision": 1,
        "organisation": "Synthetic hotel",
        "contact": "Test contact",
        "address": "Synthetic address",
        "profile": {"lat": 12.68, "lng": 77.47, "type": "hotel"},
        "capacity_kg": 1000,
        "generator_id": GID,
        "plan_key": None,
    }


@pytest.fixture
def managed(http, monkeypatch):  # noqa: F811
    http.state.config = replace(
        http.state.config,
        auth_provider="supabase",
        supabase_account_management=True,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="public-key",
        supabase_service_role_key="server-secret",
    )
    http.actor, http.target, http.calls = row(), row(TARGET, "kitchen", "PENDING"), []
    http.rpc_error, http.auth_failure, http.wrong_password_identity = None, False, False

    def open_request(req, timeout):
        path = req.full_url.split("https://project.supabase.co")[1]
        data = json.loads(req.data) if req.data else {}
        http.calls.append((path, req.method, data, req.get_header("Authorization")))
        if path == "/auth/v1/user":
            if req.get_header("Authorization") != AUTH["Authorization"]:
                raise HTTPError(req.full_url, 401, "unauthorized", {}, None)
            # Editable metadata must not grant an Admin role to any registry user.
            result = {"id": UID, "app_metadata": {}, "user_metadata": {"feedsure_role": "ADMIN"}}
        elif path == "/rest/v1/rpc/feedsure_accounts_api":
            assert req.get_header("Authorization") == "Bearer server-secret"
            assert data["p_actor"] == UID and data["p_session"] == SID
            if http.rpc_error:
                result = http.rpc_error
            elif data["p_action"] == "identity":
                result = http.actor
            elif data["p_action"] == "list":
                result = {"accounts": [http.target]}
            elif data["p_action"] == "password":
                result = {**http.target, "revision": 2, "ticket": SID}
            else:
                result = http.target
        elif path == "/auth/v1/token?grant_type=password":
            result = {
                "user": {"id": TARGET if http.wrong_password_identity else UID},
                "access_token": "temporary-reauth-token",
            }
        elif path.startswith("/auth/v1/admin/users/"):
            if http.auth_failure:
                raise HTTPError(req.full_url, 500, "failed", {}, None)
            result = {}
        elif path == "/auth/v1/admin/users":
            result = {"id": TARGET}
        elif path == "/auth/v1/logout?scope=local":
            assert req.get_header("Authorization") == "Bearer temporary-reauth-token"
            result = {}
        else:
            raise AssertionError(path)
        reply = io.BytesIO(json.dumps(result).encode())
        reply.headers = Message()
        reply.headers["Content-Type"] = "application/json"
        return reply

    class Opener:
        open = staticmethod(open_request)

    monkeypatch.setattr("urllib.request.build_opener", lambda *args: Opener())
    return http


def mutate(managed, action, **extra):
    return managed.post(
        "/auth/accounts/" + TARGET,
        headers=AUTH,
        json={"action": action, "expectedRevision": 1, **extra},
    )


def test_pending_signup_has_profile_but_no_operational_access(managed):
    managed.actor = row(role="kitchen", status="PENDING")
    assert managed.get("/auth/account", headers=AUTH).json()["status"] == "PENDING"
    assert managed.get("/auth/session", headers=AUTH).status_code == 403
    assert managed.get("/generators/" + GID, headers=AUTH).status_code == 403
    assert managed.get("/auth/accounts", headers=AUTH).status_code == 403


def test_cbg_operations_cannot_manage_users_and_owner_has_separate_intake(managed):
    managed.actor = row(role="cbg")
    session = managed.get("/auth/session", headers=AUTH).json()["account"]
    assert session["role"] == "ADMIN" and session["accountRole"] == "cbg"
    assert managed.get("/generators", headers=AUTH).status_code == 200
    assert managed.get("/auth/accounts", headers=AUTH).status_code == 403
    assert mutate(managed, "activate").status_code == 403
    managed.actor = row(role="owner")
    assert managed.get("/intake", params={"date": DAY}, headers=AUTH).status_code == 200
    assert managed.get("/generators", headers=AUTH).status_code == 403
    assert managed.get("/auth/accounts", headers=AUTH).status_code == 403


def test_approval_enrolls_and_scopes_generator_and_restores_after_demo_restart(managed):
    result = mutate(managed, "activate")
    assert result.status_code == 200, result.text
    db = managed.state.database
    assert db.get("generators", {"generatorId": GID})["pickupStart"] == "06:00"
    managed.actor = row(role="kitchen")
    assert managed.get("/generators/" + GID, headers=AUTH).status_code == 200
    assert managed.get("/generators/hotel-a", headers=AUTH).status_code == 403
    db.resource.Table(db.table_name("generators")).delete_item(Key={"generatorId": GID})
    assert managed.get("/generators/" + GID, headers=AUTH).status_code == 200
    assert db.get("generators", {"generatorId": GID})["simulated"] is True


def test_registry_revocation_is_checked_on_every_request_without_legacy_fallback(managed):
    assert managed.get("/generators", headers=AUTH).status_code == 200
    managed.rpc_error = {"status": 401, "error": "Account access ended."}
    assert (
        managed.get("/generators", headers={**AUTH, "X-Admin-Token": "photo-admin"}).status_code
        == 401
    )
    assert (
        managed.post(
            "/uploads", headers=AUTH, json={"generatorId": "hotel-a", "contentType": "image/png"}
        ).status_code
        == 401
    )
    assert (
        managed.get("/auth/accounts", headers={"X-Admin-Token": "photo-admin"}).status_code == 401
    )


@pytest.mark.parametrize("failed", [False, True])
def test_password_reset_reserves_revision_and_finishes_private_receipt_even_on_auth_failure(
    managed, failed
):
    managed.auth_failure = failed
    result = mutate(managed, "password", password="new-password-long-enough")
    assert result.status_code == (502 if failed else 200)
    operations = [(path, data.get("p_action")) for path, _, data, _ in managed.calls]
    start = operations.index(("/rest/v1/rpc/feedsure_accounts_api", "password"))
    change = operations.index(("/auth/v1/admin/users/" + TARGET, None))
    finish = operations.index(("/rest/v1/rpc/feedsure_accounts_api", "password_finish"))
    assert start < change < finish
    for path, _, data, _ in managed.calls:
        if path.startswith("/rest/"):
            assert "new-password" not in json.dumps(data)
    assert "ticket" not in result.text and "server-secret" not in result.text


def test_conflicting_reset_never_reaches_privileged_auth_update(managed):
    managed.rpc_error = {"status": 409, "error": "Account changed."}
    assert mutate(managed, "password", password="new-password-long-enough").status_code == 409
    assert not any(path.startswith("/auth/v1/admin") for path, *_ in managed.calls)


def test_self_change_requires_matching_current_password_identity(managed):
    managed.wrong_password_identity = True
    payload = {
        "action": "password",
        "expectedRevision": 1,
        "currentPassword": "old-password-long",
        "password": "new-password-long",
    }
    assert managed.post("/auth/account", headers=AUTH, json=payload).status_code == 401
    assert not any(data.get("p_action") == "password" for _, _, data, _ in managed.calls)
    managed.wrong_password_identity = False
    result = managed.post("/auth/account", headers=AUTH, json=payload)
    assert result.status_code == 200, result.text
    assert any(path == "/auth/v1/logout?scope=local" for path, *_ in managed.calls)


def test_admin_creation_uses_auth_and_requests_pending_role_without_granting_app_access(managed):
    payload = {
        "email": "person@example.test",
        "password": "long-test-password",
        "role": "admin",
        "organisation": "Pilot",
        "contact": "Test",
        "address": "Test",
    }
    result = managed.post("/auth/accounts", headers=AUTH, json=payload)
    assert result.status_code == 200, result.text
    creation = next(data for path, _, data, _ in managed.calls if path == "/auth/v1/admin/users")
    assert creation["app_metadata"] == {"feedsure_account_role": "admin"}
    assert creation["user_metadata"]["feedsure_registration"]["role"] == "admin"
    assert "password" not in result.text


def test_deletion_retains_operational_generator_evidence(managed):
    assert mutate(managed, "activate").status_code == 200
    assert mutate(managed, "delete").status_code == 200
    assert managed.state.database.get("generators", {"generatorId": GID})
    assert any(
        path == "/auth/v1/admin/users/" + TARGET and method == "DELETE"
        for path, method, *_ in managed.calls
    )


def test_management_requires_migration_opt_in(managed):
    managed.state.config = replace(managed.state.config, supabase_account_management=False)
    assert managed.get("/auth/accounts", headers=AUTH).status_code == 503


def test_invalid_or_unverified_bearer_cannot_supply_session_identity(managed):
    assert (
        managed.get("/auth/account", headers={"Authorization": "Bearer invalid"}).status_code == 401
    )
