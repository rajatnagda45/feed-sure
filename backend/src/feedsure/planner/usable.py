"""Pure collection estimates; photos never measure or discount whole-load mass."""

from __future__ import annotations

from feedsure.planner.validation import number


def collection_quantities(
    confirmed_kg: float,
    *,
    readiness_prior: float,
    capacity_buffer: float,
    volume_ratio: float = 1,
) -> dict[str, float]:
    """Separate expected collection from full-load capacity reservation assumptions."""
    confirmed = number(confirmed_kg, "confirmedKg", 0, 5000)
    probability = number(readiness_prior, "readinessPrior", 0, 1)
    buffer = number(capacity_buffer, "capacityBuffer", 0, 1)
    ratio = number(volume_ratio, "volumeRatio", 0.5, 1.5)
    base = confirmed * ratio
    return {
        "baseKg": base,
        "expectedCollectionKg": base * probability,
        "reservedLoadKg": max(confirmed, base) * (1 + buffer),
    }
