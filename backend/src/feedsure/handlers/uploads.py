"""Issue paired, tightly scoped S3 presigned POSTs for generator photos."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from feedsure.common.config import Config, get_config
from feedsure.common.db import DynamoDB
from feedsure.common.http import error_response, json_response

ALLOWED_CONTENT_TYPES = {"image/jpeg": "jpg", "image/png": "png"}
GENERATOR_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62})$")
MAX_REQUEST_BYTES = 16 * 1024
UploadIdFactory = Callable[[], str]


class UploadRequestError(ValueError):
    """Represent a safe validation error for an upload request."""


def parse_upload_request(event: dict[str, Any]) -> tuple[str, str, str]:
    """Parse and validate the pure request fields needed to create uploads."""
    raw_body = event.get("body")
    if not isinstance(raw_body, str):
        raise UploadRequestError("Request body must be a JSON object.")
    try:
        body_bytes = (
            base64.b64decode(raw_body, validate=True)
            if event.get("isBase64Encoded")
            else raw_body.encode("utf-8")
        )
    except (ValueError, UnicodeError) as error:
        raise UploadRequestError("Request body is not valid JSON.") from error
    if len(body_bytes) > MAX_REQUEST_BYTES:
        raise UploadRequestError("Request body exceeds 16 KB.")
    try:
        body = json.loads(body_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise UploadRequestError("Request body is not valid JSON.") from error
    if not isinstance(body, dict):
        raise UploadRequestError("Request body must be a JSON object.")

    generator_id = body.get("generatorId")
    token = body.get("token")
    content_type = body.get("contentType")
    if not isinstance(generator_id, str) or not GENERATOR_ID_PATTERN.fullmatch(generator_id):
        raise UploadRequestError("generatorId must be a valid slug.")
    if not isinstance(token, str) or not token:
        raise UploadRequestError("token is required.")
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise UploadRequestError("contentType must be image/jpeg or image/png.")
    return generator_id, token, content_type


def build_upload_keys(
    generator_id: str,
    content_type: str,
    upload_date: str,
    upload_id: str,
) -> list[tuple[str, str]]:
    """Build top and tray keys for one opaque generator submission."""
    extension = ALLOWED_CONTENT_TYPES[content_type]
    prefix = f"submissions/{generator_id}/{upload_date}/{upload_id}"
    return [(slot, f"{prefix}-{slot}.{extension}") for slot in ("top", "tray")]


def create_presigned_uploads(
    config: Config,
    s3_client: Any,
    keys: list[tuple[str, str]],
    content_type: str,
) -> list[dict[str, Any]]:
    """Create S3 forms whose policies pin type, size, bucket, and key."""
    uploads: list[dict[str, Any]] = []
    for slot, key in keys:
        post = s3_client.generate_presigned_post(
            Bucket=config.photos_bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},
                ["content-length-range", config.upload_min_bytes, config.upload_max_bytes],
            ],
            ExpiresIn=config.upload_expiry_seconds,
        )
        uploads.append({"slot": slot, "key": key, "url": post["url"], "fields": post["fields"]})
    return uploads


def _s3_client(config: Config) -> Any:
    options: dict[str, Any] = {"region_name": config.aws_region}
    if config.aws_endpoint_url:
        options.update(
            endpoint_url=config.aws_endpoint_url,
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        )
    return boto3.client("s3", **options)


def _current_time(timezone_name: str) -> datetime:
    try:
        local_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        if timezone_name != "Asia/Kolkata":
            raise
        local_timezone = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(local_timezone)


def handle_upload_request(
    event: dict[str, Any],
    *,
    config: Config | None = None,
    database: DynamoDB | None = None,
    s3_client: Any | None = None,
    now: datetime | None = None,
    upload_id_factory: UploadIdFactory | None = None,
) -> dict[str, Any]:
    """Validate a generator and return two scoped presigned POSTs."""
    try:
        generator_id, token, content_type = parse_upload_request(event)
    except UploadRequestError as error:
        return error_response(400, "INVALID_INPUT", str(error))

    config = config or get_config()
    database = database or DynamoDB(config=config)
    try:
        generator = database.get("generators", {"generatorId": generator_id})
    except (BotoCoreError, ClientError):
        return error_response(502, "UPSTREAM_FAILED", "Could not verify this generator. Try again.")
    if generator is None:
        return error_response(404, "NOT_FOUND", "Generator was not found.")

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    stored_hash = generator.get("tokenHash")
    if not isinstance(stored_hash, str) or not hmac.compare_digest(token_hash, stored_hash):
        return error_response(401, "UNAUTHORIZED", "This generator link is not valid.")

    current_time = now or _current_time(config.timezone_name)
    id_factory = upload_id_factory or (lambda: secrets.token_hex(8))
    keys = build_upload_keys(
        generator_id,
        content_type,
        current_time.date().isoformat(),
        id_factory(),
    )
    try:
        uploads = create_presigned_uploads(
            config,
            s3_client or _s3_client(config),
            keys,
            content_type,
        )
    except (BotoCoreError, ClientError, KeyError):
        return error_response(502, "UPSTREAM_FAILED", "Could not prepare photo uploads. Try again.")
    return json_response(200, {"uploads": uploads})


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Issue one optional v3 photo upload, with tokens exclusively in request headers."""
    del context
    from feedsure.handlers.operations import handle_request

    return handle_request({**event, "rawPath": "/uploads"})
