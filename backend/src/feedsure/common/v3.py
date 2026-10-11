"""Shared bounded validation and access primitives for the v3 operational API."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import re
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import unquote


class ApiError(Exception):
    """An intentionally public error without transport details or credentials."""

    def __init__(self, status: int, code: str, message: str) -> None:
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def invalid(message: str) -> None:
    """Reject invalid public input."""
    raise ApiError(400, "INVALID_INPUT", message)


def conflict(message: str) -> None:
    """Reject an optimistic write or reused mutation key."""
    raise ApiError(409, "CONFLICT", message)


def header(event: dict[str, Any], name: str) -> str:
    """Read case-insensitive HTTP headers."""
    return next(
        (str(v) for k, v in (event.get("headers") or {}).items() if k.lower() == name.lower()), ""
    )


def body(event: dict[str, Any]) -> dict[str, Any]:
    """Decode bounded JSON; non-finite numbers are rejected later per field."""
    try:
        raw = event.get("body") or "{}"
        data = (
            base64.b64decode(raw, validate=True) if event.get("isBase64Encoded") else raw.encode()
        )
        if len(data) > 16384:
            invalid("Body exceeds 16 KB.")
        value = json.loads(data)
    except (ValueError, TypeError, AttributeError, UnicodeError) as error:
        raise ApiError(400, "INVALID_INPUT", "Body must be valid JSON.") from error
    if not isinstance(value, dict):
        invalid("Body must be an object.")
    return value


def fields(value: dict[str, Any], allowed: set[str]) -> None:
    """Reject misspelled or unsupported mutation fields."""
    if set(value) - allowed:
        invalid("Unknown fields: " + ", ".join(sorted(set(value) - allowed)))


def number(value: Any, name: str, minimum: float = 0, maximum: float = 5000) -> float:
    """Validate a bounded finite JSON number, excluding bool."""
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not minimum <= value <= maximum
    ):
        invalid(f"{name} must be a finite number between {minimum} and {maximum}.")
    return float(value)


def revision(value: Any) -> int:
    """Validate a non-negative optimistic revision."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        invalid("Revision must be a non-negative integer.")
    return value


def text(value: Any, name: str, *, required: bool = False, limit: int = 300) -> str | None:
    """Validate short plain text without interpreting it."""
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        invalid(f"{name} must be a short non-empty string.")
    return value.strip()


def service_date(value: Any) -> str:
    """Require canonical service dates, independent of UTC event dates."""
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError
    except ValueError:
        invalid("collectionDate must be YYYY-MM-DD.")
    return value


def clock(value: Any) -> str:
    """Validate one same-day HH:MM time."""
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        invalid("Window and shift times must be HH:MM.")
    return value


def window(value: Any) -> dict[str, str]:
    """Validate service completion bounds; overnight windows are unsupported."""
    if not isinstance(value, dict):
        invalid("window must contain start and end.")
    fields(value, {"start", "end"})
    start, end = clock(value.get("start")), clock(value.get("end"))
    if start >= end:
        invalid("Window start must precede end on the same day.")
    return {"start": start, "end": end}


def stamp(now: datetime) -> str:
    """Format UTC server time retaining microseconds."""
    return now.astimezone(UTC).isoformat().replace("+00:00", "Z")


def digest(value: Any) -> str:
    """Hash a canonical JSON payload; never persist the raw authenticated request."""
    try:
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError):
        invalid("Payload contains invalid JSON values.")
    return hashlib.sha256(raw.encode()).hexdigest()


def secret_matches(token: str, hashed: str) -> bool:
    """Compare hashed scoped bearer tokens without timing-sensitive equality."""
    return bool(token and hashed) and hmac.compare_digest(
        hashlib.sha256(token.encode()).hexdigest(), hashed
    )


def split_plan(value: Any) -> tuple[str, str]:
    """Decode a public plan key once and preserve the existing date/shortId keys."""
    if not isinstance(value, str):
        invalid("planKey is required.")
    decoded = unquote(value)
    parts = decoded.split("#")
    if len(parts) != 2 or not re.fullmatch(r"p-[a-zA-Z0-9-]{1,64}", parts[1]):
        invalid("planKey must be collectionDate#p-id.")
    return service_date(parts[0]), parts[1]
