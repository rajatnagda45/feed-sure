"""Pure validation shared by the v3 planner and matrix boundary."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

from feedsure.planner.greedy import time_to_minutes


def number(value: Any, name: str, low: float = 0, high: float = math.inf) -> float:
    """Require a finite bounded JSON number, excluding booleans."""
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise ValueError(f"{name} must be a finite number in [{low}, {high}]")
    return float(value)


def text(value: Any, name: str) -> str:
    """Require a nonempty string."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a nonempty string")
    return value


def boolean(value: Any, name: str) -> bool:
    """Require an explicit JSON boolean."""
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be boolean")
    return value


def service_date(value: Any) -> str:
    """Validate an ISO service date without consulting the clock."""
    if not isinstance(value, str):
        raise ValueError("collectionDate must be YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError("collectionDate must be YYYY-MM-DD") from error
    if parsed.isoformat() != value:
        raise ValueError("collectionDate must be YYYY-MM-DD")
    return value


def window(value: Any) -> dict[str, str]:
    """Require a same-day window in which service can be scheduled."""
    if not isinstance(value, dict) or set(value) != {"start", "end"}:
        raise ValueError("window must contain start and end")
    if time_to_minutes(value["start"]) >= time_to_minutes(value["end"]):
        raise ValueError("window end must follow start")
    return dict(value)


def coordinates(point: dict[str, Any]) -> None:
    """Validate finite WGS84 coordinates."""
    number(point.get("lat"), "lat", -90, 90)
    number(point.get("lng"), "lng", -180, 180)


def validate_matrix(matrix: Any, point_ids: list[str]) -> None:
    """Check directed matrix mapping, dimensions, values and unavailable legs."""
    if not isinstance(matrix, dict) or matrix.get("pointIds") != point_ids:
        raise ValueError("matrix pointIds must match the requested point order")
    if len(set(point_ids)) != len(point_ids) or not point_ids or point_ids[0] != "plant":
        raise ValueError("matrix requires plant first and unique pointIds")
    source = matrix.get("source")
    if not isinstance(source, str) or source not in {"location", "fallback", "fixture"}:
        raise ValueError("invalid matrix source")
    size = len(point_ids)
    for field in ("km", "min"):
        rows = matrix.get(field)
        if (
            not isinstance(rows, list)
            or len(rows) != size
            or any(not isinstance(row, list) or len(row) != size for row in rows)
        ):
            raise ValueError("matrix dimensions must match pointIds")
        for i, row in enumerate(rows):
            for j, value in enumerate(row):
                if value is not None:
                    number(value, f"matrix {field}[{i}][{j}]")
                if i == j and value != 0:
                    raise ValueError("matrix diagonal must be zero")
    for i in range(size):
        for j in range(size):
            if (matrix["km"][i][j] is None) != (matrix["min"][i][j] is None):
                raise ValueError("unavailable legs require null distance and duration")
