"""Cancellation preserves evidence, revokes driver access and permits a fresh dispatch."""

from dataclasses import replace
from urllib.parse import quote

from test_repair_photos import DAY, GID, photo_http  # noqa: F401


def test_cancel_preserves_pickups_and_allows_replanned_dispatch(photo_http):  # noqa: F811
    http = photo_http
    http.state.config = replace(http.state.config, plant_owner_token="cancel-test-owner")
    admin = {"X-Admin-Token": http.state.config.admin_token}
    snapshot = http.get(f"/operations?date={DAY}", headers=admin).json()
    params = {**snapshot["defaults"], "collectionDate": DAY, "targetKg": 100, "mandatoryIds": [GID]}
    params.pop("readinessPrior", None)
    draft_response = http.post("/plans", headers=admin, json=params)
    assert draft_response.status_code == 200, draft_response.text
    draft = draft_response.json()
    path = "/plans/" + quote(draft["planKey"], safe="")
    dispatched = http.post(
        path + "/dispatch",
        headers={**admin, "Idempotency-Key": "cancel-test-dispatch"},
        json={"expectedVersion": draft["version"], "expectedInputRevision": draft["inputRevision"]},
    )
    assert dispatched.status_code == 200, dispatched.text
    live = dispatched.json()["plan"]
    driver = {"X-Driver-Token": dispatched.json()["driverAccess"]["token"]}
    pickup = http.post(
        "/pickups",
        headers={**driver, "Idempotency-Key": "before-cancellation"},
        json={
            "planKey": live["planKey"],
            "generatorId": GID,
            "outcome": "PARTIAL",
            "kg": 40,
            "weightSource": "SCALE",
            "reason": "Partial collection before cancellation",
            "remainingKg": None,
            "remainingUnknown": True,
            "gps": None,
            "expectedRevision": 0,
        },
    )
    assert pickup.status_code == 200, pickup.text
    payload = {"expectedVersion": live["version"], "reason": "Vehicle issue; stop collection"}
    assert (
        http.post(
            path + "/cancel", headers={"Idempotency-Key": "denied-cancel"}, json=payload
        ).status_code
        == 401
    )
    assert http.post(path + "/cancel", headers=admin, json=payload).status_code == 400
    headers = {**admin, "Idempotency-Key": "cancel-test"}
    result = http.post(path + "/cancel", headers=headers, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["plan"]["state"] == "CANCELLED"
    assert result.json()["plan"]["plan"]["stops"] == live["plan"]["stops"]
    assert http.post(path + "/cancel", headers=headers, json=payload).json() == result.json()
    assert http.get(path + "/driver", headers=driver).status_code == 401
    assert (
        http.post(
            "/pickups", headers={**driver, "Idempotency-Key": "after-cancel"}, json={}
        ).status_code
        == 400
    )
    details = http.get(path + "/details", headers=admin).json()
    assert details["execution"]["reconciliation"]["pickedKg"] == 40
    owner = {"X-Plant-Token": http.state.config.plant_owner_token}
    intake = http.get(f"/intake?date={DAY}", headers=owner).json()
    assert intake["trips"][0]["state"] == "CANCELLED"
    gate = http.post(
        "/gate-logs",
        headers={**owner, "Idempotency-Key": "cancelled-load-intake"},
        json={
            "planKey": live["planKey"],
            "netKg": 38,
            "weightSource": "SCALE",
            "expectedRevision": 0,
        },
    )
    assert gate.status_code == 200, gate.text
    replacement = http.post("/plans", headers=admin, json=params).json()
    assert replacement["planKey"] != live["planKey"] and replacement["state"] == "DRAFT"
    next_path = "/plans/" + quote(replacement["planKey"], safe="") + "/dispatch"
    next_trip = http.post(
        next_path,
        headers={**admin, "Idempotency-Key": "replacement-dispatch"},
        json={
            "expectedVersion": replacement["version"],
            "expectedInputRevision": replacement["inputRevision"],
        },
    )
    assert next_trip.status_code == 200, next_trip.text
    assert http.get(path + "/details", headers=admin).json()["plan"]["state"] == "CANCELLED"
