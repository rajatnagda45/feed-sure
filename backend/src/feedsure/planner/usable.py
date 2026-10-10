"""Pure usable-kilogram calculation skeleton."""

from __future__ import annotations

from typing import Any

PROBABILITIES = {"ACCEPT": 0.95, "INSPECT": 0.6, "HOLD": 0.0}


def expected_usable_kg(
    forecast: float,
    screening: dict[str, Any] | None,
    *,
    prior_accept: float = 0.7,
    prior_contam_pct: float = 2.0,
) -> float:
    """Return expected processable kilograms after quality and acceptance risk."""
    if screening is None:
        probability = float(prior_accept)
        contamination = float(prior_contam_pct)
    else:
        probability = PROBABILITIES.get(str(screening.get("verdict")), 0.0)
        contamination = float(screening.get("visibleContaminantPct", 0))
    usable = max(0.0, float(forecast)) * probability * (1 - contamination / 100)
    return round(max(0.0, usable), 1)
