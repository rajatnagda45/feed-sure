"""Amazon Bedrock Converse boundary for visible observations only."""

from __future__ import annotations

from collections.abc import Sequence

import boto3
from botocore.config import Config as BotoConfig

from feedsure.common.config import Config, get_config
from feedsure.screening.prompt import ScreeningPrompt


def invoke_screening(
    images: Sequence[bytes],
    prompt: ScreeningPrompt,
    config: Config | None = None,
) -> str:
    """Send validated image bytes and return observation text; callers own one retry."""
    active = config or get_config()
    if active.aws_endpoint_url:
        raise ValueError("Local screening requires explicit MOCK_BEDROCK=true.")
    if not images or len(images) > 2:
        raise ValueError("Provide one or two validated images.")
    if any(not data.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8")) for data in images):
        raise ValueError("Images must be JPEG or PNG.")
    client = boto3.client(
        "bedrock-runtime",
        region_name=active.bedrock_region,
        config=BotoConfig(connect_timeout=1, read_timeout=5, retries={"max_attempts": 0}),
    )
    content = [
        {
            "image": {
                "format": "png" if data.startswith(b"\x89PNG") else "jpeg",
                "source": {"bytes": data},
            }
        }
        for data in images
    ]
    content.append({"text": prompt.user})
    response = client.converse(
        modelId=active.bedrock_model_id,
        system=[{"text": prompt.system}],
        messages=[{"role": "user", "content": content}],
        inferenceConfig={"maxTokens": active.bedrock_max_tokens, "temperature": 0},
    )
    return "".join(block.get("text", "") for block in response["output"]["message"]["content"])
