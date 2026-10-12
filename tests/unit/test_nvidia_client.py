"""NVIDIA wire format and provider selection without external API calls."""

from __future__ import annotations

import base64
import io
import json
from dataclasses import replace
from unittest.mock import Mock

import pytest
from feedsure.common.config import get_config
from feedsure.screening import client, nvidia_client
from feedsure.screening.prompt import build_photo_prompt
from feedsure.screening.validate import validate_photo_observations

OBSERVATIONS = {
    "items": [],
    "hazard": False,
    "image_quality": "ok",
    "confidence": 0.9,
    "notes": "Visible food scraps.",
}


def response(payload, status=200):
    stream = io.BytesIO(json.dumps(payload).encode())
    stream.status = status
    return stream


def completion(text=None, finish_reason="stop"):
    return {
        "choices": [
            {
                "finish_reason": finish_reason,
                "message": {"content": json.dumps(OBSERVATIONS) if text is None else text},
            }
        ]
    }


def test_nvidia_request_sends_actual_images_and_observation_prompt(monkeypatch):
    opener = Mock(return_value=response(completion()))
    monkeypatch.setattr(nvidia_client, "urlopen", opener)
    config = replace(
        get_config(), nvidia_api_key="test-private-key", nvidia_model_id="configured-vision-model"
    )
    images = [b"\xff\xd8validated JPEG", b"\x89PNG\r\n\x1a\nvalidated PNG"]
    result = nvidia_client.invoke_screening(images, build_photo_prompt(), config)
    assert validate_photo_observations(result) == OBSERVATIONS
    request = opener.call_args.args[0]
    payload = json.loads(request.data)
    assert request.full_url == config.nvidia_api_url
    assert request.method == "POST"
    assert request.get_header("Authorization") == "Bearer test-private-key"
    assert opener.call_args.kwargs["timeout"] == config.nvidia_timeout_seconds
    assert payload["model"] == "configured-vision-model"
    assert payload["max_tokens"] == config.nvidia_max_tokens
    assert payload["stream"] is False and payload["temperature"] == 0
    assert payload["chat_template_kwargs"] == {"enable_thinking": False}
    assert not payload["messages"][0]["content"].startswith("/no_think")
    assert "mass percentage" in payload["messages"][0]["content"]
    parts = payload["messages"][1]["content"]
    for part, data, mime in zip(parts, images, ("jpeg", "png"), strict=False):
        assert part["type"] == "image_url"
        prefix, encoded = part["image_url"]["url"].split(",")
        assert prefix == f"data:image/{mime};base64"
        assert base64.b64decode(encoded) == data
    assert parts[-1] == {"type": "text", "text": build_photo_prompt().user}
    assert "test-private-key" not in repr(config)


@pytest.mark.parametrize("images", [[], [b"fake JPEG"], [b"\xff\xd8"] * 3])
def test_invalid_input_never_calls_nvidia(monkeypatch, images):
    opener = Mock()
    monkeypatch.setattr(nvidia_client, "urlopen", opener)
    with pytest.raises(ValueError):
        nvidia_client.invoke_screening(
            images, build_photo_prompt(), replace(get_config(), nvidia_api_key="test-key")
        )
    opener.assert_not_called()


@pytest.mark.parametrize(
    "settings", [{"nvidia_api_key": ""}, {"nvidia_api_url": "http://example.test"}]
)
def test_missing_key_or_insecure_url_never_calls_nvidia(monkeypatch, settings):
    opener = Mock()
    monkeypatch.setattr(nvidia_client, "urlopen", opener)
    with pytest.raises(ValueError):
        nvidia_client.invoke_screening(
            [b"\xff\xd8"],
            build_photo_prompt(),
            replace(get_config(), **({"nvidia_api_key": "test-key"} | settings)),
        )
    opener.assert_not_called()


@pytest.mark.parametrize(
    "payload,status",
    [
        (completion(), 202),
        ({"choices": []}, 200),
        (completion(finish_reason="length"), 200),
        (completion(text=""), 200),
        ({"choices": [{"finish_reason": "stop", "message": {"content": None}}]}, 200),
    ],
)
def test_incomplete_or_missing_response_is_rejected(monkeypatch, payload, status):
    monkeypatch.setattr(nvidia_client, "urlopen", Mock(return_value=response(payload, status)))
    with pytest.raises((ValueError, IndexError)):
        nvidia_client.invoke_screening(
            [b"\xff\xd8"], build_photo_prompt(), replace(get_config(), nvidia_api_key="test-key")
        )


@pytest.mark.parametrize("provider", ["bedrock", "nvidia"])
def test_provider_selection_does_not_call_other_service(monkeypatch, provider):
    bedrock, nvidia = Mock(return_value="bedrock"), Mock(return_value="nvidia")
    monkeypatch.setattr(client.bedrock_client, "invoke_screening", bedrock)
    monkeypatch.setattr(client.nvidia_client, "invoke_screening", nvidia)
    config = replace(get_config(), photo_analysis_provider=provider, mock_bedrock=False)
    assert client.invoke_screening([b"\xff\xd8"], build_photo_prompt(), config) == provider
    (nvidia if provider == "bedrock" else bedrock).assert_not_called()
    assert client.analysis_mode(config) == ("aws" if provider == "bedrock" else "nvidia")
    assert client.analysis_mode(replace(config, mock_bedrock=True)) == "mock"


def test_unknown_provider_does_not_fall_back():
    with pytest.raises(ValueError, match="PHOTO_ANALYSIS_PROVIDER"):
        client.invoke_screening(
            [b"\xff\xd8"],
            build_photo_prompt(),
            replace(get_config(), photo_analysis_provider="bad"),
        )


def test_nvidia_configuration_is_loaded_from_environment(monkeypatch):
    for key, value in {
        "PHOTO_ANALYSIS_PROVIDER": "NVIDIA",
        "NVIDIA_API_KEY": "test-key",
        "NVIDIA_MODEL_ID": "configured-model",
        "NVIDIA_API_URL": "https://example.test/v1/chat/completions",
        "NVIDIA_MAX_TOKENS": "700",
        "NVIDIA_TIMEOUT_SECONDS": "4",
    }.items():
        monkeypatch.setenv(key, value)
    config = get_config()
    assert config.photo_analysis_provider == "nvidia"
    assert config.nvidia_api_key == "test-key"
    assert config.nvidia_model_id == "configured-model"
    assert config.nvidia_api_url == "https://example.test/v1/chat/completions"
    assert config.nvidia_max_tokens == 700 and config.nvidia_timeout_seconds == 4
