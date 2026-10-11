"""Exercise password login and actual scoped domain access through the local HTTP API."""

from dataclasses import replace
from datetime import date
from urllib.parse import quote

import boto3
import pytest
from fastapi.testclient import TestClient
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.common.v3 import ApiError
from local_accounts import LocalAccounts, prepare_accounts
from moto import mock_aws
from seed_data import seed_v3_database


@pytest.fixture
def login_http(monkeypatch, tmp_path):
    monkeypatch.setenv("ADMIN_TOKEN", "login-test-admin")
    monkeypatch.setenv("PLANT_OWNER_TOKEN", "login-test-owner")
    monkeypatch.setenv(
        "DRIVER_TOKEN_SECRET", "login-test-driver-secret-with-at-least-32-characters"
    )
    monkeypatch.setenv("MOCK_LOCATION", "true")
    with mock_aws():
        config = replace(get_config(), aws_endpoint_url="moto://in-process")
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        tokens = seed_v3_database(config, resource, date(2026, 10, 12))
        accounts = prepare_accounts(tmp_path, list(tokens), config.allowed_origin)
        import dev_server

        monkeypatch.setattr(dev_server.app.state, "config", config, raising=False)
        monkeypatch.setattr(
            dev_server.app.state, "database", DynamoDB(config, resource), raising=False
        )
        monkeypatch.setattr(
            dev_server.app.state,
            "local_accounts",
            LocalAccounts(
                accounts,
                tokens,
                config.admin_token,
                config.plant_owner_token,
                "2026-10-12",
                registry=tmp_path / "registry.json",
                database=dev_server.app.state.database,
            ),
            raising=False,
        )
        with TestClient(dev_server.app) as http:
            http.accounts = accounts
            yield http


def credentials(http, role, index=0):
    return {
        key: value
        for key, value in [item for item in http.accounts if item["role"] == role][index].items()
        if key in {"loginId", "password", "role"}
    }


def test_all_accounts_reused_without_password_rotation(tmp_path):
    ids = [f"demo-kitchen-{index:02}" for index in range(1, 11)]
    first = prepare_accounts(tmp_path, ids, "http://localhost:5200")
    assert len(first) == 16
    assert len({item["password"] for item in first}) == 16
    assert prepare_accounts(tmp_path, ids, "http://localhost:5201") == first
    assert "5201/login" in (tmp_path / "LOGIN-CREDENTIALS.local.md").read_text(encoding="utf-8")


def test_each_account_authenticates_and_enforces_domain_scope(login_http):
    http = login_http
    for account in http.accounts:
        payload = {key: account[key] for key in ("loginId", "password", "role")}
        response = http.post("/auth/login", json=payload)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        access = response.json()
        assert access["role"] == account["role"]
        assert access["collectionDate"] == "2026-10-12"
        assert "password" not in access
        token = access["token"]
        if account["role"] == "kitchen":
            gid = account["generatorId"]
            header = {"X-Generator-Token": token}
            assert http.get(f"/generators/{gid}", headers=header).status_code == 200
            other = "demo-kitchen-02" if gid == "demo-kitchen-01" else "demo-kitchen-01"
            assert http.get(f"/generators/{other}", headers=header).status_code == 401
            assert http.get("/operations?date=2026-10-12", headers=header).status_code == 401
        elif account["role"] == "owner":
            header = {"X-Plant-Token": token}
            assert http.get("/intake?date=2026-10-12", headers=header).status_code == 200
            assert http.get("/operations?date=2026-10-12", headers=header).status_code == 401
            assert http.post("/plans", headers=header, json={}).status_code == 401
            assert (
                http.get(
                    "/operations?date=2026-10-12", headers={"X-Admin-Token": token}
                ).status_code
                == 401
            )
        else:
            assert (
                http.get(
                    "/operations?date=2026-10-12", headers={"X-Admin-Token": token}
                ).status_code
                == 200
            )


