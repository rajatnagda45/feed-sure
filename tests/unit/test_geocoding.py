import io
import json
from dataclasses import replace

import pytest
from feedsure.common import geocoding
from feedsure.common.config import get_config
from feedsure.common.v3 import ApiError


def test_pin_lookup_validates_caches_and_never_uses_public_provider_in_production(monkeypatch):
    config = replace(
        get_config(),
        geocoding_url="https://nominatim.openstreetmap.org/search",
        aws_endpoint_url="moto://in-process",
    )
    geocoding._cache.clear()
    monkeypatch.setattr(geocoding, "_last_request", 0)
    calls = []

    def lookup(request, timeout):
        calls.append(request.full_url)
        return io.BytesIO(
            json.dumps([{"lat": "12.68", "lon": "77.47", "display_name": "Test area"}]).encode()
        )

    monkeypatch.setattr(geocoding, "urlopen", lookup)
    result = geocoding.find_locations(config, {"pincode": "560001"})
    assert result["locations"][0]["lat"] == 12.68
    assert geocoding.find_locations(config, {"pincode": "560001"}) == result
    assert len(calls) == 1 and "postalcode=560001" in calls[0]
    with pytest.raises(ApiError) as invalid:
        geocoding.find_locations(config, {"pincode": "000000"})
    assert invalid.value.status == 400
    with pytest.raises(ApiError) as production:
        geocoding.find_locations(replace(config, aws_endpoint_url=""), {"pincode": "560001"})
    assert production.value.status == 503


def test_pin_lookup_reports_upstream_failure_without_fabricating_coordinates(monkeypatch):
    config = replace(get_config(), geocoding_url="https://geo.example.test/search")
    monkeypatch.setattr(geocoding, "_last_request", 0)
    monkeypatch.setattr(geocoding, "urlopen", lambda *args, **kwargs: io.BytesIO(b"not json"))
    with pytest.raises(ApiError) as error:
        geocoding.find_locations(config, {"pincode": "560002"})
    assert error.value.status == 502
