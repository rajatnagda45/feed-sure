"""Generator endpoint handler skeleton."""

from __future__ import annotations

from typing import Any

from feedsure.handlers.operations import handle_request


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle generator API requests."""
    del context
    return handle_request(event)
