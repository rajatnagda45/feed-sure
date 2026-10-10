"""Tests for deterministic, observation-only prompt construction."""

from feedsure.screening.prompt import ALLOWED_ITEM_TYPES, build_prompt


def test_prompt_requests_observations_and_exact_fields() -> None:
    prompt = build_prompt("hostel", "en", 125)

    assert "Report observations only" in prompt.system
    assert "Never decide" in prompt.system
    assert '"items"' in prompt.system
    assert '"visible_contaminant_pct"' in prompt.system
    assert '"confidence"' in prompt.system
    assert '"notes"' in prompt.system
    assert all(item_type in prompt.system for item_type in ALLOWED_ITEM_TYPES)
    assert "Generator type: hostel" in prompt.user
    assert "Reported weight: 125 kg" in prompt.user


def test_prompt_contains_no_aws_or_model_configuration() -> None:
    prompt = build_prompt("canteen", "hi", 2.5)
    combined = f"{prompt.system} {prompt.user}".lower()

    assert "aws" not in combined
    assert "bedrock" not in combined
    assert "model id" not in combined
