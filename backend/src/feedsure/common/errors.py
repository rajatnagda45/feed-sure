"""Application error types."""


class FeedSureError(Exception):
    """Base class for expected FeedSure errors."""


class ScreeningInvalid(FeedSureError):
    """Raised when model observations do not match the screening schema."""
