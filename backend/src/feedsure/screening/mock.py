"""Deterministic offline screening fixtures for local demos and tests."""

from __future__ import annotations

from pathlib import Path

FIXTURE_NAMES = {"clean", "plastic", "low_confidence", "malformed"}
FIXTURES_DIRECTORY = Path(__file__).with_name("fixtures")


def select_fixture(configured_fixture: str, photo_keys: list[str]) -> str:
    """Select an explicit fixture, or infer a named fixture from test photo keys."""
    if configured_fixture != "auto":
        if configured_fixture not in FIXTURE_NAMES:
            raise ValueError(f"Unknown MOCK_BEDROCK_FIXTURE: {configured_fixture}")
        return configured_fixture
    joined_keys = " ".join(photo_keys).lower()
    for name in ("malformed", "low_confidence", "plastic", "clean"):
        if name in joined_keys:
            return name
    return "clean"


def load_fixture(name: str) -> str:
    """Load one packaged raw model response without external calls."""
    if name not in FIXTURE_NAMES:
        raise ValueError(f"Unknown mock screening fixture: {name}")
    return (FIXTURES_DIRECTORY / f"{name}.json").read_text(encoding="utf-8")