def test_wrong_role_password_unknown_account_and_throttle(login_http):
    http = login_http
    payload = credentials(http, "kitchen")
    assert http.post("/auth/login", json={**payload, "role": "admin"}).status_code == 401
    assert http.post("/auth/login", json={**payload, "password": "wrong"}).status_code == 401
    assert http.post("/auth/login", json={**payload, "loginId": "missing"}).status_code == 401
    for _ in range(3):
        assert http.post("/auth/login", json={**payload, "password": "wrong"}).status_code == 401
    assert http.post("/auth/login", json=payload).status_code == 429
    # A different account can still sign in.
    assert http.post("/auth/login", json=credentials(http, "kitchen", 1)).status_code == 200


def test_invalid_body_and_origin(login_http):
    http = login_http
    for payload in ([], {}, {"loginId": 7}, {"password": "x" * 5000}):
        assert http.post("/auth/login", json=payload).status_code == 400
    assert http.post("/auth/login", content=b"not json").status_code == 400
    assert (
        http.post(
            "/auth/login",
            json=credentials(http, "admin"),
            headers={"Origin": "https://untrusted.example"},
        ).status_code
        == 403
    )


def test_login_is_disabled_without_demo_bootstrap(monkeypatch):
    import dev_server

    monkeypatch.delattr(dev_server.app.state, "local_accounts", raising=False)
    with TestClient(dev_server.app) as http:
        assert http.post("/auth/login", json={}).status_code == 404


def account_header(http, role="admin", index=0):
    response = http.post("/auth/login", json=credentials(http, role, index))
    assert response.status_code == 200
    return {"X-Account-Token": response.json()["token"]}


def registration(role="kitchen", login_id="new.generator"):
    payload = {
        "loginId": login_id,
        "password": "new-secure-password",
        "role": role,
        "organisation": "Test organic site",
        "contact": "Synthetic test contact",
        "address": "Synthetic test address",
    }
    if role == "kitchen":
        payload.update(lat=12.69, lng=77.48, type="hotel")
    elif role in {"cbg", "owner"}:
        payload["capacityKg"] = 1000
    return payload


def change(http, header, account, action, **extra):
    return http.post(
        f"/auth/accounts/{account['loginId']}",
        headers=header,
        json={
            "action": action,
            "expectedRevision": account["revision"],
            **extra,
        },
    )


@pytest.mark.parametrize("role", ["kitchen", "cbg", "owner"])
def test_registration_approval_and_domain_access(login_http, role):
    http = login_http
    payload = registration(role, f"new.{role}")
    registered = http.post("/auth/register", json=payload)
    assert registered.status_code == 200
    account = registered.json()
    assert account["status"] == "PENDING"
    assert not {"password", "salt", "hash"} & account.keys()
    login = {key: payload[key] for key in ("role", "loginId", "password")}
    assert http.post("/auth/login", json=login).status_code == 401
    header = account_header(http)
    approved = change(http, header, account, "activate")
    assert approved.status_code == 200
    assert approved.json()["revision"] == 2
    access = http.post("/auth/login", json=login).json()
    token = access["token"]
    if role == "kitchen":
        gid = account["generatorId"]
        profile = http.get(f"/generators/{gid}", headers={"X-Generator-Token": token})
        assert profile.status_code == 200
        assert profile.json()["generator"]["name"] == payload["organisation"]
        assert (
            http.get(
                "/generators/demo-kitchen-01", headers={"X-Generator-Token": token}
            ).status_code
            == 401
        )
        assert (
            http.get("/operations?date=2026-10-12", headers={"X-Admin-Token": token}).status_code
            == 401
        )
    elif role == "owner":
        assert (
            http.get("/intake?date=2026-10-12", headers={"X-Plant-Token": token}).status_code == 200
        )
        assert (
            http.get("/operations?date=2026-10-12", headers={"X-Admin-Token": token}).status_code
            == 401
        )
    else:
        assert (
            http.get("/operations?date=2026-10-12", headers={"X-Admin-Token": token}).status_code
            == 200
        )
    assert http.get("/auth/accounts", headers={"X-Account-Token": token}).status_code == 403


