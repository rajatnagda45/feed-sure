"""Pure generator forecast skeleton."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any


def forecast_kg(
    history: list[dict[str, Any]],
    submission: dict[str, Any] | None,
    plan_date: str | date | None = None,
) -> float:
    """Forecast kilograms from yesterday's report or recent historical volumes."""
    if submission is not None:
        return round(float(submission.get("reportedKg", 0)), 1)

    parsed: list[tuple[date, float]] = []
    for item in history:
        try:
            parsed.append((date.fromisoformat(str(item["date"])), float(item["kg"])))
        except (KeyError, TypeError, ValueError):
            continue
    if not parsed:
        return 0.0
    if plan_date is None:
        target = max(day for day, _kg in parsed) + timedelta(days=1)
    else:
        target = date.fromisoformat(plan_date) if isinstance(plan_date, str) else plan_date
    same_weekday = [kg for day, kg in parsed if day.weekday() == target.weekday()]
    values = same_weekday or [kg for _day, kg in parsed]
    return round(sum(values) / len(values), 1)
