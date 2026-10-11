"""Amazon Location route-matrix boundary with validated fallback and cache identity."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from feedsure.common.config import Config, get_config
from feedsure.planner.validation import number

MAX_BLOCK_SIDE = 10
MIN_CALL_INTERVAL_SECONDS = 0.2
TRAVEL_MODE = "Truck"
ROUTING_BOUNDARY = {"Geometry": {"AutoCircle": {"Margin": 10_000, "MaxRadius": 190_000}}}
LEG_ERRORS = {
    "NoMatch",
    "NoMatchDestination",
    "NoMatchOrigin",
    "NoRoute",
    "OutOfBounds",
    "OutOfBoundsDestination",
    "OutOfBoundsOrigin",
    "Other",
    "Violation",
}


def ordered_points(plant: dict[str, Any], generators: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the plant followed by generators in stable identifier order."""
    return [plant, *sorted(generators, key=lambda item: str(item["generatorId"]))]


def _point_id(point: dict[str, Any]) -> str:
    value = point.get("generatorId", point.get("id"))
    if not isinstance(value, str) or not value.strip():
        raise ValueError("matrix point requires a nonempty identifier")
    return value


def _validate_points(points: list[dict[str, Any]]) -> None:
    if not isinstance(points, list) or not points:
        raise ValueError("matrix points must be a nonempty list")
    identifiers: list[str] = []
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("matrix points must be objects")
        identifier = _point_id(point)
        if not identifier:
            raise ValueError("matrix point identifiers must be nonempty")
        identifiers.append(identifier)
        for field, lower, upper in (("lat", -90, 90), ("lng", -180, 180)):
            value = point.get(field)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or not lower <= value <= upper
            ):
                raise ValueError(f"matrix point {field} is invalid")
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("matrix point identifiers must be unique")


def matrix_cache_key(
    points: list[dict[str, Any]],
    *,
    provider: str = "location",
    region: str = "",
    travel_mode: str = TRAVEL_MODE,
    route_options: dict[str, Any] | None = None,
    road_factor: float | None = None,
    fallback_speed_kmph: float | None = None,
) -> str:
    """Hash ordered IDs, coordinates, provider and travel/fallback options."""
    _validate_points(points)
    identity = {
        "points": [
            {
                "id": _point_id(point),
                "lat": float(point["lat"]),
                "lng": float(point["lng"]),
            }
            for point in points
        ],
        "provider": provider,
        "region": region,
        "travelMode": travel_mode,
        "routeOptions": ROUTING_BOUNDARY if route_options is None else route_options,
        "roadFactor": road_factor,
        "fallbackSpeedKmph": fallback_speed_kmph,
    }
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return f"MATRIX#{hashlib.sha256(canonical.encode()).hexdigest()}"


def haversine_km(first: dict[str, Any], second: dict[str, Any]) -> float:
    """Return great-circle distance between two WGS84 points in kilometres."""
    lat1, lng1 = math.radians(float(first["lat"])), math.radians(float(first["lng"]))
    lat2, lng2 = math.radians(float(second["lat"])), math.radians(float(second["lng"]))
    delta_lat, delta_lng = lat2 - lat1, lng2 - lng1
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    value = max(0.0, min(1.0, value))
    return 6371.0088 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def fallback_matrix(points: list[dict[str, Any]], config: Config) -> dict[str, Any]:
    """Build a complete, labelled road-factor haversine matrix."""
    _validate_points(points)
    if (
        not math.isfinite(config.road_factor)
        or config.road_factor <= 0
        or not math.isfinite(config.fallback_speed_kmph)
        or config.fallback_speed_kmph <= 0
    ):
        raise ValueError("fallback matrix settings must be positive and finite")
    kilometres = [
        [round(haversine_km(origin, destination) * config.road_factor, 6) for destination in points]
        for origin in points
    ]
    minutes = [
        [round(distance / config.fallback_speed_kmph * 60, 6) for distance in row]
        for row in kilometres
    ]
    return {
        "pointIds": [_point_id(point) for point in points],
        "km": kilometres,
        "min": minutes,
    }


