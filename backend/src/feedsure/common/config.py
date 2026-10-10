"""Environment-backed application configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _string(name: str, default: str) -> str:
    """Read a string environment variable."""
    return os.getenv(name, default)


def _integer(name: str, default: int) -> int:
    """Read an integer environment variable."""
    return int(os.getenv(name, str(default)))


def _number(name: str, default: float) -> float:
    """Read a floating-point environment variable."""
    return float(os.getenv(name, str(default)))


def _boolean(name: str, default: bool) -> bool:
    """Read a boolean environment variable."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class Config:
    """All FeedSure settings loaded from environment variables."""

    stage: str
    aws_region: str
    bedrock_region: str
    location_region: str
    timezone_name: str
    generators_table: str
    history_table: str
    submissions_table: str
    plans_table: str
    photos_bucket: str
    upload_min_bytes: int
    upload_max_bytes: int
    upload_expiry_seconds: int
    bedrock_model_id: str
    bedrock_max_tokens: int
    admin_token: str
    allowed_origin: str
    hold_threshold_pct: float
    inspect_min_pct: float
    min_confidence: float
    p_accept_accept: float
    p_accept_inspect: float
    default_prior_accept: float
    default_prior_contam_pct: float
    plant_lat: float
    plant_lng: float
    target_kg: float
    truck_capacity_kg: float
    shift_start: str
    shift_end: str
    service_min: int
    max_radius_km: float
    road_factor: float
    fallback_speed_kmph: float
    stop_at_target: bool
    mock_bedrock: bool
    mock_bedrock_fixture: str
    mock_location: bool
    aws_endpoint_url: str
    vite_api_base_url: str
    vite_aws_region: str
    vite_location_api_key: str


def get_config() -> Config:
    """Load configuration using defaults mirrored in ``.env.example``."""
    stage = _string("STAGE", "dev")
    return Config(
        stage=stage,
        aws_region=_string("AWS_REGION", "ap-south-1"),
        bedrock_region=_string("BEDROCK_REGION", "ap-south-1"),
        location_region=_string("LOCATION_REGION", "ap-south-1"),
        timezone_name=_string("TZ_NAME", "Asia/Kolkata"),
        generators_table=_string("GENERATORS_TABLE", f"feedsure-{stage}-Generators"),
        history_table=_string("HISTORY_TABLE", f"feedsure-{stage}-History"),
        submissions_table=_string("SUBMISSIONS_TABLE", f"feedsure-{stage}-Submissions"),
        plans_table=_string("PLANS_TABLE", f"feedsure-{stage}-Plans"),
        photos_bucket=_string("PHOTOS_BUCKET", "feedsure-dev-photos-CHANGE_ME"),
        upload_min_bytes=_integer("UPLOAD_MIN_BYTES", 1024),
        upload_max_bytes=_integer("UPLOAD_MAX_BYTES", 3_500_000),
        upload_expiry_seconds=_integer("UPLOAD_EXPIRY_SECONDS", 300),
        bedrock_model_id=_string(
            "BEDROCK_MODEL_ID",
            "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        ),
        bedrock_max_tokens=_integer("BEDROCK_MAX_TOKENS", 600),
        admin_token=_string("ADMIN_TOKEN", "CHANGE_ME"),
        allowed_origin=_string("ALLOWED_ORIGIN", "http://localhost:5173"),
        hold_threshold_pct=_number("HOLD_THRESHOLD_PCT", 5),
        inspect_min_pct=_number("INSPECT_MIN_PCT", 1),
        min_confidence=_number("MIN_CONFIDENCE", 0.6),
        p_accept_accept=_number("P_ACCEPT_ACCEPT", 0.95),
        p_accept_inspect=_number("P_ACCEPT_INSPECT", 0.6),
        default_prior_accept=_number("DEFAULT_PRIOR_ACCEPT", 0.7),
        default_prior_contam_pct=_number("DEFAULT_PRIOR_CONTAM_PCT", 2),
        plant_lat=_number("PLANT_LAT", 12.681),
        plant_lng=_number("PLANT_LNG", 77.474),
        target_kg=_number("TARGET_KG", 1700),
        truck_capacity_kg=_number("TRUCK_CAPACITY_KG", 2000),
        shift_start=_string("SHIFT_START", "06:00"),
        shift_end=_string("SHIFT_END", "11:00"),
        service_min=_integer("SERVICE_MIN", 10),
        max_radius_km=_number("MAX_RADIUS_KM", 15),
        road_factor=_number("ROAD_FACTOR", 1.3),
        fallback_speed_kmph=_number("FALLBACK_SPEED_KMPH", 20),
        stop_at_target=_boolean("STOP_AT_TARGET", False),
        mock_bedrock=_boolean("MOCK_BEDROCK", False),
        mock_bedrock_fixture=_string("MOCK_BEDROCK_FIXTURE", "auto"),
        mock_location=_boolean("MOCK_LOCATION", False),
        aws_endpoint_url=_string("AWS_ENDPOINT_URL", ""),
        vite_api_base_url=_string("VITE_API_BASE_URL", "http://localhost:8787"),
        vite_aws_region=_string("VITE_AWS_REGION", "ap-south-1"),
        vite_location_api_key=_string("VITE_LOCATION_API_KEY", "CHANGE_ME"),
    )
