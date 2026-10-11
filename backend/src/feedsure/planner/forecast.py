"""Legacy operator quantity guidance; never authorises READY v3 collections."""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any


def forecast_kg(
    history: list[dict[str, Any]],
    submission: dict[str, Any] | None,
    plan_date: str | date | None = None,
) -> float:
    """Suggest legacy volumes from prior dates; the v3 planner does not call this helper."""
    if submission is not None:
        quantity = float(submission.get("reportedKg", 0))
        if not math.isfinite(quantity) or quantity < 0:
            raise ValueError("reportedKg must be finite and non-negative")
        return round(quantity, 1)

    parsed: list[tuple[date, float]] = []
    for item in history:
        try:
            quantity = float(item["kg"])
            if math.isfinite(quantity) and quantity >= 0:
                parsed.append((date.fromisoformat(str(item["date"])), quantity))
        except (KeyError, TypeError, ValueError):
            continue
    if not parsed:
        return 0.0
    if plan_date is None:
        target = max(day for day, _kg in parsed) + timedelta(days=1)
    else:
        target = date.fromisoformat(plan_date) if isinstance(plan_date, str) else plan_date
    previous = [(day, kg) for day, kg in parsed if day < target]
    same_weekday = [kg for day, kg in previous if day.weekday() == target.weekday()]
    values = same_weekday or [kg for _day, kg in previous]
    if not values:
        return 0.0
    return round(sum(values) / len(values), 1)
