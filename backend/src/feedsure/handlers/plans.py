"""Authenticated plan creation and retrieval handlers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
from datetime import UTC, date, datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from feedsure.common.config import Config, get_config
from feedsure.common.db import DynamoDB
from feedsure.common.http import error_response, json_response
from feedsure.planner.matrix import build_matrix, ordered_points
from feedsure.planner.plan import build_plan

MAX_REQUEST_BYTES = 16 * 1024


class PlanRequestError(ValueError):
    """Represent a safe validation error for a plan request."""


def _header(event: dict[str, Any], name: str) -> str:
    headers = event.get("headers") or {}
    return next((str(value) for key, value in headers.items() if key.lower() == name.lower()), "")


def _authorized(event: dict[str, Any], config: Config) -> bool:
    supplied = _header(event, "x-admin-token")
    return hmac.compare_digest(supplied.encode(), config.admin_token.encode())


def parse_plan_request(event: dict[str, Any], config: Config) -> dict[str, Any]:
    """Parse a bounded JSON request and validate its planning controls."""
    raw = event.get("body")
    if not isinstance(raw, str):
        raise PlanRequestError("Request body must be a JSON object.")
    try:
        body_bytes = (
            base64.b64decode(raw, validate=True) if event.get("isBase64Encoded") else raw.encode()
        )
        if len(body_bytes) > MAX_REQUEST_BYTES:
            raise PlanRequestError("Request body exceeds 16 KB.")
        body = json.loads(body_bytes)
    except PlanRequestError:
        raise
    except (ValueError, UnicodeError, json.JSONDecodeError) as error:
        raise PlanRequestError("Request body is not valid JSON.") from error
    if not isinstance(body, dict):
        raise PlanRequestError("Request body must be a JSON object.")
    date_value = body.get("date")
    try:
        parsed_date = date.fromisoformat(date_value) if isinstance(date_value, str) else None
    except ValueError as error:
        raise PlanRequestError("date must be a valid YYYY-MM-DD date.") from error
    if parsed_date is None or parsed_date.isoformat() != date_value:
        raise PlanRequestError("date must be a valid YYYY-MM-DD date.")
    result: dict[str, Any] = {"date": date_value}
    for field, default in (
        ("targetKg", config.target_kg),
        ("truckCapacityKg", config.truck_capacity_kg),
    ):
        value = body.get(field, default)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value <= 0
        ):
            raise PlanRequestError(f"{field} must be a positive number.")
        result[field] = float(value)
    return result


def _load_inputs(
    database: DynamoDB, requested: dict[str, Any], config: Config
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    generators = sorted(database.scan("generators"), key=lambda item: str(item["generatorId"]))
    plan_day = date.fromisoformat(requested["date"])
    start = (plan_day - timedelta(days=14)).isoformat()
    end = (plan_day - timedelta(days=1)).isoformat()
    history: dict[str, list[dict[str, Any]]] = {}
    for generator in generators:
        generator_id = str(generator["generatorId"])
        history[generator_id] = database.query(
            "history",
            KeyConditionExpression=Key("generatorId").eq(generator_id)
            & Key("date").between(start, end),
        )
    submission_rows = database.query(
        "submissions", IndexName="byDate", KeyConditionExpression=Key("date").eq(end)
    )
    latest: dict[str, dict[str, Any]] = {}
    for row in submission_rows:
        generator_id = str(row["generatorId"])
        if generator_id not in latest or str(row["ts"]) > str(latest[generator_id]["ts"]):
            latest[generator_id] = row
    return generators, history, latest


def _params(requested: dict[str, Any], config: Config) -> dict[str, Any]:
    return {
        "targetKg": requested["targetKg"],
        "truckCapacityKg": requested["truckCapacityKg"],
        "shiftStart": config.shift_start,
        "shiftEnd": config.shift_end,
        "serviceMin": config.service_min,
        "maxRadiusKm": config.max_radius_km,
        "stopAtTarget": config.stop_at_target,
        "defaultPriorAccept": config.default_prior_accept,
        "defaultPriorContamPct": config.default_prior_contam_pct,
    }


def _canonical_id(result: dict[str, Any]) -> str:
    canonical = json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return f"p-{hashlib.sha1(canonical.encode()).hexdigest()[:8]}"


def handle_create_plan(
    event: dict[str, Any],
    *,
    config: Config | None = None,
    database: DynamoDB | None = None,
    location_client: Any | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Load planning data, build and persist one deterministic plan."""
    config = config or get_config()
    if not _authorized(event, config):
        return error_response(401, "UNAUTHORIZED", "Admin token is not valid.")
    try:
        requested = parse_plan_request(event, config)
    except PlanRequestError as error:
        return error_response(400, "INVALID_INPUT", str(error))
    database = database or DynamoDB(config=config)
    try:
        generators, history, submissions = _load_inputs(database, requested, config)
        points = ordered_points(
            {"id": "plant", "lat": config.plant_lat, "lng": config.plant_lng}, generators
        )
        matrix = build_matrix(
            points,
            plan_date=requested["date"],
            config=config,
            database=database,
            client=location_client,
            now=now,
        )
        result = build_plan(
            {
                "date": requested["date"],
                "generators": generators,
                "history": history,
                "submissions": submissions,
                "matrix": matrix,
                "params": _params(requested, config),
            }
        )
        short_id = _canonical_id(result)
        current = (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
        stored = {
            **result,
            "planId": short_id,
            "createdAt": current.isoformat().replace("+00:00", "Z"),
            "ttl": int((current + timedelta(days=30)).timestamp()),
        }
        database.put("plans", stored)
    except (BotoCoreError, ClientError, KeyError, TypeError, ValueError):
        return error_response(502, "UPSTREAM_FAILED", "Could not build this plan. Try again.")
    return json_response(200, {"planId": f"{requested['date']}#{short_id}", **result})


def handle_get_plan(
    event: dict[str, Any],
    *,
    config: Config | None = None,
    database: DynamoDB | None = None,
) -> dict[str, Any]:
    """Return the most recently created stored plan for a date."""
    config = config or get_config()
    if not _authorized(event, config):
        return error_response(401, "UNAUTHORIZED", "Admin token is not valid.")
    date_value = str((event.get("pathParameters") or {}).get("date", ""))
    try:
        if date.fromisoformat(date_value).isoformat() != date_value:
            raise ValueError
        rows = (database or DynamoDB(config=config)).query(
            "plans", KeyConditionExpression=Key("date").eq(date_value)
        )
    except ValueError:
        return error_response(400, "INVALID_INPUT", "date must be a valid YYYY-MM-DD date.")
    except (BotoCoreError, ClientError):
        return error_response(502, "UPSTREAM_FAILED", "Could not load this plan. Try again.")
    plans = [row for row in rows if not str(row.get("planId", "")).startswith("MATRIX#")]
    if not plans:
        return error_response(404, "NOT_FOUND", "Plan was not found.")
    stored = max(plans, key=lambda row: (str(row.get("createdAt", "")), str(row["planId"])))
    body = {key: value for key, value in stored.items() if key not in {"createdAt", "ttl"}}
    body["planId"] = f"{date_value}#{stored['planId']}"
    return json_response(200, body)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle plan API requests."""
    del context
    method = str((event.get("requestContext") or {}).get("http", {}).get("method", "POST"))
    return handle_get_plan(event) if method == "GET" else handle_create_plan(event)
