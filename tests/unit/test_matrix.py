"""V3 route-matrix boundary, identity, and unavailable-leg tests."""

from __future__ import annotations

import copy
from datetime import UTC, datetime, timedelta

import pytest
from feedsure.common.config import get_config
from feedsure.planner.matrix import (
    build_matrix,
    fallback_matrix,
    matrix_cache_key,
    ordered_points,
    validate_matrix,
)


def _points(count: int) -> list[dict[str, object]]:
    return [
        {"id": "plant", "lat": 12.681, "lng": 77.474},
        *[
            {
                "generatorId": f"g-{index:02d}",
                "lat": 12.681 + index / 1000,
                "lng": 77.474,
            }
            for index in range(1, count)
        ],
    ]


class _Location:
    def __init__(self, fail: bool = False, unreachable: bool = False) -> None:
        self.fail = fail
        self.unreachable = unreachable
        self.calls: list[dict[str, object]] = []

    def calculate_route_matrix(self, **kwargs: object) -> dict[str, object]:
        if self.fail:
            raise RuntimeError("no credentials")
        self.calls.append(kwargs)
        origins = kwargs["Origins"]
        destinations = kwargs["Destinations"]
        assert isinstance(origins, list) and isinstance(destinations, list)
        rows: list[list[dict[str, object]]] = []
        for row_index, _origin in enumerate(origins):
            row: list[dict[str, object]] = []
            for column_index, _destination in enumerate(destinations):
                if self.unreachable and row_index == 0 and column_index == 1:
                    row.append({"Error": "NoRoute"})
                else:
                    row.append({"Distance": 1000, "Duration": 60})
            rows.append(row)
        return {"ErrorCount": int(self.unreachable), "RouteMatrix": rows}


def test_location_blocks_are_assembled_with_quota_spacing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")
    client = _Location()
    sleeps: list[float] = []
    result = build_matrix(_points(11), config=get_config(), client=client, sleeper=sleeps.append)
    assert result["source"] == "location"
    assert len(client.calls) == 4
    assert sleeps == [0.2, 0.2, 0.2]
    assert result["km"][0][10] == 1.0
    assert result["min"][10][0] == 1.0
    assert result["km"][0][0] == 0
    assert all(call["TravelMode"] == "Truck" for call in client.calls)


def test_unreachable_provider_leg_remains_null_without_whole_matrix_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")
    result = build_matrix(
        _points(3),
        config=get_config(),
        client=_Location(unreachable=True),
        sleeper=lambda _seconds: None,
    )
    assert result["source"] == "location"
    assert result["km"][0][1] is None
    assert result["min"][0][1] is None
    assert result["km"][1][0] == 1


def test_whole_service_failure_uses_labelled_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")
    config = get_config()
    points = _points(3)
    result = build_matrix(
        points,
        config=config,
        client=_Location(fail=True),
        sleeper=lambda _seconds: None,
    )
    assert result == {**fallback_matrix(points, config), "source": "fallback"}


def test_cache_identity_changes_with_order_coordinates_and_options() -> None:
    points = _points(3)
    original = matrix_cache_key(points)
    reordered = matrix_cache_key([points[0], points[2], points[1]])
    moved = copy.deepcopy(points)
    moved[1]["lat"] += 0.001
    assert original != reordered
    assert original != matrix_cache_key(moved)
    assert original != matrix_cache_key(points, provider="fallback")
    assert original != matrix_cache_key(points, travel_mode="Car")


def test_matrix_validation_rejects_bad_dimensions_and_nonfinite_values() -> None:
    data = {
        "pointIds": ["plant", "g"],
        "km": [[0, 1], [1, 0]],
        "min": [[0, 1], [1, 0]],
    }
    validate_matrix(data, ["plant", "g"])
    bad = copy.deepcopy(data)
    bad["km"][0][1] = float("nan")
    with pytest.raises(ValueError):
        validate_matrix(bad, ["plant", "g"])
    bad = copy.deepcopy(data)
    bad["min"][0][1] = None
    with pytest.raises(ValueError):
        validate_matrix(bad, ["plant", "g"])


