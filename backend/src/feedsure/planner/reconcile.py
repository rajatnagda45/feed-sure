"""Pure pickup-to-net-gate reconciliation."""

from __future__ import annotations

import math
from typing import Any

PICKUP_OUTCOMES = {"COLLECTED", "PARTIAL", "NOT_READY", "SKIPPED"}
WEIGHT_SOURCES = {"SCALE", "ESTIMATE"}
GPS_STATUSES = {"UNKNOWN", "IN_RANGE", "OUT_OF_RANGE"}


def _number(value: Any, name: str, *, maximum: float = 100_000) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        or value > maximum
    ):
        raise ValueError(f"{name} must be a finite non-negative number")
    return float(value)


def reconcile_trip(inputs: dict[str, Any]) -> dict[str, Any]:
    """Reconcile current stop outcomes with an optional net gate measurement."""
    if not isinstance(inputs, dict) or not isinstance(inputs.get("stops"), list):
        raise ValueError("stops must be a list")
    absolute = _number(inputs.get("absoluteToleranceKg", 20), "absoluteToleranceKg")
    percentage = _number(
        inputs.get("percentageTolerancePct", 5),
        "percentageTolerancePct",
        maximum=100,
    )

    picked = 0.0
    provisional = False
    pending: list[str] = []
    gps_flags: list[dict[str, str]] = []
    seen: set[str] = set()
    for stop in inputs["stops"]:
        if not isinstance(stop, dict) or not isinstance(stop.get("generatorId"), str):
            raise ValueError("each stop requires generatorId")
        generator_id = stop["generatorId"]
        if not generator_id.strip() or generator_id in seen:
            raise ValueError("stop generatorIds must be nonempty and unique")
        seen.add(generator_id)
        pickup = stop.get("pickup")
        if pickup is None:
            pending.append(generator_id)
            gps_flags.append({"generatorId": generator_id, "status": "UNKNOWN"})
            continue
        if not isinstance(pickup, dict) or pickup.get("generatorId") != generator_id:
            raise ValueError("pickup must match its assigned stop")
        outcome = pickup.get("outcome")
        if not isinstance(outcome, str) or outcome not in PICKUP_OUTCOMES:
            raise ValueError("pickup outcome is invalid")
        kilograms = _number(pickup.get("kg"), "pickup kg", maximum=5_000)
        source = pickup.get("weightSource")
        unknown = pickup.get("remainingUnknown", False)
        remaining = pickup.get("remainingKg")
        if not isinstance(unknown, bool):
            raise ValueError("remainingUnknown must be boolean")
        if outcome == "PARTIAL":
            reason = pickup.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError("PARTIAL requires a reason")
            if remaining is not None:
                if _number(remaining, "remainingKg", maximum=5_000) <= 0 or unknown:
                    raise ValueError("PARTIAL requires positive remainingKg or remainingUnknown")
            elif not unknown:
                raise ValueError("PARTIAL requires remainingKg or remainingUnknown")
        elif remaining is not None or unknown:
            raise ValueError("only PARTIAL can have remaining load")
        if outcome in {"NOT_READY", "SKIPPED"}:
            reason = pickup.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError("zero-collection outcomes require a reason")
        if outcome in {"COLLECTED", "PARTIAL"}:
            if kilograms <= 0 or not isinstance(source, str) or source not in WEIGHT_SOURCES:
                raise ValueError("positive pickups require kg and weightSource")
            picked += kilograms
            provisional = provisional or source == "ESTIMATE"
        elif kilograms != 0 or source is not None:
            raise ValueError("zero-collection outcomes require zero kg and null source")
        gps_status = pickup.get("gpsStatus", "UNKNOWN")
        if not isinstance(gps_status, str) or gps_status not in GPS_STATUSES:
            raise ValueError("gpsStatus is invalid")
        gps_flags.append({"generatorId": generator_id, "status": gps_status})

    gate = inputs.get("gate")
    picked_value: int | float = int(picked) if picked.is_integer() else picked
    if gate is None:
        return {
            "status": "PENDING_GATE",
            "pickedKg": picked_value,
            "netGateKg": None,
            "deltaKg": None,
            "deltaPct": None,
            "provisional": provisional,
            "pendingStopIds": sorted(pending),
            "gpsFlags": gps_flags,
        }
    if not isinstance(gate, dict):
        raise ValueError("gate must be an object or null")
    gate_kg = _number(gate.get("netKg"), "gate netKg", maximum=5_000)
    gross, tare = gate.get("grossKg"), gate.get("tareKg")
    if gross is not None or tare is not None:
        gross = _number(gross, "grossKg")
        tare = _number(tare, "tareKg")
        if gross < tare or abs(gross - tare - gate_kg) > 1e-9:
            raise ValueError("netKg must equal grossKg minus tareKg")
    gate_source = gate.get("weightSource")
    if not isinstance(gate_source, str) or gate_source not in WEIGHT_SOURCES:
        raise ValueError("gate weightSource is invalid")
    provisional = provisional or gate_source == "ESTIMATE"
    delta = gate_kg - picked
    delta_pct = delta / picked * 100 if picked > 0 else None
    if pending:
        status = "INCOMPLETE"
    elif picked == 0 and gate_kg > 0:
        status = "UNMATCHED_INTAKE"
    elif picked == 0 and gate_kg == 0:
        status = "NO_LOAD"
    else:
        tolerance = max(absolute, picked * percentage / 100)
        status = "REVIEW" if abs(delta) > tolerance else "WITHIN_TOLERANCE"
    return {
        "status": status,
        "pickedKg": picked_value,
        "netGateKg": int(gate_kg) if gate_kg.is_integer() else gate_kg,
        "deltaKg": int(delta) if delta.is_integer() else delta,
        "deltaPct": delta_pct,
        "provisional": provisional,
        "pendingStopIds": sorted(pending),
        "gpsFlags": gps_flags,
    }
