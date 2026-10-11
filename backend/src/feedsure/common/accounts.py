"""Supabase account lifecycle; passwords are held only by Supabase Auth."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
from typing import Any
from uuid import UUID

from feedsure.common.config import Config
from feedsure.common.supabase import json_request, request
from feedsure.common.v3 import ApiError, body, fields, header, invalid, number, revision, text

ROLES = {
    "kitchen": "GENERATOR",
    "cbg": "ADMIN",
    "owner": "PLANT_OWNER",
    "admin": "ADMIN",
    "driver": "DRIVER",
}


def uuid(value: Any) -> str:
    """Require canonical UUIDs before constructing privileged API paths."""
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        invalid("Account/session ID must be a UUID.")


def public(row: dict) -> dict:
    """Expose reviewed profile fields, never internal password-operation receipts."""
    return {
        "id": row["id"],
        "loginId": row["email"],
        "role": row["role"],
        "status": row["status"],
        "revision": row["revision"],
        "organisation": row["organisation"],
        "contact": row["contact"],
        "address": row["address"],
        "generatorId": row.get("generator_id"),
        "capacityKg": row.get("capacity_kg"),
        "profile": row.get("profile") or None,
    }


def access(row: dict) -> dict:
    """Map the trusted registry to existing operational permissions."""
    if row["status"] != "ACTIVE":
        raise ApiError(403, "FORBIDDEN", "Your registration is pending Admin approval.")
    role = ROLES.get(row["role"])
    result = {"id": row["id"], "role": role, "accountRole": row["role"]}
    if role == "GENERATOR":
        gid = row.get("generator_id")
        if not isinstance(gid, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", gid):
            raise ApiError(403, "FORBIDDEN", "Generator access has no valid assignment.")
        result["generatorId"] = gid
        if gid.startswith("registered-"):
            result["registration"] = public(row)
    elif role == "DRIVER":
        from feedsure.common.v3 import split_plan

        split_plan(row.get("plan_key"))
        result["planKey"] = row["plan_key"]
    elif role not in {"ADMIN", "PLANT_OWNER"}:
        raise ApiError(403, "FORBIDDEN", "Account role is unavailable.")
    return result


class Accounts:
    """Privileged REST operations behind verified identity and transactional RPCs."""

    def __init__(self, config: Config, service: Any = None) -> None:
        self.config, self.service = config, service
        self.actor: str | None = None
        self.session: str | None = None

    def rpc(self, action: str, **options: Any) -> dict:
        result = json_request(
            self.config,
            "/rest/v1/rpc/feedsure_accounts_api",
            key=self.config.supabase_service_role_key,
            method="POST",
            data=json.dumps(
                {"p_actor": self.actor, "p_session": self.session, "p_action": action, **options}
            ).encode(),
        )
        if "error" in result:
            status = result.get("status", 502)
            codes = {
                400: "INVALID_INPUT",
                401: "UNAUTHORIZED",
                403: "FORBIDDEN",
                404: "NOT_FOUND",
                409: "CONFLICT",
            }
            if status not in codes:
                raise ApiError(502, "UPSTREAM_FAILED", "Account registry is unavailable.")
            raise ApiError(status, codes[status], result["error"])
        return result

    def identity(self, event: dict, *, user: dict | None = None) -> dict:
        auth = header(event, "authorization")
        if not auth.startswith("Bearer ") or not 1 <= len(auth[7:]) <= 8192:
            raise ApiError(401, "UNAUTHORIZED", "Sign in with your Supabase account.")
        if user is None:
            user = json_request(
                self.config,
                "/auth/v1/user",
                key=self.config.supabase_publishable_key,
                token=auth[7:],
            )
        # Auth has verified THIS token. Decode only its session identifier, never roles.
        try:
            claims = json.loads(base64.urlsafe_b64decode(auth[7:].split(".")[1] + "=="))
            self.actor, self.session = uuid(user.get("id")), uuid(claims.get("session_id"))
        except (ValueError, IndexError, TypeError, AttributeError, ApiError):
            raise ApiError(401, "UNAUTHORIZED", "Supabase session is invalid.") from None
        return self.rpc("identity")

    @staticmethod
    def registration(payload: dict) -> dict:
        fields(
            payload,
            {
                "role",
                "email",
                "password",
                "organisation",
                "contact",
                "address",
                "lat",
                "lng",
                "type",
                "capacityKg",
            },
        )
        role = payload.get("role")
        if role not in {"kitchen", "cbg", "owner", "admin"}:
            invalid("Choose a valid account role.")
        result = {
            "role": role,
            **{
                key: text(payload.get(key), key, required=True, limit=200)
                for key in ("organisation", "contact", "address")
            },
        }
        if role == "kitchen":
            if payload.get("type") not in {"hotel", "hostel_mess", "pg", "restaurant", "canteen"}:
                invalid("Choose a valid generator type.")
            result["profile"] = {
                "lat": number(payload.get("lat"), "lat", -90, 90),
                "lng": number(payload.get("lng"), "lng", -180, 180),
                "type": payload["type"],
            }
        elif role != "admin":
            result["capacityKg"] = number(payload.get("capacityKg"), "capacityKg", 0.01, 1e9)
        return result

    @staticmethod
    def password(value: Any) -> str:
        if not isinstance(value, str) or not 12 <= len(value) <= 256:
            invalid("Password must contain 12–256 characters.")
        return value

    def manager(self, row: dict) -> None:
        if row["role"] != "admin" or row["status"] != "ACTIVE":
            raise ApiError(403, "FORBIDDEN", "Admin account access required.")

    def create(self, payload: dict) -> dict:
        self.rpc("list")  # Recheck active Admin access immediately before privileged Auth creation.
        registration = self.registration(payload)
        email = text(payload.get("email"), "email", required=True, limit=254)
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            invalid("Use a valid email address.")
        user = json_request(
            self.config,
            "/auth/v1/admin/users",
            method="POST",
            key=self.config.supabase_service_role_key,
            data=json.dumps(
                {
                    "email": email,
                    "password": self.password(payload.get("password")),
                    "email_confirm": True,
                    "user_metadata": {"feedsure_registration": registration},
                    "app_metadata": {"feedsure_account_role": registration["role"]},
                }
            ).encode(),
        )
        return public(self.rpc("inspect", p_target=uuid(user["id"])))

    def enroll(self, account: dict) -> None:
        """Idempotently restore approved generator profiles into AWS/local DynamoDB."""
        profile = account.get("profile") or {}
        gid = account.get("generatorId")
        if not isinstance(gid, str) or not gid.startswith("registered-"):
            return
        lat = number(profile.get("lat"), "lat", -90, 90)
        lng = number(profile.get("lng"), "lng", -180, 180)
        if profile.get("type") not in {"hotel", "hostel_mess", "pg", "restaurant", "canteen"}:
            invalid("Generator registration needs valid pickup details.")
        if self.service.db.get("generators", {"generatorId": gid}, consistent_read=True):
            return
        record = {
            "generatorId": gid,
            "name": account["organisation"],
            "address": account["address"],
            "lat": lat,
            "lng": lng,
            "type": profile["type"],
            "defaultLang": "EN",
            "supportedMaterial": True,
            "simulated": bool(self.config.aws_endpoint_url),
            "pickupStart": "06:00",
            "pickupEnd": "09:00",
            "schemaVersion": 3,
            "tokenHash": hashlib.sha256(secrets.token_bytes(32)).hexdigest(),
        }
        from botocore.exceptions import ClientError

        try:
            self.service.db.transact(
                [
                    self.service.db.conditional_put(
                        "generators", record, "attribute_not_exists(generatorId)"
                    )
                ]
            )
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in {
                "ConditionalCheckFailedException",
                "TransactionCanceledException",
            }:
                raise
            if not self.service.db.get("generators", {"generatorId": gid}, consistent_read=True):
                raise

    def mutate(self, target: dict, payload: dict, *, own: bool) -> dict:
        fields(
            payload,
            {
                "action",
                "expectedRevision",
                "password",
                "currentPassword",
                "organisation",
                "contact",
                "address",
            },
        )
        action = payload.get("action")
        if action not in (
            {"password", "delete"}
            if own
            else {"activate", "suspend", "delete", "update", "password"}
        ):
            invalid("Choose a valid account action.")
        expected = revision(payload.get("expectedRevision"))
        if target["revision"] != expected:
            raise ApiError(409, "CONFLICT", "Account changed. Refresh before retrying.")
        if own:
            current = text(
                payload.get("currentPassword"), "currentPassword", required=True, limit=256
            )
            verified = json_request(
                self.config,
                "/auth/v1/token?grant_type=password",
                method="POST",
                key=self.config.supabase_publishable_key,
                data=json.dumps({"email": target["email"], "password": current}).encode(),
            )
            if verified.get("user", {}).get("id") != self.actor:
                raise ApiError(401, "UNAUTHORIZED", "Current password is incorrect.")
            # Close the temporary reauthentication session without affecting other devices.
            request(
                self.config,
                "/auth/v1/logout?scope=local",
                method="POST",
                key=self.config.supabase_publishable_key,
                token=verified["access_token"],
            )
        changes = {}
        password = self.password(payload.get("password")) if action == "password" else None
        if action == "update":
            changes = {
                key: text(payload[key], key, required=True, limit=200)
                for key in ("organisation", "contact", "address")
                if key in payload
            }
        if action == "activate":
            for key in ("organisation", "contact", "address"):
                text(target[key], key, required=True, limit=200)
            if target["role"] == "kitchen":
                self.enroll(public(target))
            elif target["role"] in {"cbg", "owner"}:
                number(target.get("capacity_kg"), "capacityKg", 0.01, 1e9)
        result = self.rpc(action, p_target=target["id"], p_revision=expected, p_changes=changes)
        if action == "password":
            try:
                request(
                    self.config,
                    "/auth/v1/admin/users/" + uuid(target["id"]),
                    method="PUT",
                    key=self.config.supabase_service_role_key,
                    data=json.dumps({"password": password}).encode(),
                )
            finally:
                self.rpc("password_finish", p_target=target["id"], p_ticket=result["ticket"])
        elif action == "delete":
            # Tombstone already denies access even if upstream deletion fails.
            request(
                self.config,
                "/auth/v1/admin/users/" + uuid(target["id"]),
                method="DELETE",
                key=self.config.supabase_service_role_key,
            )
        return public(result)

    def route(self, event: dict, path: str, method: str) -> dict:
        if self.config.auth_provider != "supabase" or not self.config.supabase_account_management:
            raise ApiError(
                503,
                "DEPENDENCY_NOT_READY",
                "Enable Supabase account management after its migration.",
            )
        row = self.identity(event)
        if path == "/auth/account":
            if method == "GET":
                return public(row)
            if method == "POST":
                return self.mutate(row, body(event), own=True)
        self.manager(row)
        if path == "/auth/accounts":
            if method == "GET":
                return {"accounts": [public(item) for item in self.rpc("list")["accounts"]]}
            if method == "POST":
                return self.create(body(event))
        if method == "POST" and re.fullmatch(r"/auth/accounts/[^/]+", path):
            target = self.rpc("inspect", p_target=uuid(path.rsplit("/", 1)[1]))
            return self.mutate(target, body(event), own=False)
        raise ApiError(404, "NOT_FOUND", "Account endpoint was not found.")
