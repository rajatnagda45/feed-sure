"""Select the configured provider for optional v3 photo observations."""

from __future__ import annotations

from collections.abc import Sequence

from feedsure.common.config import Config, get_config
from feedsure.screening import bedrock_client, nvidia_client
from feedsure.screening.prompt import ScreeningPrompt


def invoke_screening(
    images: Sequence[bytes], prompt: ScreeningPrompt, config: Config | None = None
) -> str:
    """Invoke one provider; propagate failures to the handler's existing retry path."""
    active = config or get_config()
    if active.photo_analysis_provider == "nvidia":
        return nvidia_client.invoke_screening(images, prompt, active)
    if active.photo_analysis_provider == "bedrock":
        return bedrock_client.invoke_screening(images, prompt, active)
    raise ValueError("PHOTO_ANALYSIS_PROVIDER must be bedrock or nvidia.")


def analysis_mode(config: Config) -> str:
    """Identify the selected photo service, including explicit fixture mode."""
    if config.mock_bedrock:
        return "mock"
    return "aws" if config.photo_analysis_provider == "bedrock" else config.photo_analysis_provider
