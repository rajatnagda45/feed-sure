"""Bounded Supabase REST adapters; privileged credentials stay on the server."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request

from feedsure.common.config import Config
from feedsure.common.v3 import ApiError, header


class NoRedirects(HTTPRedirectHandler):
    """Never forward privileged credentials to a redirected endpoint."""

    def redirect_request(
        self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


def request(
    config: Config,
    path: str,
    *,
    key: str,
    token: str | None = None,
    method: str = "GET",
    data: bytes | None = None,
    content_type: str = "application/json",
    limit: int = 65_536,
) -> tuple[bytes, str]:
    """Call only the configured HTTPS origin, with timeout and bounded responses."""
    from urllib.request import build_opener

    base = config.supabase_url.rstrip("/")
    url = urlsplit(base)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.path
        or url.query
        or url.fragment
        or not key
    ):
        raise ApiError(503, "DEPENDENCY_NOT_READY", "Configure Supabase URL and server keys.")
    req = Request(
        base + path,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + (token or key),
            "Content-Type": content_type,
        },
    )
    try:
        with build_opener(NoRedirects()).open(
            req, timeout=config.supabase_timeout_seconds
        ) as reply:
            payload = reply.read(limit + 1)
            if len(payload) > limit:
                raise ApiError(502, "UPSTREAM_FAILED", "Supabase response exceeds limits.")
            return payload, reply.headers.get_content_type()
    except HTTPError as error:
        if path == "/auth/v1/user" and error.code in {401, 403}:
            raise ApiError(
                401, "UNAUTHORIZED", "Login is invalid or expired. Sign in again."
            ) from None
        if path.startswith("/auth/v1/token") and error.code in {400, 401, 403}:
            raise ApiError(401, "UNAUTHORIZED", "Current password is incorrect.") from None
        if error.code == 429:
            raise ApiError(
                429, "RATE_LIMITED", "Too many attempts. Wait before retrying."
            ) from None
        if error.code == 404:
            if path.startswith("/rest/v1/rpc/"):
                raise ApiError(
                    503, "DEPENDENCY_NOT_READY", "Run the Supabase account migration."
                ) from None
            if path.startswith("/auth/"):
                raise ApiError(404, "NOT_FOUND", "Account is unavailable.") from None
            raise ApiError(404, "NOT_FOUND", "Saved image is unavailable.") from None
        raise ApiError(502, "UPSTREAM_FAILED", "Supabase request failed. Retry safely.") from None
    except (URLError, TimeoutError, OSError):
        raise ApiError(502, "UPSTREAM_FAILED", "Supabase is unavailable. Try again.") from None


def json_request(config: Config, path: str, **options: Any) -> dict:
    """Decode a small JSON response without exposing service error bodies."""
    raw, _ = request(config, path, **options)
    try:
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError
        return result
    except (ValueError, UnicodeError):
        raise ApiError(502, "UPSTREAM_FAILED", "Supabase returned an invalid response.") from None


def authenticate(event: dict, config: Config) -> dict:
    """Validate a bearer with Auth, then read only administrator-controlled metadata."""
    auth = header(event, "authorization")
    if not auth.startswith("Bearer ") or not 1 <= len(auth[7:]) <= 8192:
        raise ApiError(401, "UNAUTHORIZED", "Sign in with your Supabase account.")
    user = json_request(
        config, "/auth/v1/user", key=config.supabase_publishable_key, token=auth[7:]
    )
    if config.supabase_account_management:
        from feedsure.common.accounts import Accounts, access

        row = Accounts(config).identity(event, user=user)
        return access(row)
    metadata = user.get("app_metadata")
    uid = user.get("id")
    if not isinstance(uid, str) or not uid or not isinstance(metadata, dict):
        raise ApiError(403, "FORBIDDEN", "Ask your operator to assign account access.")
    role = metadata.get("feedsure_role")
    access = {"id": uid, "role": role}
    if role in {"ADMIN", "PLANT_OWNER"}:
        return access
    if role == "GENERATOR" and isinstance(metadata.get("generator_id"), str):
        gid = metadata["generator_id"]
        if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", gid):
            return {**access, "generatorId": gid}
    if role == "DRIVER" and isinstance(metadata.get("plan_key"), str):
        from feedsure.common.v3 import split_plan

        split_plan(metadata["plan_key"])
        return {**access, "planKey": metadata["plan_key"]}
    raise ApiError(403, "FORBIDDEN", "Ask your operator to assign account access.")


class Storage:
    """Private storage reached only after the domain handler checks account scope."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.key = config.supabase_service_role_key
        self.root = "/storage/v1"

    def path(self, key: str) -> str:
        return quote(self.config.supabase_photos_bucket, safe="") + "/" + quote(key, safe="/")

    def signed(self, key: str, *, upload: bool) -> str:
        """Issue a write-once upload or a short-lived private read capability."""
        prefix = "/object/upload/sign/" if upload else "/object/sign/"
        data = {} if upload else {"expiresIn": self.config.upload_expiry_seconds}
        result = json_request(
            self.config,
            self.root + prefix + self.path(key),
            key=self.key,
            method="POST",
            data=json.dumps(data).encode(),
        )
        relative = result.get("url" if upload else "signedURL")
        expected = "/object/upload/sign/" if upload else "/object/sign/"
        if not isinstance(relative, str) or not relative.startswith(expected):
            raise ApiError(502, "UPSTREAM_FAILED", "Supabase returned an invalid image URL.")
        return self.config.supabase_url.rstrip("/") + self.root + relative

    def get(self, key: str) -> tuple[bytes, str]:
        """Read bounded private bytes; callers validate the complete image structure."""
        return request(
            self.config,
            self.root + "/object/" + self.path(key),
            key=self.key,
            limit=self.config.upload_max_bytes,
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        """Freeze validated evidence under a new key never issued to the browser."""
        request(
            self.config,
            self.root + "/object/" + self.path(key),
            key=self.key,
            method="POST",
            data=data,
            content_type=content_type,
        )
