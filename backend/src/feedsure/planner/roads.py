"""Road-network adapters. Coordinates alone never constitute road geometry."""

from __future__ import annotations

import json
import math
from typing import Any
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from feedsure.common.config import Config


def routing_provider(config: Config) -> str:
    """Resolve explicit routing configuration without changing legacy defaults."""
    if config.routing_provider == "auto":
        return "fallback" if config.mock_location else "location"
    if config.routing_provider not in {"fallback", "location", "osrm"}:
        raise ValueError("ROUTING_PROVIDER must be auto, fallback, location or osrm")
    return config.routing_provider


def osrm_request(service: str, points: list[dict], config: Config, **options: str) -> dict:
    """Request bounded public routing data; never transmit tokens or supplier names."""
    base = config.osrm_base_url.rstrip("/")
    parsed = urlsplit(base)
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.netloc
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid OSRM_BASE_URL")
    coords = ";".join(f"{float(p['lng']):.6f},{float(p['lat']):.6f}" for p in points)
    query = urlencode(options)
    request = Request(
        f"{base}/{service}/v1/driving/{coords}?{query}",
        headers={
            "User-Agent": "FeedSure/3 local-routing-demo",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=config.routing_timeout_seconds) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError("Routing response exceeds limit")
    result = json.loads(raw)
    if not isinstance(result, dict) or result.get("code") != "Ok":
        raise ValueError("Road route unavailable")
    return result


def osrm_matrix(points: list[dict], config: Config) -> dict:
    """Use directional road travel times and distances, without aerial substitutions."""
    result = osrm_request("table", points, config, annotations="distance,duration")
    size = len(points)
    data: dict[str, Any] = {"pointIds": [p.get("generatorId", p.get("id")) for p in points]}
    for source, target, divisor in (("distances", "km", 1000), ("durations", "min", 60)):
        rows = result.get(source)
        if not isinstance(rows, list) or len(rows) != size:
            raise ValueError("Invalid road matrix")
        converted = []
        for row in rows:
            if not isinstance(row, list) or len(row) != size:
                raise ValueError("Invalid road matrix row")
            values = []
            for value in row:
                if value is None:
                    values.append(None)
                elif (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or value < 0
                ):
                    raise ValueError("Invalid road matrix value")
                else:
                    values.append(round(value / divisor, 6))
            converted.append(values)
        data[target] = converted
    return data


def _line(value: Any) -> list[list[float]]:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError("Road geometry missing")
    for coordinate in value:
        if not isinstance(coordinate, list) or len(coordinate) != 2:
            raise ValueError("Invalid road coordinate")
        for item, limit in zip(coordinate, (180, 90), strict=True):
            if (
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or not math.isfinite(item)
                or abs(item) > limit
            ):
                raise ValueError("Invalid road coordinate")
    return [[round(c[0], 6), round(c[1], 6)] for c in value]


def road_route(
    depot: dict, stops: list[dict], source: str, config: Config, *, client: Any = None
) -> dict:
    """Freeze road geometry for the planner's exact order including depot return."""
    unavailable = {"status": "unavailable", "source": source, "geometry": None}
    if not stops or source not in {"osrm", "location"}:
        return unavailable
    points = [depot, *stops, depot]
    coordinates = [[float(p["lng"]), float(p["lat"])] for p in points]
    try:
        if source == "osrm":
            response = osrm_request(
                "route",
                points,
                config,
                geometries="geojson",
                overview="full",
                steps="false",
                continue_straight="false",
            )
            route = response["routes"][0]
            if len(route["legs"]) != len(points) - 1 or route["geometry"]["type"] != "LineString":
                raise ValueError("Incomplete road route")
            lines = [_line(route["geometry"]["coordinates"])]
        else:
            if client is None:
                import boto3
                from botocore.config import Config as ClientConfig

                client = boto3.client(
                    "geo-routes",
                    region_name=config.location_region,
                    config=ClientConfig(
                        connect_timeout=2,
                        read_timeout=config.routing_timeout_seconds,
                        retries={"max_attempts": 0},
                    ),
                )
            response = client.calculate_routes(
                Origin=coordinates[0],
                Destination=coordinates[-1],
                Waypoints=[{"Position": p} for p in coordinates[1:-1]],
                TravelMode="Truck",
                LegGeometryFormat="Simple",
                MaxAlternatives=0,
            )
            legs = response["Routes"][0]["Legs"]
            if len(legs) != len(points) - 1:
                raise ValueError("Incomplete road route")
            lines = [_line(leg["Geometry"]["LineString"]) for leg in legs]
        # Leave room in the DynamoDB item for the frozen inputs and matrix.
        if sum(map(len, lines)) > 6000:
            raise ValueError("Road geometry exceeds storage budget")
        return {
            "status": "ready",
            "source": source,
            "profile": "driving" if source == "osrm" else "truck",
            "geometry": {"type": "MultiLineString", "coordinates": lines},
        }
    except Exception:
        return unavailable
