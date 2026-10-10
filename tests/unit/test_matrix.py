"""M4 route-matrix boundary tests."""

from __future__ import annotations

import pytest
from feedsure.common.config import get_config
from feedsure.planner.matrix import build_matrix, fallback_matrix


def _points(count: int) -> list[dict[str, object]]:
    return [
        {"id": "plant", "lat": 12.681, "lng": 77.474},
        *[
            {"generatorId": f"g-{index:02d}", "lat": 12.681 + index / 1000, "lng": 77.474}
            for index in range(1, count)
        ],
    ]


class _Location:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[dict[str, object]] = []

    def calculate_route_matrix(self, **kwargs: object) -> dict[str, object]:
        if self.fail:
            raise RuntimeError("no credentials")
        self.calls.append(kwargs)
        origins = kwargs["Origins"]
        destinations = kwargs["Destinations"]
        assert isinstance(origins, list) and isinstance(destinations, list)
        assert len(origins) * len(destinations) <= 100
        return {
            "ErrorCount": 0,
            "RouteMatrix": [
                [{"Distance": 1000, "Duration": 60} for _destination in destinations]
                for _origin in origins
            ],
        }


def test_location_blocks_are_assembled_with_quota_spacing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")
    client = _Location()
    sleeps: list[float] = []
    result = build_matrix(_points(11), config=get_config(), client=client, sleeper=sleeps.append)
    assert result["source"] == "location"
    assert len(client.calls) == 4
    assert sleeps == [0.2, 0.2, 0.2]
    assert result["km"][0][10] == 1.0
    assert result["min"][10][0] == 1.0
    assert all(call["TravelMode"] == "Truck" for call in client.calls)
    assert all("AutoCircle" in call["RoutingBoundary"]["Geometry"] for call in client.calls)


def test_location_failure_discards_partial_result_for_exact_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")
    config = get_config()
    points = _points(3)
    result = build_matrix(
        points, config=config, client=_Location(fail=True), sleeper=lambda _x: None
    )
    expected = fallback_matrix(points, config)
    assert result == {**expected, "source": "fallback"}
