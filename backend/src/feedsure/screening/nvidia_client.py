"""NVIDIA hosted vision boundary using only the Python standard library."""

from __future__ import annotations

import base64
import json
from collections.abc import Sequence
from urllib.request import Request, urlopen

from feedsure.common.config import Config, get_config
from feedsure.screening.prompt import ScreeningPrompt


def invoke_screening(
    images: Sequence[bytes], prompt: ScreeningPrompt, config: Config | None = None
) -> str:
    """Send validated photos to NVIDIA; the photo handler owns validation and one retry."""
    active = config or get_config()
    if not active.nvidia_api_key.strip():
        raise ValueError("NVIDIA_API_KEY is required for NVIDIA photo analysis.")
    if not active.nvidia_api_url.startswith("https://"):
        raise ValueError("NVIDIA_API_URL must use HTTPS.")
    if not images or len(images) > 2:
        raise ValueError("Provide one or two validated images.")
    if any(not data.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8")) for data in images):
        raise ValueError("Images must be JPEG or PNG.")
    content = []
    for data in images:
        image_format = "png" if data.startswith(b"\x89PNG") else "jpeg"
        encoded = base64.b64encode(data).decode("ascii")
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/{image_format};base64,{encoded}"},
            }
        )
    content.append({"type": "text", "text": prompt.user})
    payload = {
        "model": active.nvidia_model_id,
        "messages": [
            {"role": "system", "content": prompt.system},
            {"role": "user", "content": content},
        ],
        "max_tokens": active.nvidia_max_tokens,
        "temperature": 0,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    request = Request(
        active.nvidia_api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {active.nvidia_api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=active.nvidia_timeout_seconds) as response:
        if response.status != 200:
            raise ValueError("NVIDIA photo analysis did not complete.")
        result = json.load(response)
    choice = result["choices"][0]
    if choice.get("finish_reason") != "stop":
        raise ValueError("NVIDIA photo analysis returned an incomplete response.")
    text = choice["message"]["content"]
    if not isinstance(text, str) or not text.strip():
        raise ValueError("NVIDIA photo analysis returned no observation text.")
    return text
