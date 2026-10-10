"""Amazon Location route-matrix boundary with deterministic fallback and caching."""

from __future__ import annotations

import hashlib
import math
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3

from feedsure.common.config import Config, get_config
from feedsure.common.db import DynamoDB

MAX_BLOCK_SIDE = 10
MIN_CALL_INTERVAL_SECONDS = 0.2


def ordered_points(plant: dict[str, Any], generators: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the plant followed by generators in stable identifier order."""
    return [plant, *sorted(generators, key=lambda item: str(item["generatorId"]))]


def _point_id(point: dict[str, Any]) -> str:
    return str(point.get("generatorId", point.get("id", "plant")))


def matrix_cache_key(points: list[dict[str, Any]]) -> str:
    """Build the documented cache key from sorted point identifiers."""
    identifiers = sorted(_point_id(point) for point in points)
    digest = hashlib.sha1("\n".join(identifiers).encode()).hexdigest()
    return f"MATRIX#{digest}"


def haversine_km(first: dict[str, Any], second: dict[str, Any]) -> float:
    """Return great-circle distance between two WGS84 points in kilometres."""
    lat1, lng1 = math.radians(float(first["lat"])), math.radians(float(first["lng"]))
    lat2, lng2 = math.radians(float(second["lat"])), math.radians(float(second["lng"]))
    delta_lat, delta_lng = lat2 - lat1, lng2 - lng1
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return 6371.0088 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def fallback_matrix(points: list[dict[str, Any]], config: Config) -> dict[str, Any]:
    """Build a complete road-adjusted haversine distance and duration matrix."""
    kilometres = [
        [round(haversine_km(origin, destination) * config.road_factor, 6) for destination in points]
        for origin in points
    ]
    minutes = [
        [round(distance / config.fallback_speed_kmph * 60, 6) for distance in row]
        for row in kilometres
    ]
    return {"pointIds": [_point_id(point) for point in points], "km": kilometres, "min": minutes}


def _location_client(config: Config) -> Any:
    return boto3.client("geo-routes", region_name=config.location_region)


def _location_matrix(
    points: list[dict[str, Any]], client: Any, sleeper: Callable[[float], None]
) -> dict[str, Any]:
    size = len(points)
    kilometres = [[0.0] * size for _ in range(size)]
    minutes = [[0.0] * size for _ in range(size)]
    calls = 0
    for origin_start in range(0, size, MAX_BLOCK_SIDE):
        origins = points[origin_start : origin_start + MAX_BLOCK_SIDE]
        for destination_start in range(0, size, MAX_BLOCK_SIDE):
            destinations = points[destination_start : destination_start + MAX_BLOCK_SIDE]
            if calls:
                sleeper(MIN_CALL_INTERVAL_SECONDS)
            response = client.calculate_route_matrix(
                Origins=[
                    {"Position": [float(point["lng"]), float(point["lat"])]} for point in origins
                ],
                Destinations=[
                    {"Position": [float(point["lng"]), float(point["lat"])]}
                    for point in destinations
                ],
                TravelMode="Truck",
                RoutingBoundary={
                    "Geometry": {"AutoCircle": {"Margin": 10_000, "MaxRadius": 190_000}}
                },
            )
            calls += 1
            rows = response["RouteMatrix"]
            if response.get("ErrorCount", 0) or len(rows) != len(origins):
                raise ValueError("Location returned an incomplete route matrix")
            for row_offset, row in enumerate(rows):
                if len(row) != len(destinations):
                    raise ValueError("Location returned an incomplete route-matrix row")
                for column_offset, entry in enumerate(row):
                    if entry.get("Error") or "Distance" not in entry or "Duration" not in entry:
                        raise ValueError("Location returned a failed route-matrix entry")
                    row_index = origin_start + row_offset
                    column_index = destination_start + column_offset
                    kilometres[row_index][column_index] = round(float(entry["Distance"]) / 1000, 6)
                    minutes[row_index][column_index] = round(float(entry["Duration"]) / 60, 6)
    return {"pointIds": [_point_id(point) for point in points], "km": kilometres, "min": minutes}


def build_matrix(
    points: list[dict[str, Any]],
    *,
    plan_date: str = "cache",
    config: Config | None = None,
    database: DynamoDB | None = None,
    client: Any | None = None,
    now: datetime | None = None,
    sleeper: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Load a cached matrix or build one with Location and a complete fallback."""
    config = config or get_config()
    current = now or datetime.now(UTC)
    cache_key = matrix_cache_key(points)
    if database is not None:
        try:
            cached = database.get("plans", {"date": plan_date, "planId": cache_key})
            if cached and int(cached.get("ttl", 0)) > int(current.timestamp()):
                return {
                    "pointIds": cached["points"],
                    "km": cached["km"],
                    "min": cached["min"],
                    "source": "cache",
                }
        except Exception:
            pass

    source = "fallback"
    if config.mock_location:
        data = fallback_matrix(points, config)
    else:
        try:
            data = _location_matrix(points, client or _location_client(config), sleeper)
            source = "location"
        except Exception:
            data = fallback_matrix(points, config)
    if database is not None:
        try:
            database.put(
                "plans",
                {
                    "date": plan_date,
                    "planId": cache_key,
                    "points": data["pointIds"],
                    "km": data["km"],
                    "min": data["min"],
                    "source": source,
                    "ttl": int((current + timedelta(days=2)).timestamp()),
                },
            )
        except Exception:
            pass
    return {**data, "source": source}
