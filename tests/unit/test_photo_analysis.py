"""Strict model output and real Converse request construction without paid cloud calls."""

from __future__ import annotations

import json
from dataclasses import replace
from unittest.mock import Mock

import pytest
from feedsure.common.config import get_config
from feedsure.common.errors import ScreeningInvalid
from feedsure.screening.bedrock_client import invoke_screening
from feedsure.screening.prompt import build_photo_prompt
from feedsure.screening.validate import validate_photo_observations


def observation(**changes):
    return {
        "items": [],
        "hazard": False,
        "image_quality": "ok",
        "confidence": 0.9,
        "notes": "Visible surface only",
        **changes,
    }


@pytest.mark.parametrize(
    "changes",
    [
        {"verdict": "ACCEPT"},
        {"visible_contaminant_pct": 5},
        {"confidence": True},
        {"confidence": float("nan")},
        {"confidence": 1.1},
        {"hazard": "false"},
        {"image_quality": "great"},
        {"notes": []},
        {"items": [{"type": "battery", "count": True, "confidence": 0.9}]},
        {"items": [{"type": "new_type", "count": 1, "confidence": 0.9}]},
    ],
)
def test_strict_observations_reject_verdicts_and_coercion(changes):
    with pytest.raises(ScreeningInvalid):
        validate_photo_observations(json.dumps(observation(**changes)))


def test_only_exact_json_and_observations_are_accepted():
    raw = json.dumps(observation())
    assert validate_photo_observations(raw) == observation()
    for altered in ("```json\n" + raw + "\n```", "explanation " + raw):
        with pytest.raises(ScreeningInvalid):
            validate_photo_observations(altered)


def test_converse_sends_actual_bytes_explicit_model_and_observation_prompt(monkeypatch):
    client = Mock()
    client.converse.return_value = {
        "output": {"message": {"content": [{"text": json.dumps(observation())}]}}
    }
    factory = Mock(return_value=client)
    monkeypatch.setattr("feedsure.screening.bedrock_client.boto3.client", factory)
    config = replace(get_config(), aws_endpoint_url="", bedrock_model_id="configured-test-model")
    image = b"\xff\xd8actual JPEG bytes validated upstream"
    raw = invoke_screening([image], build_photo_prompt(), config)
    assert validate_photo_observations(raw) == observation()
    request = client.converse.call_args.kwargs
    assert request["modelId"] == "configured-test-model"
    assert request["messages"][0]["content"][0]["image"] == {
        "format": "jpeg",
        "source": {"bytes": image},
    }
    assert request["inferenceConfig"] == {"maxTokens": config.bedrock_max_tokens, "temperature": 0}
    assert "mass percentage" in request["system"][0]["text"]
    assert factory.call_args.args == ("bedrock-runtime",)
    with pytest.raises(ValueError, match="MOCK_BEDROCK"):
        invoke_screening(
            [image], build_photo_prompt(), replace(config, aws_endpoint_url="moto://in-process")
        )
