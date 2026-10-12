"""Provider diagnostics never disclose private exception text."""

from urllib.error import HTTPError, URLError

import pytest
from feedsure.screening.failures import ScreeningConfigurationError, screening_failure


@pytest.mark.parametrize(
    "error,code,retryable",
    [
        (TimeoutError("private-key"), "TIMEOUT", True),
        (URLError(TimeoutError("private-key")), "TIMEOUT", True),
        (HTTPError("https://private-url", 401, "private-key", {}, None), "CREDENTIALS", False),
        (HTTPError("https://private-url", 429, "private-key", {}, None), "RATE_LIMITED", True),
        (
            HTTPError("https://private-url", 500, "private-key", {}, None),
            "SERVICE_UNAVAILABLE",
            True,
        ),
        (
            HTTPError("https://private-url", 400, "private-key", {}, None),
            "SERVICE_CONFIGURATION",
            False,
        ),
        (ValueError("private-key"), "INVALID_RESPONSE", True),
        (ScreeningConfigurationError("private-key"), "SERVICE_CONFIGURATION", False),
    ],
)
def test_failure_category_is_safe(error, code, retryable):
    result = screening_failure(error)
    assert result["code"] == code and result["retryable"] is retryable
    assert "private-key" not in str(result) and "private-url" not in str(result)
