"""M0 backend wiring smoke test."""

from feedsure.handlers.generators import lambda_handler


def test_generator_handler_is_wired() -> None:
    response = lambda_handler({"version": "2.0"}, None)

    assert response["statusCode"] == 501
    assert "NOT_IMPLEMENTED" in response["body"]
