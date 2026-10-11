"""Deterministically seed the FeedSure pilot data into DynamoDB."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import random
import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import boto3
from botocore.exceptions import ClientError
from feedsure.common.config import Config, get_config
from feedsure.common.db import DynamoDB

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PILOT_FILE = PROJECT_ROOT / "data" / "pilot_zone.json"
DEFAULT_DEMO_LOCATIONS = PROJECT_ROOT / "data" / "demo_kitchens_osm.json"
DEFAULT_LOCAL_ENDPOINT = "http://localhost:5000"
EARTH_RADIUS_KM = 6371.0

PICKUP_WINDOWS: dict[str, tuple[str, str]] = {
    "hotel": ("06:00", "08:30"),
    "hostel_mess": ("06:30", "09:00"),
    "veg_market": ("06:00", "07:30"),
    "corporate_cafeteria": ("07:00", "10:00"),
    "hospital_canteen": ("07:00", "10:00"),
    "college_canteen": ("07:00", "10:00"),
}


@dataclass(frozen=True, slots=True)
class SeedRecords:
    """All deterministic records derived from one pilot-zone file."""

    generators: list[dict[str, Any]]
    history: list[dict[str, Any]]
    tokens: dict[str, str]


@dataclass(frozen=True, slots=True)
class SeedSummary:
    """Counts and display metadata produced by a seed run."""

    generators_written: int
    history_written: int
    submissions_written: int
    plans_written: int
    plant_name: str
    plant_lat: float
    plant_lng: float
    suggested_target_kg: int | None = None


def load_pilot(path: Path = DEFAULT_PILOT_FILE) -> dict[str, Any]:
    """Load and minimally validate the pilot-zone JSON document."""
    with path.open(encoding="utf-8") as handle:
        pilot: dict[str, Any] = json.load(handle)

    required = {"plant", "radius_km", "rng_seed", "history_days", "history_end_date", "generators"}
    missing = sorted(required.difference(pilot))
    if missing:
        raise ValueError(f"Pilot data is missing required fields: {', '.join(missing)}")
    if len(pilot["generators"]) != 10:
        raise ValueError("Pilot data must define exactly 10 generators")
    return pilot


def _stable_token(seed: int, generator_id: str) -> str:
    digest = hashlib.sha256(f"feedsure:{seed}:{generator_id}".encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _point_at_distance(
    lat: float,
    lng: float,
    distance_km: float,
    bearing_rad: float,
) -> tuple[float, float]:
    angular_distance = distance_km / EARTH_RADIUS_KM
    lat_rad = math.radians(lat)
    lng_rad = math.radians(lng)
    target_lat = math.asin(
        math.sin(lat_rad) * math.cos(angular_distance)
        + math.cos(lat_rad) * math.sin(angular_distance) * math.cos(bearing_rad)
    )
    target_lng = lng_rad + math.atan2(
        math.sin(bearing_rad) * math.sin(angular_distance) * math.cos(lat_rad),
        math.cos(angular_distance) - math.sin(lat_rad) * math.sin(target_lat),
    )
    return round(math.degrees(target_lat), 6), round(math.degrees(target_lng), 6)


def _weekend_factor(generator_type: str, day: date) -> float:
    if day.weekday() < 5:
        return 1.0
    if generator_type in {
        "corporate_cafeteria",
        "hospital_canteen",
        "college_canteen",
    }:
        return 0.7
    if generator_type == "hotel":
        return 1.2
    if generator_type == "veg_market":
        return 1.3
    return 1.0


def build_seed_records(pilot: dict[str, Any]) -> SeedRecords:
    """Build reproducible generator and history records from pilot configuration."""
    seed = int(pilot["rng_seed"])
    rng = random.Random(seed)
    plant = pilot["plant"]
    radius = pilot["radius_km"]
    history_days = int(pilot["history_days"])
    history_end = date.fromisoformat(str(pilot["history_end_date"]))

    generators: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []
    tokens: dict[str, str] = {}

    for source in pilot["generators"]:
        generator_id = str(source["id"])
        generator_type = str(source["type"])
        if generator_type not in PICKUP_WINDOWS:
            raise ValueError(f"Unsupported generator type: {generator_type}")
        kg_min, kg_max = (float(value) for value in source["kg_range"])
        if kg_min > kg_max:
            raise ValueError(f"Invalid kg_range for {generator_id}")

        distance_km = rng.uniform(float(radius["min"]), float(radius["max"]))
        bearing_rad = rng.uniform(0, 2 * math.pi)
        lat, lng = _point_at_distance(
            float(plant["lat"]),
            float(plant["lng"]),
            distance_km,
            bearing_rad,
        )
        pickup_start, pickup_end = PICKUP_WINDOWS[generator_type]
        token = _stable_token(seed, generator_id)
        tokens[generator_id] = token
        generators.append(
            {
                "generatorId": generator_id,
                "name": str(source["name"]),
                "type": generator_type,
                "lat": lat,
                "lng": lng,
                "pickupStart": pickup_start,
                "pickupEnd": pickup_end,
                "defaultLang": str(source["lang"]),
                "tokenHash": hashlib.sha256(token.encode()).hexdigest(),
                "priorAccept": 0.7,
                "priorContamPct": 2,
                "simulated": True,
            }
        )

        midpoint = (kg_min + kg_max) / 2
        for offset in range(history_days - 1, -1, -1):
            history_date = history_end - timedelta(days=offset)
            noise = rng.uniform(0.85, 1.15)
            kg = midpoint * _weekend_factor(generator_type, history_date) * noise
            kg = round(min(kg_max, max(kg_min, kg)), 1)
            contamination_flag = rng.random() < 0.12
            pickup_rejected = contamination_flag and rng.random() < 0.35
            history.append(
                {
                    "generatorId": generator_id,
                    "date": history_date.isoformat(),
                    "kg": kg,
                    "contaminationFlag": contamination_flag,
                    "pickupRejected": pickup_rejected,
                    "simulated": True,
                }
            )

    return SeedRecords(generators=generators, history=history, tokens=tokens)


def _table_definitions(config: Config) -> list[tuple[str, dict[str, Any]]]:
    return [
        (
            config.generators_table,
            {
                "AttributeDefinitions": [{"AttributeName": "generatorId", "AttributeType": "S"}],
                "KeySchema": [{"AttributeName": "generatorId", "KeyType": "HASH"}],
            },
        ),
        (
            config.history_table,
            {
                "AttributeDefinitions": [
                    {"AttributeName": "generatorId", "AttributeType": "S"},
                    {"AttributeName": "date", "AttributeType": "S"},
                ],
                "KeySchema": [
                    {"AttributeName": "generatorId", "KeyType": "HASH"},
                    {"AttributeName": "date", "KeyType": "RANGE"},
                ],
            },
        ),
        (
            config.submissions_table,
            {
                "AttributeDefinitions": [
                    {"AttributeName": "generatorId", "AttributeType": "S"},
                    {"AttributeName": "ts", "AttributeType": "S"},
                    {"AttributeName": "date", "AttributeType": "S"},
                ],
                "KeySchema": [
                    {"AttributeName": "generatorId", "KeyType": "HASH"},
                    {"AttributeName": "ts", "KeyType": "RANGE"},
                ],
                "GlobalSecondaryIndexes": [
                    {
                        "IndexName": "byDate",
                        "KeySchema": [
                            {"AttributeName": "date", "KeyType": "HASH"},
                            {"AttributeName": "ts", "KeyType": "RANGE"},
                        ],
                        "Projection": {"ProjectionType": "ALL"},
                    }
                ],
            },
        ),
        (
            config.plans_table,
            {
                "AttributeDefinitions": [
                    {"AttributeName": "date", "AttributeType": "S"},
                    {"AttributeName": "planId", "AttributeType": "S"},
                ],
                "KeySchema": [
                    {"AttributeName": "date", "KeyType": "HASH"},
                    {"AttributeName": "planId", "KeyType": "RANGE"},
                ],
            },
        ),
    ]


def ensure_local_tables(config: Config, resource: Any) -> None:
    """Create the four schema tables when the local moto service is empty."""
    existing = set(resource.meta.client.list_tables()["TableNames"])
    for table_name, definition in _table_definitions(config):
        if table_name in existing:
            continue
        resource.create_table(
            TableName=table_name,
            BillingMode="PAY_PER_REQUEST",
            **definition,
        ).wait_until_exists()


def ensure_v3_tables(config: Config, resource: Any) -> None:
    """Create missing local v3 tables and index without changing or deleting existing data."""
    ensure_local_tables(config, resource)
    definitions = [
        (config.operations_table, "collectionDate", "recordKey"),
        (config.pickups_table, "planKey", "generatorId"),
        (config.gate_logs_table, "date", "planId"),
        (config.mutation_log_table, "scopeKey", "idempotencyKey"),
    ]
    existing = set(resource.meta.client.list_tables()["TableNames"])
    for name, pk, sk in definitions:
        if name in existing:
            continue
        attributes = [pk, sk] + (["recordKey"] if name == config.pickups_table else [])
        options = {
            "TableName": name,
            "BillingMode": "PAY_PER_REQUEST",
            "AttributeDefinitions": [
                {"AttributeName": attr, "AttributeType": "S"} for attr in attributes
            ],
            "KeySchema": [
                {"AttributeName": pk, "KeyType": "HASH"},
                {"AttributeName": sk, "KeyType": "RANGE"},
            ],
        }
        if name == config.pickups_table:
            options["GlobalSecondaryIndexes"] = [
                {
                    "IndexName": "byGenerator",
                    "KeySchema": [
                        {"AttributeName": "generatorId", "KeyType": "HASH"},
                        {"AttributeName": "recordKey", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ]
        resource.create_table(**options).wait_until_exists()
        if name == config.mutation_log_table:
            resource.meta.client.update_time_to_live(
                TableName=name, TimeToLiveSpecification={"AttributeName": "ttl", "Enabled": True}
            )


def load_demo_locations(path: Path = DEFAULT_DEMO_LOCATIONS) -> list[dict[str, Any]]:
    """Load attributed venue references without querying OSM during demo startup."""
    catalog = json.loads(path.read_text(encoding="utf-8"))
    locations = catalog["generators"]
    expected_ids = {f"demo-kitchen-{index:02}" for index in range(1, 11)}
    if len(locations) != 10 or {row["generatorId"] for row in locations} != expected_ids:
        raise ValueError("Demo locations must keep the ten stable kitchen IDs.")
    for row in locations:
        if not isinstance(row["name"], str) or not row["name"].strip():
            raise ValueError("Demo venue names must be nonempty.")
        for field, limit in (("lat", 90), ("lng", 180)):
            value = row[field]
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or not -limit <= value <= limit
            ):
                raise ValueError("Demo venue coordinates must be finite latitude/longitude.")
        source = row["locationSource"]
        if source["elementType"] not in {"node", "way", "relation"} or source["url"] != (
            f"https://www.openstreetmap.org/{source['elementType']}/{source['elementId']}"
        ):
            raise ValueError("Demo venue references must link to their OSM element.")
        source.update(
            attribution=catalog["attribution"],
            license=catalog["license"],
            licenseUrl=catalog["licenseUrl"],
            copyrightUrl=catalog["copyrightUrl"],
            retrievedOn=catalog["retrievedOn"],
        )
    return sorted(locations, key=lambda row: row["generatorId"])


def seed_v3_database(config: Config, resource: Any, collection_date: date) -> dict[str, str]:
    """Seed synthetic collection records at mapped venues, retaining existing profiles."""
    if not config.aws_endpoint_url:
        raise ValueError("V3 synthetic seeding requires an explicit local endpoint.")
    from feedsure.handlers.operations import Service

    locations = load_demo_locations()
    ensure_v3_tables(config, resource)
    database = DynamoDB(config, resource)
    tokens = {}
    day = collection_date.isoformat()
    for index, location in enumerate(locations):
        gid = location["generatorId"]
        if database.get("generators", {"generatorId": gid}, consistent_read=True):
            continue
        token = secrets.token_urlsafe(32)
        tokens[gid] = token
        generator = {
            "generatorId": gid,
            "name": f"{location['name']} (demo)",
            "type": location["type"],
            "address": location["address"],
            "lat": location["lat"],
            "lng": location["lng"],
            "locationSource": location["locationSource"],
            "pickupStart": "06:00",
            "pickupEnd": "09:00",
            "defaultLang": "en",
            "tokenHash": hashlib.sha256(token.encode()).hexdigest(),
            "supportedMaterial": True,
            "schemaVersion": 3,
            "simulated": True,
        }
        database.transact(
            [database.conditional_put("generators", generator, "attribute_not_exists(generatorId)")]
        )
        # Include a cancellation, two unconfirmed suppliers and a tight-window/capacity case.
        if index in {7, 8}:
            continue
        request = {
            "generatorId": gid,
            "collectionDate": day,
            "status": "NOT_READY" if index == 2 else "READY",
            "confirmedKg": 180 if index != 9 else 2500,
            "weightSource": "ESTIMATE",
            "window": {"start": "06:00", "end": "06:05" if index == 6 else "09:00"},
            "reason": "Synthetic cancellation" if index == 2 else None,
        }
        event = {"headers": {"X-Generator-Token": token}}
        Service(event, config, database, None).readiness(request)
    return tokens


def _clear_table(resource: Any, table_name: str) -> None:
    table = resource.Table(table_name)
    key_names = [entry["AttributeName"] for entry in table.key_schema]
    scan_options: dict[str, Any] = {}
    with table.batch_writer() as batch:
        while True:
            response = table.scan(**scan_options)
            for item in response.get("Items", []):
                batch.delete_item(Key={name: item[name] for name in key_names})
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_options["ExclusiveStartKey"] = last_key


def clear_all_tables(config: Config, resource: Any) -> None:
    """Remove all rows from the four configured tables before a reset seed."""
    for table_name, _definition in _table_definitions(config):
        _clear_table(resource, table_name)


def _demo_submissions(
    records: SeedRecords,
    demo_date: date,
) -> list[dict[str, Any]]:
    latest_kg = {
        generator["generatorId"]: next(
            item["kg"]
            for item in reversed(records.history)
            if item["generatorId"] == generator["generatorId"]
        )
        for generator in records.generators
    }
    submissions: list[dict[str, Any]] = []
    for index, generator in enumerate(records.generators):
        generator_id = generator["generatorId"]
        if generator_id == "hostel-3":
            continue
        timestamp = f"{demo_date.isoformat()}T18:00:{index:02d}Z"
        submissions.append(
            {
                "generatorId": generator_id,
                "ts": timestamp,
                "date": demo_date.isoformat(),
                "reportedKg": latest_kg[generator_id],
                "photoKeys": [],
                "lang": generator["defaultLang"],
                "verdict": "ACCEPT",
                "reason": "clean",
                "instruction": "Simulated clean load for demo setup.",
                "items": [],
                "visibleContaminantPct": 0,
                "hazard": False,
                "imageQuality": "ok",
                "confidence": 1,
                "modelId": "simulated",
                "rawModelText": "simulated seed data",
                "simulated": True,
            }
        )
    return submissions


def seed_database(
    config: Config,
    resource: Any,
    pilot: dict[str, Any],
    *,
    reset: bool = False,
    demo_date: date | None = None,
) -> tuple[SeedSummary, SeedRecords]:
    """Upsert deterministic records and optionally add demo submissions."""
    if config.aws_endpoint_url:
        ensure_local_tables(config, resource)
    if reset:
        clear_all_tables(config, resource)

    records = build_seed_records(pilot)
    database = DynamoDB(config=config, resource=resource)
    for generator in records.generators:
        database.put("generators", generator)
    for history_item in records.history:
        database.put("history", history_item)

    submissions = _demo_submissions(records, demo_date) if demo_date else []
    for submission in submissions:
        database.put("submissions", submission)

    suggested_target: int | None = None
    if demo_date:
        kg_by_id = {item["generatorId"]: float(item["reportedKg"]) for item in submissions}
        hostel_3_kg = next(
            float(item["kg"])
            for item in reversed(records.history)
            if item["generatorId"] == "hostel-3"
        )
        usable_all = 0.95 * (sum(kg_by_id.values()) + hostel_3_kg)
        suggested_target = round(usable_all - 0.5 * (0.95 * hostel_3_kg))

    plant = pilot["plant"]
    return (
        SeedSummary(
            generators_written=len(records.generators),
            history_written=len(records.history),
            submissions_written=len(submissions),
            plans_written=0,
            plant_name=str(plant["name"]),
            plant_lat=float(plant["lat"]),
            plant_lng=float(plant["lng"]),
            suggested_target_kg=suggested_target,
        ),
        records,
    )


def _write_links(path: Path, records: SeedRecords) -> None:
    lines = [
        f"http://localhost:5173/g/{quote(generator_id)}?t={quote(token)}"
        for generator_id, token in sorted(records.tokens.items())
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _print_summary(summary: SeedSummary, config: Config, links_path: Path) -> None:
    print(f"Seeded FeedSure data for stage: {config.stage}")
    print(f"Generators written: {summary.generators_written}")
    print(f"History rows written: {summary.history_written}")
    print(f"Submissions written: {summary.submissions_written}")
    print(f"Plans written: {summary.plans_written}")
    print(f"Plant: {summary.plant_name}")
    print(f"Coordinates: {summary.plant_lat}, {summary.plant_lng}")
    print("Idempotency: records are upserted by primary key; --reset clears all four tables first.")
    print(f"Generator links: {links_path}")
    if summary.suggested_target_kg is not None:
        print(f"suggested TARGET_KG = {summary.suggested_target_kg}")
    print("Note: plant coordinates are approximate — verify before demo.")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage", default="dev", help="Stage used by configured DynamoDB table names"
    )
    parser.add_argument(
        "--local", action="store_true", help="Use the moto service on localhost:5000"
    )
    parser.add_argument("--reset", action="store_true", help="Clear all four tables before seeding")
    parser.add_argument(
        "--demo", type=date.fromisoformat, help="Also seed demo submissions for DATE"
    )
    parser.add_argument("--pilot-file", type=Path, default=DEFAULT_PILOT_FILE)
    parser.add_argument(
        "--v3-date",
        type=date.fromisoformat,
        help="Non-destructive local-only synthetic v3 readiness seed",
    )
    return parser


def _resource(config: Config) -> Any:
    options: dict[str, Any] = {"region_name": config.aws_region}
    if config.aws_endpoint_url:
        options.update(
            endpoint_url=config.aws_endpoint_url,
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        )
    return boto3.resource("dynamodb", **options)


def main(argv: Sequence[str] | None = None) -> int:
    """Parse CLI arguments, seed DynamoDB, and print a concise summary."""
    args = _parser().parse_args(argv)
    os.environ["STAGE"] = args.stage
    if args.local:
        os.environ["AWS_ENDPOINT_URL"] = DEFAULT_LOCAL_ENDPOINT
    config = get_config()
    if args.v3_date:
        if args.reset:
            raise SystemExit("--reset is forbidden for the non-destructive v3 seed.")
        tokens = seed_v3_database(config, _resource(config), args.v3_date)
        links_path = PROJECT_ROOT / "seed_links.local.txt"
        # Retain prior private links; only append access for freshly created fictional kitchens.
        with links_path.open("a", encoding="utf-8") as handle:
            for gid, token in sorted(tokens.items()):
                handle.write(f"http://localhost:5173/g/{quote(gid)}?t={quote(token)}\n")
        print(f"Created {len(tokens)} fictional kitchens; data simulated; existing edits retained.")
        print("Private bootstrap links appended to seed_links.local.txt (gitignored).")
        return 0
    pilot = load_pilot(args.pilot_file)

    try:
        summary, records = seed_database(
            config,
            _resource(config),
            pilot,
            reset=args.reset,
            demo_date=args.demo,
        )
    except ClientError as error:
        message = error.response.get("Error", {}).get("Message", str(error))
        raise SystemExit(f"DynamoDB seed failed: {message}") from error

    links_path = PROJECT_ROOT / "seed_links.local.txt"
    _write_links(links_path, records)
    _print_summary(summary, config, links_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
