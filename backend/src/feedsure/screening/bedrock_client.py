"""Gated Amazon Bedrock screening boundary."""

from __future__ import annotations

from collections.abc import Sequence

from feedsure.common.config import Config, get_config
from feedsure.screening.prompt import ScreeningPrompt


def invoke_screening(
    images: Sequence[bytes],
    prompt: ScreeningPrompt,
    config: Config | None = None,
) -> str:
    """Return raw observation JSON once the configured model is confirmed.

    The real boto3 Converse implementation intentionally remains gated. ``images`` must contain
    the top and tray JPEG bytes when that implementation is added.
    """
    active_config = config or get_config()
    del images, prompt
    raise NotImplementedError(
        "Bedrock Converse is pending model confirmation for "
        f"{active_config.bedrock_model_id} in {active_config.bedrock_region}."
    )
