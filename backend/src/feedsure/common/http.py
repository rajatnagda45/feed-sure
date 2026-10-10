"""API Gateway HTTP response helpers."""

from __future__ import annotations

import json
from typing import Any


def json_response(status_code: int, body: dict[str, Any]) -> dict[str, Any]:
    """Build an API Gateway v2 JSON response."""
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, separators=(",", ":")),
    }


def error_response(status_code: int, code: str, message: str) -> dict[str, Any]:
    """Build the documented API error response shape."""
    return json_response(status_code, {"error": {"code": code, "message": message}})


def not_implemented(resource: str) -> dict[str, Any]:
    """Return the common M0 placeholder response."""
    return error_response(
        501,
        "NOT_IMPLEMENTED",
        f"{resource} is scaffolded for M0.",
    )