def validate_matrix(data: dict[str, Any], expected_ids: list[str]) -> None:
    """Validate point mapping, square dimensions, and finite non-negative legs."""
    if data.get("pointIds") != expected_ids:
        raise ValueError("matrix point mapping is invalid")
    size = len(expected_ids)
    for field in ("km", "min"):
        rows = data.get(field)
        if not isinstance(rows, list) or len(rows) != size:
            raise ValueError("matrix dimensions are invalid")
        for row_index, row in enumerate(rows):
            if not isinstance(row, list) or len(row) != size:
                raise ValueError("matrix dimensions are invalid")
            for column_index, value in enumerate(row):
                if row_index == column_index:
                    if isinstance(value, bool) or value != 0:
                        raise ValueError("matrix diagonal must be zero")
                    continue
                if value is None:
                    continue
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or value < 0
                ):
                    raise ValueError("matrix legs must be finite and non-negative or null")
    for row in range(size):
        for column in range(size):
            if (data["km"][row][column] is None) != (data["min"][row][column] is None):
                raise ValueError("matrix distance/duration availability must match")


def _location_client(config: Config) -> Any:
    import boto3

    return boto3.client("geo-routes", region_name=config.location_region)


def _location_matrix(
    points: list[dict[str, Any]],
    client: Any,
    sleeper: Callable[[float], None],
) -> dict[str, Any]:
    size = len(points)
    kilometres: list[list[float | None]] = [[None] * size for _ in range(size)]
    minutes: list[list[float | None]] = [[None] * size for _ in range(size)]
    for index in range(size):
        kilometres[index][index] = 0.0
        minutes[index][index] = 0.0
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
                TravelMode=TRAVEL_MODE,
                RoutingBoundary=copy.deepcopy(ROUTING_BOUNDARY),
            )
            calls += 1
            rows = response.get("RouteMatrix")
            if not isinstance(rows, list) or len(rows) != len(origins):
                raise ValueError("Location returned malformed matrix rows")
            for row_offset, row in enumerate(rows):
                if not isinstance(row, list) or len(row) != len(destinations):
                    raise ValueError("Location returned malformed matrix columns")
                for column_offset, entry in enumerate(row):
                    row_index = origin_start + row_offset
                    column_index = destination_start + column_offset
                    if row_index == column_index:
                        continue
                    if not isinstance(entry, dict):
                        raise ValueError("Location returned a malformed entry")
                    if entry.get("Error"):
                        if not isinstance(entry["Error"], str) or entry["Error"] not in LEG_ERRORS:
                            raise ValueError("Location returned an unknown entry error")
                        continue
                    distance = number(entry.get("Distance"), "Location Distance") / 1000
                    duration = number(entry.get("Duration"), "Location Duration") / 60
                    kilometres[row_index][column_index] = round(distance, 6)
                    minutes[row_index][column_index] = round(duration, 6)
    data = {
        "pointIds": [_point_id(point) for point in points],
        "km": kilometres,
        "min": minutes,
    }
    validate_matrix(data, data["pointIds"])
    return data


def build_matrix(
    points: list[dict[str, Any]],
    *,
    plan_date: str = "cache",
    config: Config | None = None,
    database: Any | None = None,
    client: Any | None = None,
    now: datetime | None = None,
    sleeper: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Load an identity-safe cache or build Location/fallback matrix data."""
    _validate_points(points)
    config = config or get_config()
    current = now or datetime.now(UTC)
    intended_source = "fallback" if config.mock_location else "location"
    cache_key = matrix_cache_key(
        points,
        provider=intended_source,
        region=config.location_region,
        road_factor=config.road_factor,
        fallback_speed_kmph=config.fallback_speed_kmph,
    )
    expected_ids = [_point_id(point) for point in points]
    if database is not None:
        try:
            cached = database.get("plans", {"date": plan_date, "planId": cache_key})
            if cached and int(cached.get("ttl", 0)) > int(current.timestamp()):
                data = {
                    "pointIds": cached["points"],
                    "km": cached["km"],
                    "min": cached["min"],
                }
                validate_matrix(data, expected_ids)
                source = cached["source"]
                if source != intended_source:
                    raise ValueError("cached matrix source is invalid")
                return {**data, "source": source}
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
    validate_matrix(data, expected_ids)
    if database is not None and source == intended_source:
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