def test_admin_create_edit_reset_suspend_reactivate_delete(login_http):
    http = login_http
    header = account_header(http)
    payload = registration("owner", "created.owner")
    account = http.post("/auth/accounts", headers=header, json=payload).json()
    account = change(http, header, account, "activate").json()
    login = {key: payload[key] for key in ("role", "loginId", "password")}
    token = http.post("/auth/login", json=login).json()["token"]
    stale = dict(account)
    account = change(
        http,
        header,
        account,
        "update",
        organisation="Updated plant",
        contact="Updated contact",
        address="Updated address",
    ).json()
    assert account["organisation"] == "Updated plant"
    assert change(http, header, stale, "suspend").status_code == 409
    account = change(http, header, account, "password", password="replacement-secret").json()
    assert http.get("/intake?date=2026-10-12", headers={"X-Plant-Token": token}).status_code == 401
    assert http.post("/auth/login", json=login).status_code == 401
    login["password"] = "replacement-secret"
    token = http.post("/auth/login", json=login).json()["token"]
    account = change(http, header, account, "suspend").json()
    assert http.post("/auth/login", json=login).status_code == 401
    assert http.get("/intake?date=2026-10-12", headers={"X-Plant-Token": token}).status_code == 401
    account = change(http, header, account, "activate").json()
    assert http.post("/auth/login", json=login).status_code == 200
    assert change(http, header, account, "delete").status_code == 200
    assert http.post("/auth/login", json=login).status_code == 401
    assert all(
        item["loginId"] != account["loginId"]
        for item in http.get("/auth/accounts", headers=header).json()["accounts"]
    )
    assert http.post("/auth/register", json=payload).status_code == 409


def test_account_permissions_last_admin_and_logout(login_http):
    http = login_http
    header = account_header(http)
    accounts = http.get("/auth/accounts", headers=header).json()["accounts"]
    admins = [item for item in accounts if item["role"] == "admin"]
    assert change(http, header, admins[0], "delete").status_code == 409
    assert change(http, header, admins[1], "suspend").status_code == 200
    own = http.get("/auth/account", headers=header).json()
    assert (
        http.post(
            "/auth/account",
            headers=header,
            json={
                "action": "delete",
                "expectedRevision": own["revision"],
                "currentPassword": credentials(http, "admin")["password"],
            },
        ).status_code
        == 409
    )
    assert http.get("/auth/accounts").status_code == 401
    assert http.get("/auth/accounts", headers=account_header(http, "cbg")).status_code == 403
    assert http.post("/auth/logout", headers=header, json={}).status_code == 200
    assert http.get("/auth/account", headers=header).status_code == 401


def test_self_password_change_and_delete_require_current_password(login_http):
    http = login_http
    header = account_header(http, "kitchen")
    own = http.get("/auth/account", headers=header).json()
    payload = {
        "action": "password",
        "expectedRevision": own["revision"],
        "password": "changed-user-secret",
        "currentPassword": "wrong",
    }
    assert http.post("/auth/account", headers=header, json=payload).status_code == 401
    payload["currentPassword"] = credentials(http, "kitchen")["password"]
    assert http.post("/auth/account", headers=header, json=payload).status_code == 200
    assert http.get("/auth/account", headers=header).status_code == 401
    login = {**credentials(http, "kitchen"), "password": "changed-user-secret"}
    token = http.post("/auth/login", json=login).json()["token"]
    header = {"X-Account-Token": token}
    own = http.get("/auth/account", headers=header).json()
    assert (
        http.post(
            "/auth/account",
            headers=header,
            json={
                "action": "delete",
                "expectedRevision": own["revision"],
                "currentPassword": "changed-user-secret",
            },
        ).status_code
        == 200
    )
    assert (
        http.get(
            f"/generators/{own['generatorId']}", headers={"X-Generator-Token": token}
        ).status_code
        == 401
    )
    # Account deletion does not erase the operational generator or past collection records.
    import dev_server

    assert dev_server.app.state.database.get("generators", {"generatorId": own["generatorId"]})


def test_registry_survives_restart_without_plaintext_or_active_sessions(login_http):
    import dev_server

    http = login_http
    header = account_header(http)
    account = http.post("/auth/register", json=registration()).json()
    account = change(http, header, account, "activate").json()
    service = dev_server.app.state.local_accounts
    contents = service.registry.read_text(encoding="utf-8")
    assert "new-secure-password" not in contents
    assert header["X-Account-Token"] not in contents
    restored = LocalAccounts(
        http.accounts,
        service.tokens,
        service.admin_token,
        service.owner_token,
        service.collection_date,
        service.registry,
        service.database,
    )
    with pytest.raises(ApiError) as failure:
        restored.session(header["X-Account-Token"])
    assert failure.value.status == 401
    access = restored.login({key: registration()[key] for key in ("role", "loginId", "password")})
    assert access["path"] == f"/g/{account['generatorId']}"
    suspended = change(http, header, account, "suspend").json()
    restored = LocalAccounts(
        http.accounts,
        service.tokens,
        service.admin_token,
        service.owner_token,
        service.collection_date,
        service.registry,
        service.database,
    )
    assert restored.accounts[suspended["loginId"]]["status"] == "SUSPENDED"


