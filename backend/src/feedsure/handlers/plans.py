"""Thin v3 plan entrypoints; domain validation and transactions share the local handler."""

from __future__ import annotations

from typing import Any

from feedsure.handlers.operations import handle_request


def handle_create_plan(event: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    """Create a readiness-based draft using the real Session 2 planner."""
    event = {**event, "rawPath": "/plans", "requestContext": {"http": {"method": "POST"}}}
    return handle_request(event, **kwargs)


def handle_get_plan(event: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    """Read the latest stored v3 plan, returning an explicit null when absent."""
    day = str((event.get("pathParameters") or {}).get("date", ""))
    event = {**event, "rawPath": "/plans/" + day, "requestContext": {"http": {"method": "GET"}}}
    return handle_request(event, **kwargs)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Forward plan routes to the v3 operational handler."""
    del context
    return handle_request(event)