class _Cache:
    """In-memory adapter exercising cache identity without AWS."""

    def __init__(self) -> None:
        self.rows = {}

    def get(self, table: str, key: dict) -> dict | None:
        return copy.deepcopy(self.rows.get((key["date"], key["planId"])))

    def put(self, table: str, value: dict) -> None:
        self.rows[(value["date"], value["planId"])] = copy.deepcopy(value)


def test_cache_hit_preserves_provider_and_invalid_mapping_refreshes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")
    cache, client, points = _Cache(), _Location(), _points(3)
    now = datetime(2026, 10, 11, tzinfo=UTC)
    first = build_matrix(points, database=cache, client=client, now=now)
    second = build_matrix(points, database=cache, client=_Location(fail=True), now=now)
    assert second == first
    assert first["source"] == "location"
    assert len(client.calls) == 1
    row = next(iter(cache.rows.values()))
    row["points"].reverse()
    build_matrix(points, database=cache, client=client, now=now)
    assert len(client.calls) == 2
    build_matrix(points, database=cache, client=client, now=now + timedelta(days=3))
    assert len(client.calls) == 3


def test_failure_fallback_does_not_poison_location_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")
    cache, points = _Cache(), _points(2)
    failed = build_matrix(points, database=cache, client=_Location(fail=True))
    assert failed["source"] == "fallback"
    assert cache.rows == {}
    recovered = build_matrix(points, database=cache, client=_Location())
    assert recovered["source"] == "location"


def test_mock_fallback_cache_and_coordinate_change_are_distinct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "true")
    cache, points = _Cache(), _points(2)
    first = build_matrix(points, database=cache)
    points[1]["lat"] += 0.01
    second = build_matrix(points, database=cache)
    assert second["source"] == first["source"] == "fallback"
    assert first["km"] != second["km"]
    assert len(cache.rows) == 2


@pytest.mark.parametrize(
    "options",
    [
        {"region": "other-region"},
        {"route_options": {}},
        {"road_factor": 1.4},
        {"fallback_speed_kmph": 40},
    ],
)
def test_cache_identity_includes_all_routing_options(options: dict) -> None:
    points = _points(2)
    assert matrix_cache_key(points) != matrix_cache_key(points, **options)


@pytest.mark.parametrize(
    "bad",
    [
        {"RouteMatrix": []},
        {"RouteMatrix": [[{}, {}], [{}, {}]]},
        {
            "RouteMatrix": [
                [{}, {"Distance": True, "Duration": 60}],
                [{"Distance": 1000, "Duration": 60}, {}],
            ]
        },
        {
            "RouteMatrix": [
                [{}, {"Distance": -1, "Duration": 60}],
                [{"Distance": 1000, "Duration": 60}, {}],
            ]
        },
    ],
)
def test_malformed_service_response_uses_whole_fallback(
    bad: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")

    class Malformed:
        def calculate_route_matrix(self, **kwargs: object) -> dict:
            return bad

    points = _points(2)
    result = build_matrix(points, client=Malformed())
    assert result == {**fallback_matrix(points, get_config()), "source": "fallback"}


def test_cache_transport_failure_does_not_lose_provider_matrix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOCK_LOCATION", "false")

    class FailedCache:
        def get(self, *args: object) -> None:
            raise RuntimeError("unavailable cache")

        def put(self, *args: object) -> None:
            raise RuntimeError("unavailable cache")

    result = build_matrix(_points(2), database=FailedCache(), client=_Location())
    assert result["source"] == "location"


def test_ordered_points_stays_plant_first_without_mutation() -> None:
    points = _points(3)
    generators = list(reversed(points[1:]))
    assert ordered_points(points[0], generators) == points
    assert generators == list(reversed(points[1:]))
