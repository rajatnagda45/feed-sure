"""Road providers preserve directional travel, stop order and honest failure states."""

from dataclasses import replace
from unittest.mock import Mock

import pytest
from feedsure.common.config import get_config
from feedsure.planner.matrix import build_matrix, matrix_cache_key
from feedsure.planner.roads import road_route

POINTS = [{"id": "plant", "lat": 12.6, "lng": 77.4}, {"generatorId": "a", "lat": 12.7, "lng": 77.5}]
LINE = [[77.4, 12.6], [77.45, 12.62], [77.5, 12.7], [77.4, 12.6]]


def test_road_matrix_preserves_asymmetric_distances_and_unreachable_legs(monkeypatch):
    config = replace(get_config(), routing_provider="osrm")
    request = Mock(
        return_value={"distances": [[0, 2400], [None, 0]], "durations": [[0, 360], [None, 0]]}
    )
    monkeypatch.setattr("feedsure.planner.roads.osrm_request", request)
    result = build_matrix(POINTS, config=config)
    assert result == {
        "pointIds": ["plant", "a"],
        "km": [[0, 2.4], [None, 0]],
        "min": [[0, 6], [None, 0]],
        "source": "osrm",
    }
    assert request.call_args.args[0] == "table"


@pytest.mark.parametrize(
    "response",
    [
        {"distances": [[0, True], [1, 0]], "durations": [[0, 1], [1, 0]]},
        {"distances": [[0, 1], [1, 0]], "durations": [[0, None], [1, 0]]},
        {"distances": [[0]], "durations": [[0]]},
    ],
)
def test_malformed_road_matrix_is_labelled_fallback(monkeypatch, response):
    monkeypatch.setattr("feedsure.planner.roads.osrm_request", Mock(return_value=response))
    assert (
        build_matrix(POINTS, config=replace(get_config(), routing_provider="osrm"))["source"]
        == "fallback"
    )


def test_provider_outage_does_not_cache_estimates_as_roads(monkeypatch):
    monkeypatch.setattr("feedsure.planner.roads.osrm_request", Mock(side_effect=TimeoutError))
    database = Mock()
    database.get.return_value = None
    assert (
        build_matrix(
            POINTS, config=replace(get_config(), routing_provider="osrm"), database=database
        )["source"]
        == "fallback"
    )
    database.put.assert_not_called()


def test_osrm_geometry_preserves_order_and_return_without_optimizing_again(monkeypatch):
    request = Mock(
        return_value={
            "routes": [{"legs": [{}, {}], "geometry": {"type": "LineString", "coordinates": LINE}}]
        }
    )
    monkeypatch.setattr("feedsure.planner.roads.osrm_request", request)
    result = road_route(POINTS[0], POINTS[1:], "osrm", get_config())
    assert request.call_args.args[1] == [POINTS[0], POINTS[1], POINTS[0]]
    assert request.call_args.kwargs["continue_straight"] == "false"
    assert result["geometry"]["coordinates"] == [LINE]
    assert result["profile"] == "driving"


def test_aws_geometry_uses_truck_routes_and_does_not_join_leg_gaps():
    client = Mock()
    legs = [LINE[:2], LINE[2:]]
    client.calculate_routes.return_value = {
        "Routes": [{"Legs": [{"Geometry": {"LineString": leg}} for leg in legs]}]
    }
    result = road_route(POINTS[0], POINTS[1:], "location", get_config(), client=client)
    assert result["geometry"] == {"type": "MultiLineString", "coordinates": legs}
    assert client.calculate_routes.call_args.kwargs["TravelMode"] == "Truck"
    assert (
        client.calculate_routes.call_args.kwargs["Origin"]
        == client.calculate_routes.call_args.kwargs["Destination"]
    )


@pytest.mark.parametrize(
    "line",
    [[], [[77, 12]], [[181, 12], [77, 12]], [[77, float("nan")], [77, 12]], [[77, 12]] * 6001],
)
def test_invalid_or_oversized_geometry_never_becomes_a_straight_line(monkeypatch, line):
    monkeypatch.setattr(
        "feedsure.planner.roads.osrm_request",
        Mock(
            return_value={
                "routes": [
                    {"legs": [{}, {}], "geometry": {"type": "LineString", "coordinates": line}}
                ]
            }
        ),
    )
    assert road_route(POINTS[0], POINTS[1:], "osrm", get_config())["geometry"] is None


def test_estimated_and_empty_routes_do_not_request_road_geometry(monkeypatch):
    request = Mock()
    monkeypatch.setattr("feedsure.planner.roads.osrm_request", request)
    assert road_route(POINTS[0], POINTS[1:], "fallback", get_config())["status"] == "unavailable"
    assert road_route(POINTS[0], [], "osrm", get_config())["status"] == "unavailable"
    request.assert_not_called()
    assert matrix_cache_key(
        POINTS, provider="osrm", route_options={"endpoint": "a"}
    ) != matrix_cache_key(POINTS, provider="osrm", route_options={"endpoint": "b"})
