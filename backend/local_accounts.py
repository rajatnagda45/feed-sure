"""ID/password access for the disposable loopback demo, never deployed to Lambda."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import secrets
import time
from pathlib import Path
from typing import Any

from feedsure.common.v3 import ApiError

ROLES = {"kitchen", "cbg", "owner", "admin"}


class LocalAccounts:
    """Keep salted password hashes in memory and exchange logins for scoped demo access."""

    def __init__(
        self,
        accounts: list[dict[str, str]],
        tokens: dict[str, str],
        admin_token: str,
        owner_token: str,
        collection_date: str,
        registry: Path | None = None,
        database: Any = None,
    ) -> None:
        self.accounts: dict[str, dict[str, Any]] = {}
        self.failures: dict[str, list[float]] = {}
        self.tokens = tokens
        self.admin_token, self.owner_token = admin_token, owner_token
        self.collection_date = collection_date
        self.dummy_salt = secrets.token_bytes(16)
        self.registry, self.database = registry, database
        self.sessions: dict[str, tuple[str, float]] = {}
        for account in accounts:
            login_id = account["loginId"]
            role = account["role"]
            if role not in ROLES or login_id in self.accounts:
                raise ValueError("Account roles and login IDs must be valid and unique.")
            if role == "kitchen" and account.get("generatorId") not in tokens:
                raise ValueError(
                    "Organic waste generator account must belong to a seeded generator."
                )
            salt = secrets.token_bytes(16)
            self.accounts[login_id] = {
                "role": role,
                "generatorId": account.get("generatorId"),
                "salt": salt,
                "hash": self.hash_password(account["password"], salt),
                "status": "ACTIVE",
                "revision": 1,
                "organisation": login_id,
                "contact": "",
                "address": "",
            }
        if registry and registry.exists():
            self.accounts = json.loads(registry.read_text(encoding="utf-8"))
            for account in self.accounts.values():
                account["salt"] = bytes.fromhex(account["salt"])
                account["hash"] = bytes.fromhex(account["hash"])
                if account.get("profile") and account["status"] in {"ACTIVE", "SUSPENDED"}:
                    self.enroll(account)
        self.persist()

    def persist(self) -> None:
        """Atomically save password hashes and lifecycle state, never session tokens."""
        if self.registry:
            self.registry.parent.mkdir(parents=True, exist_ok=True)
            rows = {
                key: {**value, "salt": value["salt"].hex(), "hash": value["hash"].hex()}
                for key, value in self.accounts.items()
            }
            temporary = self.registry.with_suffix(".pending")
            temporary.write_text(json.dumps(rows, indent=2), encoding="utf-8")
            temporary.replace(self.registry)

    def enroll(self, account: dict[str, Any]) -> None:
        """Restore an approved generator in the disposable demo database."""
        if self.database is None:
            raise ApiError(503, "DEPENDENCY_NOT_READY", "Generator database is unavailable.")
        gid = account["generatorId"]
        token = secrets.token_urlsafe(32)
        self.tokens[gid] = token
        self.database.put(
            "generators",
            {
                **account["profile"],
                "generatorId": gid,
                "name": account["organisation"],
                "address": account["address"],
                "tokenHash": hashlib.sha256(token.encode()).hexdigest(),
                "schemaVersion": 3,
                "simulated": True,
                "supportedMaterial": True,
                "pickupStart": "06:00",
                "pickupEnd": "09:00",
                "defaultLang": "en",
            },
        )

    @staticmethod
    def text(payload: dict, key: str, maximum: int = 200) -> str:
        """Validate bounded registration text."""
        value = payload.get(key)
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
            raise ApiError(400, "INVALID_INPUT", f"Enter a valid {key}.")
        return value.strip()

    @staticmethod
    def password(payload: dict) -> str:
        """Require a bounded password for newly created or reset credentials."""
        value = payload.get("password")
        if not isinstance(value, str) or not 12 <= len(value) <= 256:
            raise ApiError(400, "INVALID_INPUT", "Password must contain 12 to 256 characters.")
        return value

    @staticmethod
    def public(login_id: str, account: dict) -> dict:
        """Return account details without credential material."""
        return {
            "loginId": login_id,
            **{
                key: account.get(key)
                for key in (
                    "role",
                    "status",
                    "revision",
                    "organisation",
                    "contact",
                    "address",
                    "generatorId",
                    "profile",
                    "capacityKg",
                )
            },
        }

    def register(self, payload: dict, *, admin: bool = False) -> dict:
        """Queue a registration for review; privileged roles require an existing admin."""
        role = payload.get("role")
        if not isinstance(role, str) or role not in (ROLES if admin else ROLES - {"admin"}):
            raise ApiError(400, "INVALID_INPUT", "Choose a valid registration section.")
        expected = {"role", "loginId", "password", "organisation", "contact", "address"}
        expected |= (
            {"lat", "lng", "type"}
            if role == "kitchen"
            else ({"capacityKg"} if role in {"cbg", "owner"} else set())
        )
        if set(payload) != expected:
            raise ApiError(400, "INVALID_INPUT", "Registration fields do not match the section.")
        login_id = self.text(payload, "loginId", 100).lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,99}", login_id):
            raise ApiError(400, "INVALID_INPUT", "Login ID needs 3–100 letters, numbers, . _ or -.")
        if login_id in self.accounts:
            raise ApiError(409, "CONFLICT", "This login ID is unavailable. Choose another.")
        password = self.password(payload)
        salt = secrets.token_bytes(16)
        account = {
            "role": role,
            "status": "PENDING",
            "revision": 1,
            "salt": salt,
            "hash": self.hash_password(password, salt),
            **{key: self.text(payload, key) for key in ("organisation", "contact", "address")},
        }
        if role == "kitchen":
            for key, limit in (("lat", 90), ("lng", 180)):
                value = payload[key]
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or (not math.isfinite(value) or abs(value) > limit)
                ):
                    raise ApiError(400, "INVALID_INPUT", f"Enter a valid {key}.")
            if payload["type"] not in {"hotel", "hostel_mess", "pg", "restaurant", "canteen"}:
                raise ApiError(400, "INVALID_INPUT", "Choose a supported generator type.")
            account["generatorId"] = "registered-" + secrets.token_hex(12)
            account["profile"] = {key: payload[key] for key in ("lat", "lng", "type")}
        elif role in {"cbg", "owner"}:
            value = payload["capacityKg"]
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or (not math.isfinite(value) or not 0 < value <= 1_000_000_000)
            ):
                raise ApiError(400, "INVALID_INPUT", "Enter a positive plant capacity in kg/day.")
            account["capacityKg"] = value
        self.accounts[login_id] = account
        self.persist()
        return self.public(login_id, account)

    def session(self, token: str, *, admin: bool = False) -> tuple[str, dict]:
        """Resolve an active session and enforce account-management privileges."""
        login_id, expiry = self.sessions.get(token, ("", 0))
        account = self.accounts.get(login_id)
        if not account or expiry <= time.monotonic() or account["status"] != "ACTIVE":
            raise ApiError(401, "UNAUTHORIZED", "Sign in again with an active account.")
        if admin and account["role"] != "admin":
            raise ApiError(403, "FORBIDDEN", "Only an Admin can manage accounts.")
        return login_id, account

    def revoke(self, login_id: str) -> None:
        """Immediately revoke every browser session for an account."""
        self.sessions = {key: value for key, value in self.sessions.items() if value[0] != login_id}

    def translate(self, headers: dict[str, str]) -> dict[str, str]:
        """Exchange an active account session for its existing domain credential."""
        result = dict(headers)
        for name in ("x-admin-token", "x-generator-token", "x-plant-token", "x-driver-token"):
            token = result.get(name, "")
            if not token.startswith("la_"):
                continue
            _, account = self.session(token)
            role = account["role"]
            expected = {
                "kitchen": "x-generator-token",
                "owner": "x-plant-token",
                "cbg": "x-admin-token",
                "admin": "x-admin-token",
            }[role]
            if name != expected:
                raise ApiError(401, "UNAUTHORIZED", "This account cannot access that section.")
            result[name] = (
                self.tokens[account["generatorId"]]
                if role == "kitchen"
                else self.owner_token
                if role == "owner"
                else self.admin_token
            )
        return result

    def manage(self, login_id: str, payload: dict, *, actor: str) -> dict:
        """Apply a revision-checked admin action and preserve the last active admin."""
        account = self.accounts.get(login_id)
        if not account or account["status"] == "DELETED":
            raise ApiError(404, "NOT_FOUND", "Account was not found.")
        action = payload.get("action")
        if not isinstance(action, str):
            raise ApiError(400, "INVALID_INPUT", "Choose a valid account action.")
        expected_fields = {"action", "expectedRevision"} | (
            {"password"}
            if action == "password"
            else {"organisation", "contact", "address"}
            if action == "update"
            else set()
        )
        if (
            set(payload) != expected_fields
            or action
            not in {
                "activate",
                "suspend",
                "delete",
                "password",
                "update",
            }
            or type(payload.get("expectedRevision")) is not int
        ):
            raise ApiError(400, "INVALID_INPUT", "Choose a valid account action and revision.")
        if payload["expectedRevision"] != account["revision"]:
            raise ApiError(409, "CONFLICT", "Account changed. Refresh before trying again.")
        if action in {"delete", "suspend"} and login_id == actor:
            raise ApiError(409, "CONFLICT", "Use another Admin to suspend or delete this account.")
        if (
            action in {"delete", "suspend"}
            and account["role"] == "admin"
            and (
                account["status"] == "ACTIVE"
                and sum(
                    row["role"] == "admin" and row["status"] == "ACTIVE"
                    for row in self.accounts.values()
                )
                <= 1
            )
        ):
            raise ApiError(409, "CONFLICT", "Keep at least one active Admin account.")
        if action == "activate":
            if account["role"] == "kitchen" and account.get("profile"):
                self.enroll(account)
            account["status"] = "ACTIVE"
        elif action == "suspend":
            account["status"] = "SUSPENDED"
        elif action == "delete":
            account["status"] = "DELETED"
            account["organisation"] = "Deleted account"
            account["contact"] = account["address"] = ""
            account.pop("profile", None)
            account.pop("capacityKg", None)
            account["salt"] = secrets.token_bytes(16)
            account["hash"] = secrets.token_bytes(32)
        elif action == "password":
            password = self.password(payload)
            account["salt"] = secrets.token_bytes(16)
            account["hash"] = self.hash_password(password, account["salt"])
        else:
            updates = {
                key: self.text(payload, key) for key in ("organisation", "contact", "address")
            }
            account.update(updates)
            if account.get("profile") and account["status"] == "ACTIVE":
                self.enroll(account)
        account["revision"] += 1
        if action != "update":
            self.revoke(login_id)
        self.persist()
        return self.public(login_id, account)

    @staticmethod
    def hash_password(password: str, salt: bytes) -> bytes:
        """Derive a salted hash with the Python standard library."""
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)

    def login(self, payload: dict[str, Any]) -> dict[str, str]:
        """Validate credentials and the selected role before issuing existing scoped access."""
        login_id, password, role = (payload.get(key) for key in ("loginId", "password", "role"))
        if (
            not isinstance(login_id, str)
            or not 1 <= len(login_id) <= 100
            or not isinstance(password, str)
            or not 1 <= len(password) <= 256
            or not isinstance(role, str)
            or role not in ROLES
            or set(payload) != {"loginId", "password", "role"}
        ):
            raise ApiError(400, "INVALID_INPUT", "Enter a login ID, password and valid role.")
        login_id = login_id.strip().lower()
        now = time.monotonic()
        attempts = [value for value in self.failures.get(login_id, []) if now - value < 60]
        if len(attempts) >= 5:
            raise ApiError(429, "RATE_LIMITED", "Too many attempts. Wait one minute and retry.")
        account = self.accounts.get(login_id)
        actual = self.hash_password(password, account["salt"] if account else self.dummy_salt)
        if (
            not account
            or not hmac.compare_digest(actual, account["hash"])
            or role != account["role"]
            or account["status"] != "ACTIVE"
        ):
            self.failures[login_id] = [*attempts, now]
            raise ApiError(401, "UNAUTHORIZED", "Login ID, password or selected role is incorrect.")
        self.failures.pop(login_id, None)
        if role == "kitchen":
            gid = account["generatorId"]
            token, path, storage = self.tokens[gid], f"/g/{gid}", f"feedsure:generator:{gid}"
        elif role == "owner":
            token, path, storage = self.owner_token, "/owner", "feedsure:plant-owner"
        else:
            token, path, storage = (
                self.admin_token,
                "/admin" if role == "admin" else "/plant",
                "feedsure:admin",
            )
        # Domain credentials stay private; each account gets a revocable, eight-hour session.
        token = "la_" + secrets.token_urlsafe(32)
        self.sessions = {key: value for key, value in self.sessions.items() if value[1] > now}
        self.sessions[token] = (login_id, now + 8 * 60 * 60)
        return {
            "role": role,
            "path": path,
            "token": token,
            "storageKey": storage,
            "collectionDate": self.collection_date,
            "loginId": login_id,
        }


def prepare_accounts(
    directory: Path, generator_ids: list[str], origin: str
) -> list[dict[str, str]]:
    """Create or reuse private demo credentials and a readable account table under docs."""
    directory.mkdir(parents=True, exist_ok=True)
    account_file = directory / "LOGIN-CREDENTIALS.local.json"
    if account_file.exists():
        accounts = json.loads(account_file.read_text(encoding="utf-8"))["accounts"]
    else:
        accounts = [
            {
                "loginId": f"kitchen{index:02}",
                "password": secrets.token_urlsafe(12),
                "role": "kitchen",
                "generatorId": gid,
            }
            for index, gid in enumerate(sorted(generator_ids), 1)
        ]
        accounts += [
            {"loginId": f"{role}{index:02}", "password": secrets.token_urlsafe(12), "role": role}
            for role in ("cbg", "owner", "admin")
            for index in (1, 2)
        ]
        account_file.write_text(json.dumps({"accounts": accounts}, indent=2), encoding="utf-8")
    rows = [
        "# Local demo login credentials",
        "",
        "Private synthetic demo accounts. Keep this file local.",
        "",
        f"Open {origin}/login. Choose the role shown for your login ID.",
        "",
        "| Role | Login ID | Password | Organic waste generator |",
        "| --- | --- | --- | --- |",
    ]
    rows += [
        f"| {item['role']} | {item['loginId']} | {item['password']} "
        f"| {item.get('generatorId', '—')} |"
        for item in accounts
    ]
    rows += [
        "",
        "Organic waste generator accounts access only their own organisation. "
        "Owner accounts access plant intake only.",
        "CBG and Admin accounts both have dispatcher permissions in this single-plant prototype.",
        "Passwords survive restarts; demo operational data and tokens reset with the API.",
        "Credentials are excluded from Git. ID/password login is available only locally.",
    ]
    (directory / "LOGIN-CREDENTIALS.local.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
    return accounts
