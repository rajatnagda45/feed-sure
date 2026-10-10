"""M2 upload-handler tests with moto-backed DynamoDB and S3 clients."""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

import boto3
import pytest
from botocore.exceptions import ClientError
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.handlers.uploads import handle_upload_request
from moto import mock_aws

TOKEN = "a-valid-generator-token-with-enough-entropy"


def _event(
    generator_id: str = "hostel-3",
    token: str = TOKEN,
    content_type: str = "image/jpeg",
) -> dict[str, Any]:
    return {
        "body": json.dumps(
            {"generatorId": generator_id, "token": token, "contentType": content_type}
        ),
        "isBase64Encoded": False,
    }


def _decode_policy(value: str) -> dict[str, Any]:
    padding = "=" * (-len(value) % 4)
    return json.loads(base64.b64decode(value + padding))


def _prepare_aws(monkeypatch: pytest.MonkeyPatch) -> tuple[Any, Any, DynamoDB]:
    monkeypatch.setenv("STAGE", "upload-test")
    monkeypatch.setenv("PHOTOS_BUCKET", "feedsure-upload-test-photos")
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    config = get_config()
    dynamodb = boto3.resource("dynamodb", region_name=config.aws_region)
    dynamodb.create_table(
        TableName=config.generators_table,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "generatorId", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "generatorId", "KeyType": "HASH"}],
    )
    database = DynamoDB(config=config, resource=dynamodb)
    database.put(
        "generators",
        {
            "generatorId": "hostel-3",
            "tokenHash": hashlib.sha256(TOKEN.encode()).hexdigest(),
        },
    )
    s3 = boto3.client("s3", region_name=config.aws_region)
    s3.create_bucket(
        Bucket=config.photos_bucket,
        CreateBucketConfiguration={"LocationConstraint": config.aws_region},
    )
    return config, s3, database


@mock_aws
def test_presigned_posts_have_scoped_keys_and_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    config, s3, database = _prepare_aws(monkeypatch)
    started = datetime.now(UTC)

    response = handle_upload_request(
        _event(),
        config=config,
        database=database,
        s3_client=s3,
        now=datetime(2026, 10, 9, 18, 0, tzinfo=UTC),
        upload_id_factory=lambda: "a1b2c3d4",
    )

    assert response["statusCode"] == 200
    uploads = json.loads(response["body"])["uploads"]
    assert [upload["slot"] for upload in uploads] == ["top", "tray"]
    assert [upload["key"] for upload in uploads] == [
        "submissions/hostel-3/2026-10-09/a1b2c3d4-top.jpg",
        "submissions/hostel-3/2026-10-09/a1b2c3d4-tray.jpg",
    ]

    for upload in uploads:
        assert config.photos_bucket in upload["url"]
        assert upload["fields"]["Content-Type"] == "image/jpeg"
        assert upload["fields"]["key"] == upload["key"]
        policy = _decode_policy(upload["fields"]["policy"])
        assert {"bucket": config.photos_bucket} in policy["conditions"]
        assert {"Content-Type": "image/jpeg"} in policy["conditions"]
        assert ["content-length-range", 1024, 3_500_000] in policy["conditions"]
        expires = datetime.fromisoformat(policy["expiration"].replace("Z", "+00:00"))
        assert 295 <= (expires - started).total_seconds() <= 305


@mock_aws
def test_upload_rejects_unknown_generator_bad_token_and_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config, s3, database = _prepare_aws(monkeypatch)

    unknown = handle_upload_request(
        _event(generator_id="missing"), config=config, database=database, s3_client=s3
    )
    unauthorized = handle_upload_request(
        _event(token="wrong-token"), config=config, database=database, s3_client=s3
    )
    invalid_type = handle_upload_request(
        _event(content_type="image/webp"), config=config, database=database, s3_client=s3
    )

    assert unknown["statusCode"] == 404
    assert json.loads(unknown["body"])["error"]["code"] == "NOT_FOUND"
    assert unauthorized["statusCode"] == 401
    assert json.loads(unauthorized["body"])["error"]["code"] == "UNAUTHORIZED"
    assert invalid_type["statusCode"] == 400
    assert json.loads(invalid_type["body"])["error"]["code"] == "INVALID_INPUT"


class _FailingS3:
    def generate_presigned_post(self, **kwargs: Any) -> dict[str, Any]:
        del kwargs
        raise ClientError({"Error": {"Code": "InternalError", "Message": "private"}}, "Post")


@mock_aws
def test_upload_returns_clear_error_when_s3_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    config, _s3, database = _prepare_aws(monkeypatch)

    response = handle_upload_request(
        _event(), config=config, database=database, s3_client=_FailingS3()
    )

    assert response["statusCode"] == 502
    body = json.loads(response["body"])
    assert body == {
        "error": {
            "code": "UPSTREAM_FAILED",
            "message": "Could not prepare photo uploads. Try again.",
        }
    }
    assert "private" not in response["body"]
