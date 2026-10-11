"""Shared synthetic readiness scenarios for local and portable demo seeds."""

from __future__ import annotations

from datetime import date
from typing import Any


def demo_readiness_rows(collection_date: date) -> list[dict[str, Any]]:
    """Return ten reproducible states; none represents measured business waste."""
    rows = []
    for index in range(10):
        status = "UNCONFIRMED" if index in {7, 8} else "NOT_READY" if index == 2 else "READY"
        rows.append(
            {
                "generatorId": f"demo-kitchen-{index + 1:02d}",
                "collectionDate": collection_date.isoformat(),
                "status": status,
                "confirmedKg": (2500 if index == 9 else 180)
                if status == "READY"
                else (0 if status == "NOT_READY" else None),
                "weightSource": "ESTIMATE" if status == "READY" else None,
                "window": {"start": "06:00", "end": "06:05" if index == 6 else "09:00"}
                if status == "READY"
                else None,
                "reason": "Synthetic cancellation" if status == "NOT_READY" else None,
            }
        )
    return rows
