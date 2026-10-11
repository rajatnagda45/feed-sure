"""Exercise the collection loop and live NVIDIA photos on an isolated synthetic local API."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

from verify_repair_integration import fixture_png


def run(manifest: Path) -> dict:
    """Keep access tokens private and return only reproducible test outcomes."""
    access = json.loads(manifest.read_text(encoding="utf-8"))
    parsed = urlsplit(access["apiBaseUrl"])
    if (
        parsed.scheme != "http"
        or parsed.username
        or parsed.password
        or parsed.hostname not in {"localhost", "127.0.0.1"}
        or parsed.port in {None, 8787}
    ):
        raise ValueError("Use a dedicated loopback demo, not the active or hosted API")
    base = f"http://127.0.0.1:{parsed.port}"
    day, gid = access["collectionDate"], "demo-kitchen-01"
    admin = {"X-Admin-Token": access["adminToken"]}
    owner = {"X-Plant-Token": access["plantOwnerToken"]}
    supplier = {"X-Generator-Token": access["generatorTokens"][gid]}
    checks = []

    def call(path, headers, body=None, *, key=None, status=200):
        headers = dict(headers)
        if key:
            headers["Idempotency-Key"] = key
        binary = isinstance(body, bytes)
        headers["Content-Type"] = "image/png" if binary else "application/json"
        payload = body if binary else json.dumps(body).encode() if body is not None else None
        try:
            with urlopen(Request(base + path, data=payload, headers=headers), timeout=28) as r:
                actual, raw = r.status, r.read()
        except HTTPError as error:
            actual, raw = error.code, error.read()
        assert actual == status, f"{path.split('?')[0]} returned {actual}, expected {status}"
        return json.loads(raw) if raw else {}

    for identifier, token in access["generatorTokens"].items():
        payload = {"generatorId": identifier, "collectionDate": day, "status": "NOT_READY"}
        if identifier == gid:
            payload.update(
                status="READY",
                confirmedKg=80,
                weightSource="SCALE",
                window={"start": "06:00", "end": "09:00"},
            )
        saved = call("/submissions", {"X-Generator-Token": token}, payload)
        if identifier == gid:
            record = saved["submission"]
    ready_path = f"/generators/{gid}/readiness?date={day}"
    assert call(ready_path, supplier)["collectionPlan"] is None
    checks.append("Readiness saved without requiring a photo; no invented planned state")
    params = {"collectionDate": day, "targetKg": 64, "mandatoryIds": [gid]}
    too_far = call("/plans", admin, {**params, "maxRadiusKm": 0.1})
    assert any(e["reason"] == "OUT_OF_RADIUS" for e in too_far["excluded"])
    assert too_far["plantDistances"][gid] > 0.1
    plan = call("/plans", admin, {**params, "maxRadiusKm": 15})
    assert call(ready_path, supplier)["collectionPlan"] == {"state": "DRAFT", "stale": False}
    checks.append(
        "Required pickup conflicts outside distance limit; larger valid limit includes it"
    )

    path = "/submissions/" + quote(record["submissionId"], safe="")
    upload = call("/uploads", supplier, {"generatorId": gid, "contentType": "image/png"})[
        "uploads"
    ][0]
    call(upload["url"], supplier, fixture_png(), status=204)
    record = call(
        path + "/photo",
        supplier,
        {"photoKey": upload["key"], "expectedPhotoRevision": 0},
        key="attach-pattern",
    )["submission"]
    screened = call(
        path + "/screen",
        supplier,
        {"expectedPhotoRevision": record["photoRevision"]},
        key="screen-pattern",
    )["submission"]
    assert screened["analysis"]["mode"] == "nvidia"
    assert screened["analysis"]["state"] == "COMPLETE"
    assert screened["analysis"]["observations"]["image_quality"] == "not_waste"
    assert screened["photoStatus"] == "ADVICE" and screened["status"] == "READY"
    assert call(ready_path, supplier)["collectionPlan"]["stale"]
    checks.append("Live NVIDIA flags unrelated image as not_waste; readiness remains READY")
    old_path = "/plans/" + quote(plan["planKey"], safe="")
    call(
        old_path + "/dispatch",
        admin,
        {"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]},
        key="stale-dispatch",
        status=409,
    )
    plan = call("/plans", admin, params)
    plan_path = "/plans/" + quote(plan["planKey"], safe="")
    dispatch = call(
        plan_path + "/dispatch",
        admin,
        {"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]},
        key="review-dispatch",
    )
    driver = {"X-Driver-Token": dispatch["driverAccess"]["token"]}
    assert call(ready_path, supplier)["collectionPlan"] == {"state": "DISPATCHED", "stale": False}
    call(
        "/submissions",
        supplier,
        {
            "generatorId": gid,
            "collectionDate": day,
            "status": "NOT_READY",
            "reason": "Synthetic late cancellation",
        },
    )
    assert call(plan_path + "/driver", driver)["plan"]["plan"] == plan["plan"]
    checks.append("Stale dispatch rejected; later cancellation preserves dispatched stops")
    pickup = {
        "planKey": plan["planKey"],
        "generatorId": gid,
        "outcome": "PARTIAL",
        "kg": 40,
        "weightSource": "SCALE",
        "reason": "Synthetic partial load",
        "remainingKg": 40,
        "remainingUnknown": False,
        "gps": None,
        "expectedRevision": 0,
    }
    first = call("/pickups", driver, pickup, key="partial-retry")
    assert call("/pickups", driver, pickup, key="partial-retry") == first
    assert call(plan_path + "/driver", driver)["reconciliation"]["status"] == "PENDING_GATE"
    checks.append(
        "Partial pickup and unavailable GPS saved; retry adds no duplicate weight; gate pending"
    )
    gate = {"planKey": plan["planKey"], "netKg": 0, "weightSource": "SCALE", "expectedRevision": 0}
    call("/gate-logs", owner, gate, key="zero-gate")
    corrected = call(
        "/gate-logs",
        owner,
        {
            **gate,
            "netKg": 38,
            "expectedRevision": 1,
            "correctionReason": "Corrected synthetic scale entry",
        },
        key="correct-gate",
    )
    assert corrected["reconciliation"]["pickedKg"] == 40
    assert corrected["reconciliation"]["deltaKg"] == -2
    receipt = call(f"/generators/{gid}/receipts?month={day[:7]}", supplier)["records"][-1]
    assert receipt["pickup"]["kg"] == 40 and receipt["gateRecorded"]
    checks.append(
        "Owner records zero intake then attributable correction; "
        "supplier sees 40 kg and trip gate state"
    )
    return {
        "status": "PASS",
        "mode": "Live NVIDIA; real local HTTP handlers; synthetic Moto storage",
        "checks": checks,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run(args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