@pytest.mark.parametrize(
    "extra",
    [
        {"role": "admin"},
        {"role": []},
        {"password": "short"},
        {"loginId": "a/b"},
        {"lat": True},
        {"lng": 181},
        {"type": "unsupported"},
        {"unknown": "field"},
    ],
)
def test_registration_rejects_invalid_and_privileged_fields(login_http, extra):
    assert login_http.post("/auth/register", json={**registration(), **extra}).status_code == 400


def test_registration_origin_bounds_duplicate_and_pending_restart(login_http):
    import dev_server

    http = login_http
    payload = registration()
    assert (
        http.post(
            "/auth/register", json=payload, headers={"Origin": "https://untrusted.example"}
        ).status_code
        == 403
    )
    assert http.post("/auth/register", content="x" * 4097).status_code == 400
    assert http.post("/auth/register", json=payload).status_code == 200
    assert (
        http.post("/auth/register", json={**payload, "loginId": "NEW.GENERATOR"}).status_code == 409
    )
    service = dev_server.app.state.local_accounts
    gid = service.accounts[payload["loginId"]]["generatorId"]
    restored = LocalAccounts(
        http.accounts,
        service.tokens,
        service.admin_token,
        service.owner_token,
        service.collection_date,
        service.registry,
        service.database,
    )
    assert gid not in restored.tokens
    assert service.database.get("generators", {"generatorId": gid}) is None


def test_owner_gate_write_and_intake_omit_dispatch_inputs(login_http):
    http = login_http
    admin_session = account_header(http)["X-Account-Token"]
    admin = {"X-Admin-Token": admin_session}
    plan = http.post(
        "/plans",
        headers=admin,
        json={
            "collectionDate": "2026-10-12",
            "targetKg": 100,
        },
    ).json()
    response = http.post(
        f"/plans/{quote(plan['planKey'], safe='')}/dispatch",
        headers={
            **admin,
            "Idempotency-Key": "account-owner-dispatch",
        },
        json={"expectedVersion": plan["version"], "expectedInputRevision": plan["inputRevision"]},
    )
    assert response.status_code == 200
    owner = {"X-Plant-Token": account_header(http, "owner")["X-Account-Token"]}
    gate = {"planKey": plan["planKey"], "netKg": 90, "weightSource": "SCALE", "expectedRevision": 0}
    saved = http.post(
        "/gate-logs", headers={**owner, "Idempotency-Key": "account-owner-gate"}, json=gate
    )
    assert saved.status_code == 200
    assert saved.json()["gate"]["actor"]["type"] == "PLANT_OWNER"
    intake = http.get("/intake?date=2026-10-12", headers=owner).json()["trips"]
    assert intake[0]["gate"]["netKg"] == 90
    assert not {"inputs", "driverToken", "driverTokenHash", "baseline", "params"} & intake[0].keys()


def test_session_expiry_and_revocation_of_multiple_browser_sessions(login_http):
    import dev_server

    http = login_http
    first = account_header(http, "owner")["X-Account-Token"]
    second = account_header(http, "owner")["X-Account-Token"]
    service = dev_server.app.state.local_accounts
    login_id, _ = service.sessions[first]
    service.sessions[first] = (login_id, 0)
    assert http.get("/intake?date=2026-10-12", headers={"X-Plant-Token": first}).status_code == 401
    third = account_header(http, "owner")["X-Account-Token"]
    admin = account_header(http)
    account = http.get("/auth/account", headers={"X-Account-Token": second}).json()
    assert change(http, admin, account, "suspend").status_code == 200
    for token in (second, third):
        assert (
            http.get("/intake?date=2026-10-12", headers={"X-Plant-Token": token}).status_code == 401
        )
