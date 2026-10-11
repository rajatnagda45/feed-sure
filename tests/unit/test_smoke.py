"""M0 backend wiring smoke test."""

from feedsure.handlers.generators import lambda_handler


def test_generator_handler_is_wired() -> None:
    response = lambda_handler(
        {"version": "2.0", "rawPath": "/generators", "requestContext": {"http": {"method": "GET"}}},
        None,
    )

    assert response["statusCode"] == 401
    assert "UNAUTHORIZED" in response["body"]
