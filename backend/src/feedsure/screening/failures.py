"""Safe screening diagnostics; provider messages and credentials stay private."""

from urllib.error import HTTPError, URLError

from feedsure.common.errors import ScreeningInvalid


class ScreeningConfigurationError(ValueError):
    """A provider setting must be corrected before retrying."""


def screening_failure(error: Exception) -> dict:
    """Classify failures without exposing original exception text."""
    code, retryable = "CONNECTION_FAILED", True
    message = "The image check could not complete. Retry or request a human check."
    if isinstance(error, ScreeningConfigurationError):
        code, retryable = "SERVICE_CONFIGURATION", False
        message = "The photo service is not configured. Ask the operator to check its API settings."
    elif isinstance(error, TimeoutError) or (
        isinstance(error, URLError) and isinstance(error.reason, TimeoutError)
    ):
        code = "TIMEOUT"
        message = "The image check timed out. Retry or ask the dispatcher for a human check."
    elif isinstance(error, HTTPError):
        if error.code in {401, 403}:
            code, retryable = "CREDENTIALS", False
            message = (
                "Photo service credentials were rejected. The operator must check the API key."
            )
        elif error.code == 429:
            code = "RATE_LIMITED"
            message = "The photo service is busy or rate-limited. Wait briefly, then retry."
        elif error.code >= 500:
            code = "SERVICE_UNAVAILABLE"
            message = "The photo service is unavailable. Retry later or request a human check."
        else:
            code, retryable = "SERVICE_CONFIGURATION", False
            message = (
                "The photo service rejected the request. Ask the operator to check model settings."
            )
    elif isinstance(error, (ScreeningInvalid, ValueError, KeyError, IndexError, TypeError)):
        code = "INVALID_RESPONSE"
        message = "The model returned invalid observations. Retry with a clear waste photo."
    result = {"code": code, "retryable": retryable, "message": message}
    if isinstance(error, HTTPError):
        result["providerStatus"] = error.code
        if code == "SERVICE_UNAVAILABLE":
            result["message"] = (
                f"The photo service is temporarily unavailable (provider HTTP {error.code}). "
                "Retry later or request a human check."
            )
    return result
