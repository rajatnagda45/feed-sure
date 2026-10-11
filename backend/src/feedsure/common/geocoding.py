"""Explicit, cached PIN/address lookup; never autocomplete or bulk geocoding."""

import json
import math
import re
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from feedsure.common.v3 import ApiError

_lock = threading.Lock()
_cache: dict[tuple[str, str], tuple[float, list]] = {}
_last_request = 0.0


def find_locations(config, query: dict) -> dict:
    """Find Indian PIN-code areas; caller must confirm the actual site pin."""
    global _last_request
    pin = query.get("pincode", "").strip()
    address = query.get("address", "").strip()
    if not re.fullmatch(r"[1-9][0-9]{5}", pin) or len(address) > 200:
        raise ApiError(400, "INVALID_INPUT", "Enter a valid six-digit Indian PIN code.")
    endpoint = config.geocoding_url
    url = urlsplit(endpoint)
    if url.scheme != "https" or not url.hostname or url.username or url.query or url.fragment:
        raise ApiError(
            503,
            "DEPENDENCY_NOT_READY",
            "Address search is unavailable. Use live location or contact your plant Admin.",
        )
    if (
        url.hostname == "nominatim.openstreetmap.org"
        and config.aws_endpoint_url != "moto://in-process"
    ):
        raise ApiError(
            503, "DEPENDENCY_NOT_READY", "Configure a geocoding provider for this installation."
        )
    params = {"format": "jsonv2", "countrycodes": "in", "limit": 5}
    if address:
        params["q"] = f"{address}, {pin}, India"
    else:
        params.update(postalcode=pin, country="India")
    key = (endpoint, urlencode(params))
    with _lock:
        now = time.monotonic()
        if key in _cache and now - _cache[key][0] < 86400:
            return {"locations": _cache[key][1]}
        if now - _last_request < 1.1:
            raise ApiError(429, "RATE_LIMITED", "Please wait a moment before searching again.")
        _last_request = now
        try:
            request = Request(
                endpoint + "?" + key[1],
                headers={
                    "User-Agent": "FeedSure-pilot/1.0 (https://github.com/rajatnagda45/feed-sure)",
                    "Accept": "application/json",
                },
            )
            with urlopen(request, timeout=6) as response:
                data = response.read(128001)
            if len(data) > 128000:
                raise ValueError("Response too large")
            rows = json.loads(data)
            result = []
            for row in rows[:5]:
                lat, lng = float(row["lat"]), float(row["lon"])
                if not (
                    math.isfinite(lat)
                    and math.isfinite(lng)
                    and -90 <= lat <= 90
                    and -180 <= lng <= 180
                ):
                    continue
                result.append({"lat": lat, "lng": lng, "label": str(row["display_name"])[:350]})
            if len(_cache) >= 256:
                _cache.pop(next(iter(_cache)))
            _cache[key] = (now, result)
            return {"locations": result}
        except Exception:
            raise ApiError(
                502,
                "UPSTREAM_FAILED",
                "Address search could not complete. Retry, use live location, "
                "or contact your plant Admin.",
            ) from None
