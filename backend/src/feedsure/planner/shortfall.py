"""Pure intake shortfall attribution."""

from __future__ import annotations

from typing import Any


def explain_shortfall(
    target_kg: float,
    usable_kg: float,
    contributions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Aggregate lost kilograms by documented reason code."""
    missing = round(max(0.0, float(target_kg) - float(usable_kg)), 1)
    if missing == 0:
        return {"kg": 0.0, "targetMet": True, "reasons": []}
    grouped: dict[str, dict[str, Any]] = {}
    for contribution in contributions or []:
        kilograms = round(max(0.0, float(contribution.get("kg", 0))), 1)
        if kilograms == 0:
            continue
        code = str(contribution["code"])
        row = grouped.setdefault(code, {"code": code, "kg": 0.0, "generatorIds": []})
        row["kg"] = round(row["kg"] + kilograms, 1)
        row["generatorIds"].append(str(contribution["generatorId"]))
    reasons = list(grouped.values())
    for reason in reasons:
        reason["generatorIds"] = sorted(set(reason["generatorIds"]))
    reasons.sort(key=lambda reason: (-reason["kg"], reason["code"]))
    return {"kg": missing, "targetMet": False, "reasons": reasons}
