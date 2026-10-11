"""Create screened generator submissions and persist their deterministic verdicts."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from feedsure.common.config import Config, get_config
from feedsure.common.db import DynamoDB
from feedsure.common.http import error_response, json_response
from feedsure.screening.bedrock_client import invoke_screening
from feedsure.screening.decision import decide_verdict
from feedsure.screening.mock import load_fixture, select_fixture
from feedsure.screening.prompt import ScreeningPrompt, build_prompt
from feedsure.screening.validate import validate_observations

GENERATOR_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62})$")
MAX_REQUEST_BYTES = 16 * 1024
ALLOWED_LANGUAGES = {"en", "hi"}
ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png"}

ScreeningClient = Callable[[Sequence[bytes], ScreeningPrompt, Config | None], str]
FixtureLoader = Callable[[str], str]


class SubmissionRequestError(ValueError):
    """Represent a safe validation error for a submission request."""


def _request_json(event: dict[str, Any]) -> dict[str, Any]:
    raw_body = event.get("body")
    if not isinstance(raw_body, str):
        raise SubmissionRequestError("Request body must be a JSON object.")
    try:
        body_bytes = (
            base64.b64decode(raw_body, validate=True)
            if event.get("isBase64Encoded")
            else raw_body.encode("utf-8")
        )
    except (ValueError, UnicodeError) as error:
        raise SubmissionRequestError("Request body is not valid JSON.") from error
    if len(body_bytes) > MAX_REQUEST_BYTES:
        raise SubmissionRequestError("Request body exceeds 16 KB.")
    try:
        body = json.loads(body_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise SubmissionRequestError("Request body is not valid JSON.") from error
    if not isinstance(body, dict):
        raise SubmissionRequestError("Request body must be a JSON object.")
    return body


def parse_submission_request(event: dict[str, Any]) -> dict[str, Any]:
    """Parse and validate request fields without making external calls."""
    body = _request_json(event)
    generator_id = body.get("generatorId")
    token = body.get("token")
    reported_kg = body.get("reportedKg")
    photo_keys = body.get("photoKeys")
    language = body.get("lang")

    if not isinstance(generator_id, str) or not GENERATOR_ID_PATTERN.fullmatch(generator_id):
        raise SubmissionRequestError("generatorId must be a valid slug.")
    if not isinstance(token, str) or not token:
        raise SubmissionRequestError("token is required.")
    if isinstance(reported_kg, bool) or not isinstance(reported_kg, (int, float)):
        raise SubmissionRequestError("reportedKg must be a number from 0 to 5000.")
    if not 0 <= reported_kg <= 5000:
        raise SubmissionRequestError("reportedKg must be a number from 0 to 5000.")
    if (
        not isinstance(photo_keys, list)
        or len(photo_keys) != 2
        or any(not isinstance(key, str) for key in photo_keys)
        or len(set(photo_keys)) != 2
    ):
        raise SubmissionRequestError("photoKeys must contain exactly two different keys.")
    required_prefix = f"submissions/{generator_id}/"
    if any(not key.startswith(required_prefix) for key in photo_keys):
        raise SubmissionRequestError(f"photoKeys must be under {required_prefix}.")
    if language not in ALLOWED_LANGUAGES:
        raise SubmissionRequestError("lang must be en or hi.")

    return {
        "generatorId": generator_id,
        "token": token,
        "reportedKg": float(reported_kg),
        "photoKeys": photo_keys,
        "lang": language,
    }


def failed_observations() -> dict[str, Any]:
    """Return the documented safe result after two failed screening attempts."""
    return {
        "items": [],
        "visible_contaminant_pct": 0.0,
        "hazard": False,
        "image_quality": "ok",
        "confidence": 0.0,
        "notes": "Screening did not return valid observations.",
        "reason": "screening_failed",
    }


def screen_with_retry(invoke: Callable[[], str]) -> tuple[dict[str, Any], str, bool]:
    """Validate one model response, retry once, then return a safe synthetic result."""
    last_raw_text = ""
    for _attempt in range(2):
        try:
            last_raw_text = invoke()
            return validate_observations(last_raw_text), last_raw_text, False
        except Exception:
            # Errors are collapsed; raw model text, image bytes, URLs, and tokens are never logged.
            continue
    return failed_observations(), last_raw_text, True


def _s3_client(config: Config) -> Any:
    options: dict[str, Any] = {"region_name": config.aws_region}
    if config.aws_endpoint_url:
        options.update(
            endpoint_url=config.aws_endpoint_url,
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        )
    return boto3.client("s3", **options)


def _load_images(config: Config, s3_client: Any, photo_keys: list[str]) -> list[bytes]:
    images: list[bytes] = []
    for key in photo_keys:
        response = s3_client.get_object(Bucket=config.photos_bucket, Key=key)
        content_type = response.get("ContentType")
        if content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
            raise SubmissionRequestError("Uploaded photos must be JPEG or PNG images.")
        content_length = response.get("ContentLength", 0)
        if not config.upload_min_bytes <= content_length <= config.upload_max_bytes:
            raise SubmissionRequestError("An uploaded photo is outside the allowed size range.")
        image = response["Body"].read(config.upload_max_bytes + 1)
        if not config.upload_min_bytes <= len(image) <= config.upload_max_bytes:
            raise SubmissionRequestError("An uploaded photo is outside the allowed size range.")
        images.append(image)
    return images


def _api_observations(observations: dict[str, Any]) -> dict[str, Any]:
    return {
        "items": observations["items"],
        "visibleContaminantPct": observations["visible_contaminant_pct"],
        "hazard": observations["hazard"],
        "imageQuality": observations["image_quality"],
        "confidence": observations["confidence"],
        "notes": observations["notes"],
    }


def handle_submission(
    event: dict[str, Any],
    *,
    config: Config | None = None,
    database: DynamoDB | None = None,
    s3_client: Any | None = None,
    screening_client: ScreeningClient = invoke_screening,
    fixture_loader: FixtureLoader = load_fixture,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Validate, screen, decide, persist, and return one generator submission."""
    try:
        request = parse_submission_request(event)
    except SubmissionRequestError as error:
        return error_response(400, "INVALID_INPUT", str(error))

    config = config or get_config()
    database = database or DynamoDB(config=config)
    try:
        generator = database.get("generators", {"generatorId": request["generatorId"]})
    except (BotoCoreError, ClientError):
        return error_response(502, "UPSTREAM_FAILED", "Could not verify this generator. Try again.")
    if generator is None:
        return error_response(404, "NOT_FOUND", "Generator was not found.")

    token_hash = hashlib.sha256(request["token"].encode()).hexdigest()
    stored_hash = generator.get("tokenHash")
    if not isinstance(stored_hash, str) or not hmac.compare_digest(token_hash, stored_hash):
        return error_response(401, "UNAUTHORIZED", "This generator link is not valid.")

    prompt = build_prompt(
        str(generator.get("type", "unknown")), request["lang"], request["reportedKg"]
    )
    model_id = "mock"
    if config.mock_bedrock:
        observations, raw_text, _failed = screen_with_retry(
            lambda: fixture_loader(
                select_fixture(config.mock_bedrock_fixture, request["photoKeys"])
            )
        )
    else:
        model_id = config.bedrock_model_id
        try:
            images = _load_images(config, s3_client or _s3_client(config), request["photoKeys"])
        except SubmissionRequestError as error:
            return error_response(400, "INVALID_INPUT", str(error))
        except (BotoCoreError, ClientError, OSError, KeyError):
            return error_response(409, "PHOTO_NOT_FOUND", "Uploaded photos could not be read.")
        observations, raw_text, _failed = screen_with_retry(
            lambda: screening_client(images, prompt, config)
        )

    decision = decide_verdict(
        observations,
        hold_threshold_pct=config.hold_threshold_pct,
        inspect_min_pct=config.inspect_min_pct,
        min_confidence=config.min_confidence,
        language=request["lang"],
    )
    screened_at = (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    timestamp = screened_at.isoformat().replace("+00:00", "Z")
    api_observations = _api_observations(observations)
    record = {
        "generatorId": request["generatorId"],
        "ts": timestamp,
        "date": screened_at.date().isoformat(),
        "reportedKg": request["reportedKg"],
        "photoKeys": request["photoKeys"],
        "lang": request["lang"],
        **decision,
        **api_observations,
        "modelId": model_id,
        "rawModelText": raw_text[:2048],
        "simulated": config.mock_bedrock,
    }
    try:
        database.put("submissions", record)
    except (BotoCoreError, ClientError):
        return error_response(502, "UPSTREAM_FAILED", "Could not save this screening. Try again.")

    return json_response(
        200,
        {
            "submissionId": f"{request['generatorId']}#{timestamp}",
            "date": record["date"],
            **decision,
            "observations": api_observations,
            "modelId": model_id,
            "screenedAt": timestamp,
        },
    )


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle v3 readiness routes; legacy helpers remain historical test references."""
    del context
    from feedsure.handlers.operations import handle_request

    return handle_request(event)
