"""Generator endpoint handler skeleton."""

from __future__ import annotations

from typing import Any

from feedsure.common.http import not_implemented


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle generator API requests."""
    del event, context
    return not_implemented("Generator endpoints")
