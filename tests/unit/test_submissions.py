"""M3 submission-handler tests with moto-backed DynamoDB and S3."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

import boto3
import pytest
from feedsure.common.config import Config, get_config
from feedsure.common.db import DynamoDB
from feedsure.handlers.submissions import handle_submission
from feedsure.screening.bedrock_client import invoke_screening
from moto import mock_aws

TOKEN = "a-valid-generator-token-with-enough-entropy"
PHOTO_KEYS = [
    "submissions/hostel-3/2026-10-09/ab12-top.jpg",
    "submissions/hostel-3/2026-10-09/ab12-tray.jpg",
]


def _event(**changes: Any) -> dict[str, Any]:
    body = {
        "generatorId": "hostel-3",
        "token": TOKEN,
        "reportedKg": 125,
        "photoKeys": PHOTO_KEYS,
        "lang": "en",
    }
    body.update(changes)
    return {"body": json.dumps(body), "isBase64Encoded": False}


def _prepare_aws(
    monkeypatch: pytest.MonkeyPatch,
    *,
    mock_bedrock: bool,
    fixture: str = "plastic",
) -> tuple[Config, DynamoDB]:
    monkeypatch.setenv("STAGE", "submission-test")
    monkeypatch.setenv("PHOTOS_BUCKET", "feedsure-submission-test-photos")
    monkeypatch.setenv("MOCK_BEDROCK", str(mock_bedrock).lower())
    monkeypatch.setenv("MOCK_BEDROCK_FIXTURE", fixture)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    config = get_config()
    dynamodb = boto3.resource("dynamodb", region_name=config.aws_region)
    dynamodb.create_table(
        TableName=config.generators_table,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "generatorId", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "generatorId", "KeyType": "HASH"}],
    )
    dynamodb.create_table(
        TableName=config.submissions_table,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "generatorId", "AttributeType": "S"},
            {"AttributeName": "ts", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "generatorId", "KeyType": "HASH"},
            {"AttributeName": "ts", "KeyType": "RANGE"},
        ],
    )
    database = DynamoDB(config=config, resource=dynamodb)
    database.put(
        "generators",
        {
            "generatorId": "hostel-3",
            "type": "hostel",
            "tokenHash": hashlib.sha256(TOKEN.encode()).hexdigest(),
        },
    )
    return config, database


class _UnexpectedS3:
    def get_object(self, **kwargs: Any) -> Any:
        raise AssertionError(f"mock screening must not access S3: {kwargs}")


@mock_aws
@pytest.mark.parametrize(
    ("fixture", "expected_verdict", "expected_reason"),
    [
        ("clean", "ACCEPT", "clean"),
        ("plastic", "HOLD", "over_threshold"),
        ("low_confidence", "INSPECT", "low_confidence"),
        ("malformed", "INSPECT", "screening_failed"),
    ],
)
def test_mock_submission_returns_verdict_and_persists_record(
    monkeypatch: pytest.MonkeyPatch,
    fixture: str,
    expected_verdict: str,
    expected_reason: str,
) -> None:
    config, database = _prepare_aws(monkeypatch, mock_bedrock=True, fixture=fixture)
    screened_at = datetime(2026, 10, 9, 18, 42, 10, tzinfo=UTC)

    response = handle_submission(
        _event(),
        config=config,
        database=database,
        s3_client=_UnexpectedS3(),
        screening_client=lambda *_args: (_ for _ in ()).throw(
            AssertionError("mock screening must not invoke Bedrock")
        ),
        now=screened_at,
    )

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["submissionId"] == "hostel-3#2026-10-09T18:42:10Z"
    assert body["verdict"] == expected_verdict
    assert body["reason"] == expected_reason
    if fixture == "plastic":
        assert body["observations"]["visibleContaminantPct"] == 8
    assert body["modelId"] == "mock"
    stored = database.get(
        "submissions", {"generatorId": "hostel-3", "ts": "2026-10-09T18:42:10Z"}
    )
    assert stored is not None
    assert stored["verdict"] == expected_verdict
    assert stored["simulated"] is True
    assert stored["photoKeys"] == PHOTO_KEYS


@mock_aws
def test_bedrock_stub_is_retried_once_then_returns_safe_inspect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config, database = _prepare_aws(monkeypatch, mock_bedrock=False)
    s3 = boto3.client("s3", region_name=config.aws_region)
    s3.create_bucket(
        Bucket=config.photos_bucket,
        CreateBucketConfiguration={"LocationConstraint": config.aws_region},
    )
    for key in PHOTO_KEYS:
        s3.put_object(
            Bucket=config.photos_bucket,
            Key=key,
            Body=b"jpeg-bytes" * 200,
            ContentType="image/jpeg",
        )
    attempts = 0

    def gated_client(*args: Any) -> str:
        nonlocal attempts
        attempts += 1
        return invoke_screening(*args)

    response = handle_submission(
        _event(),
        config=config,
        database=database,
        s3_client=s3,
        screening_client=gated_client,
        now=datetime(2026, 10, 9, 19, 0, tzinfo=UTC),
    )

    assert attempts == 2
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["verdict"] == "INSPECT"
    assert body["reason"] == "screening_failed"
    assert body["observations"]["confidence"] == 0
    stored = database.get(
        "submissions", {"generatorId": "hostel-3", "ts": "2026-10-09T19:00:00Z"}
    )
    assert stored is not None
    assert stored["reason"] == "screening_failed"
    assert stored["simulated"] is False


@mock_aws
def test_submission_rejects_unknown_generator_and_bad_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config, database = _prepare_aws(monkeypatch, mock_bedrock=True)

    unknown = handle_submission(
        _event(
            generatorId="missing",
            photoKeys=[
                "submissions/missing/2026-10-09/ab12-top.jpg",
                "submissions/missing/2026-10-09/ab12-tray.jpg",
            ],
        ),
        config=config,
        database=database,
    )
    invalid_keys = handle_submission(
        _event(photoKeys=[PHOTO_KEYS[0]]), config=config, database=database
    )
    bad_token = handle_submission(
        _event(token="wrong"), config=config, database=database
    )

    assert unknown["statusCode"] == 404
    assert invalid_keys["statusCode"] == 400
    assert bad_token["statusCode"] == 401
