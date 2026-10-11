"""Exercise real HTTP handlers on an explicitly disposable loopback demo.

This mutates synthetic data. It refuses the active demo manifest and default API
port. Start a separate local_demo.py process with --manifest before running.
No request headers, access links, or image bytes are written to the result file.
"""

from __future__ import annotations

import argparse
import base64
import json
import struct
import uuid
import zlib
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def fixture_png() -> bytes:
    """Create a deterministic test pattern, not a photograph or model evidence."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
        )

    pixels = b"".join(
        b"\0" + bytes((x * 17 + y * 31 + c * 73) % 256 for x in range(64) for c in range(3))
        for y in range(64)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(pixels, level=0))
        + chunk(b"IEND", b"")
    )


def run(access: dict, *, failed_analysis: bool) -> dict:
    """Verify persistence, isolation and the complete collection workflow."""
    base = access["apiBaseUrl"].rstrip("/")
    day = access["collectionDate"]
    tokens = access["generatorTokens"]
    gid, other = "demo-kitchen-01", "demo-kitchen-02"
    kitchen = {"X-Generator-Token": tokens[gid]}
    admin = {"X-Admin-Token": access["adminToken"]}
    checks: list[str] = []

    def call(path, headers, body=None, *, expected=200, content_type="application/json"):
        assert path.startswith("/") and not path.startswith("//")
        payload = (
            body
            if isinstance(body, bytes)
            else (json.dumps(body).encode() if body is not None else None)
        )
        request = Request(
            base + path,
            data=payload,
            headers={
                **headers,
                "Content-Type": content_type,
            },
        )
        try:
            with urlopen(request, timeout=20) as response:
                status, raw = response.status, response.read()
        except HTTPError as error:
            status, raw = error.code, error.read()
        assert status == expected, (
            f"{request.method} {path.split('?')[0]}: {status}, expected {expected}"
        )
        return json.loads(raw) if raw else None

    def mutation(path, headers, body, **options):
        return call(path, {**headers, "Idempotency-Key": uuid.uuid4().hex}, body, **options)

    snapshot = call("/operations?date=" + day, admin)
    assert snapshot["serviceMode"]["database"] == "local"
    assert all(g["simulated"] for g in snapshot["generators"])
    for identifier, token in tokens.items():
        response = call(
            "/submissions",
            {"X-Generator-Token": token},
            {
                "generatorId": identifier,
                "collectionDate": day,
                "status": "READY" if identifier == gid else "NOT_READY",
                **(
                    {
                        "confirmedKg": 100,
                        "weightSource": "SCALE",
                        "window": {"start": "06:00", "end": "09:00"},
                    }
                    if identifier == gid
                    else {}
                ),
            },
        )
        if identifier == gid:
            record = response["submission"]
    checks.append("Readiness saved without a photo; other kitchens cancelled")
    submission_path = "/submissions/" + quote(record["submissionId"], safe="")
    draft = call("/plans", admin, {"collectionDate": day, "targetKg": 80})

    upload = call("/uploads", kitchen, {"generatorId": gid, "contentType": "image/png"})["uploads"][
        0
    ]
    assert upload["transport"] == "local"
    photo = fixture_png()
    call(upload["url"], kitchen, b"invalid-image", expected=400, content_type="image/png")
    current_path = f"/generators/{gid}/readiness?date={day}"
    assert call(current_path, kitchen)["submission"]["status"] == "READY"
    call(
        upload["url"],
        {"X-Generator-Token": tokens[other]},
        photo,
        expected=401,
        content_type="image/png",
    )
    call(upload["url"], kitchen, photo, expected=204, content_type="image/png")
    call(upload["url"], kitchen, photo, expected=204, content_type="image/png")
    attached = mutation(
        submission_path + "/photo", kitchen, {"photoKey": upload["key"], "expectedPhotoRevision": 0}
    )["submission"]
    evidence = call(submission_path + "/evidence", kitchen)
    assert base64.b64decode(evidence["url"].split(",", 1)[1]) == photo
    call(submission_path + "/evidence", {"X-Generator-Token": tokens[other]}, expected=401)
    assert call(current_path, kitchen)["submission"]["photoKeys"] == [upload["key"]]
    checks.append(
        "Invalid upload preserved readiness; retry persisted exact PNG bytes; "
        "other kitchen rejected"
    )
    mutation(
        "/plans/" + quote(draft["planKey"], safe="") + "/dispatch",
        admin,
        {
            "expectedVersion": draft["version"],
            "expectedInputRevision": draft["inputRevision"],
        },
        expected=409,
    )
    screened = mutation(
        submission_path + "/screen",
        kitchen,
        {
            "expectedPhotoRevision": attached["photoRevision"],
        },
    )["submission"]
    assert screened["status"] == "READY" and screened["analysis"]["mode"] == "mock"
    assert screened["analysis"]["state"] == ("FAILED" if failed_analysis else "COMPLETE")
    assert screened["photoStatus"] == ("NOT_CHECKED" if failed_analysis else "NO_ISSUE_OBSERVED")
    checks.append(
        "Analysis outcome persisted with explicit mock label; photo change rejected stale dispatch"
    )

    plan = call("/plans", admin, {"collectionDate": day, "targetKg": 80})
    assert [s["generatorId"] for s in plan["plan"]["stops"]] == [gid]
    assert plan["plan"]["totals"]["expectedCollectionKg"] == 80
    assert plan["plan"]["totals"]["reservedLoadKg"] == 110
    path = "/plans/" + quote(plan["planKey"], safe="")
    dispatched = mutation(
        path + "/dispatch",
        admin,
        {
            "expectedVersion": plan["version"],
            "expectedInputRevision": plan["inputRevision"],
        },
    )
    driver = {"X-Driver-Token": dispatched["driverAccess"]["token"]}
    assert call(path + "/driver", driver)["reconciliation"]["status"] == "PENDING_GATE"
    mutation(
        "/pickups",
        driver,
        {
            "planKey": plan["planKey"],
            "generatorId": gid,
            "outcome": "COLLECTED",
            "kg": 100,
            "weightSource": "SCALE",
            "expectedRevision": 0,
        },
    )
    result = mutation(
        "/gate-logs",
        admin,
        {"planKey": plan["planKey"], "netKg": 95, "weightSource": "SCALE", "expectedRevision": 0},
    )
    assert result["reconciliation"]["status"] == "WITHIN_TOLERANCE"
    assert result["reconciliation"]["deltaKg"] == -5
    receipt_path = f"/generators/{gid}/receipts?month={day[:7]}"
    records = call(receipt_path, kitchen)["records"]
    receipt = next(r for r in records if r["pickup"]["planKey"] == plan["planKey"])
    assert receipt["pickup"]["kg"] == 100 and receipt["gateStatus"] == "WITHIN_TOLERANCE"
    assert call(path + "/driver", driver)["plan"]["plan"] == plan["plan"]
    checks.append(
        "Replanned, dispatched, picked 100 kg, gate 95 kg, refreshed kitchen record; route frozen"
    )
    return {
        "status": "PASS",
        "recordedAt": datetime.now(UTC).isoformat(),
        "mode": "Local real HTTP/domain handlers; Moto; synthetic records; mock model",
        "analysisFixture": "malformed" if failed_analysis else "clean",
        "checks": checks,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expect-failed-analysis", action="store_true")
    args = parser.parse_args()
    if args.manifest.resolve() == (ROOT / ".tmp/local-demo-access.json").resolve():
        parser.error("Use a separate disposable access manifest, not the active demo.")
    access = json.loads(args.manifest.read_text(encoding="utf-8"))
    url = urlsplit(access["apiBaseUrl"])
    if (
        url.scheme != "http"
        or url.hostname not in {"localhost", "127.0.0.1"}
        or url.port in {None, 8787}
        or url.username
        or url.password
        or url.path not in {"", "/"}
    ):
        parser.error("Only a disposable loopback API on a non-default port is allowed.")
    result = run(access, failed_analysis=args.expect_failed_analysis)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
