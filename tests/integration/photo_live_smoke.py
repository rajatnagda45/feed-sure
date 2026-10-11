"""Reproducible real loopback HTTP photo smoke against an isolated local_demo manifest."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from photo_fixture import png


def run(manifest_path: Path) -> dict:
    """Use synthetic bytes and private credentials without printing tokens or evidence URLs."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base = manifest["apiBaseUrl"]
    if (
        manifest_path.name == "local-demo-access.json"
        or urlparse(base).hostname not in {"localhost", "127.0.0.1"}
        or urlparse(base).port == 8787
    ):
        raise ValueError("Use an isolated local_demo manifest and API port, not the user's demo.")
    tokens = manifest["generatorTokens"]
    gid, other = sorted(tokens)[:2]
    token, day = tokens[gid], manifest["collectionDate"]
    checks: dict[str, bool] = {}

    def call(
        path: str,
        method: str = "GET",
        payload=None,
        *,
        auth=token,
        key=None,
        binary=False,
        content_type="image/png",
    ) -> tuple[int, dict]:
        headers = {"X-Generator-Token": auth} if auth else {}
        if key:
            headers["Idempotency-Key"] = key
        body = payload if binary else json.dumps(payload).encode() if payload is not None else None
        if body is not None:
            headers["Content-Type"] = content_type if binary else "application/json"
        try:
            with urlopen(
                Request(base + path, data=body, headers=headers, method=method), timeout=30
            ) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else {}
        except HTTPError as error:
            raw = error.read()
            return error.code, json.loads(raw) if raw else {}

    request = {
        "generatorId": gid,
        "collectionDate": day,
        "status": "READY",
        "confirmedKg": 100,
        "weightSource": "ESTIMATE",
        "window": {"start": "06:00", "end": "09:00"},
    }
    status, ready = call("/submissions", "POST", request)
    assert status == 200 and ready["submission"]["photoKeys"] == []
    checks["ready_without_photo"] = True
    record = ready["submission"]
    path = "/submissions/" + quote(record["submissionId"], safe="")
    status, prepared = call("/uploads", "POST", {"generatorId": gid, "contentType": "image/png"})
    assert status == 200
    upload = prepared["uploads"][0]
    assert upload["transport"] == "local"
    assert call(upload["url"], "POST", b"invalid" * 300, binary=True)[0] == 400
    checks["invalid_bytes_rejected"] = True
    assert call(upload["url"], "POST", png(), binary=True, auth=tokens[other])[0] == 401
    checks["cross_kitchen_upload_rejected"] = True
    assert call(upload["url"], "POST", png(), binary=True)[0] == 204
    assert call(upload["url"], "POST", png(), binary=True)[0] == 204
    checks["upload_bytes_and_retry"] = True
    attach = {"photoKey": upload["key"], "expectedPhotoRevision": 0}
    status, linked = call(path + "/photo", "POST", attach, key="live-attach")
    assert status == 200
    assert call(path + "/photo", "POST", attach, key="live-attach")[1] == linked
    checks["attachment_idempotency"] = True
    assert call(path + "/evidence", auth=tokens[other])[0] == 401
    assert call(path + "/evidence", auth="")[0] == 401
    checks["evidence_ownership"] = True
    status, evidence = call(path + "/evidence")
    assert status == 200
    actual = base64.b64decode(evidence["url"].split(",", 1)[1])
    assert actual == png()
    checks["retrieved_bytes_match"] = True
    photo_dir = manifest_path.parent / (manifest_path.stem + "-photos")
    assert (photo_dir / upload["key"]).read_bytes() == actual
    checks["filesystem_bytes_match"] = True
    revision = linked["submission"]["photoRevision"]
    status, screened = call(
        path + "/screen", "POST", {"expectedPhotoRevision": revision}, key="live-screen"
    )
    assert status == 200 and screened["submission"]["analysis"]["mode"] == "mock"
    analysis = screened["submission"]["analysis"]
    assert "visible_contaminant_pct" not in str(analysis)
    checks["explicit_mock_observations"] = True
    assert (
        call(f"/generators/{gid}/readiness?date={day}")[1]["submission"] == screened["submission"]
    )
    checks["fresh_read_matches_saved_analysis"] = True
    revision = screened["submission"]["photoRevision"]
    status, _ = call(
        path + "/photo",
        "POST",
        {"photoKey": None, "expectedPhotoRevision": revision},
        key="live-remove",
    )
    assert status == 200 and call(path + "/evidence")[0] == 404
    checks["photo_removal"] = True
    data = (Path(__file__).parents[1] / "fixtures/photos/synthetic.jpg").read_bytes()
    status, prepared = call("/uploads", "POST", {"generatorId": gid, "contentType": "image/jpeg"})
    assert status == 200
    jpeg = prepared["uploads"][0]
    assert call(jpeg["url"], "POST", data, binary=True, content_type="image/jpeg")[0] == 204
    revision += 1
    status, linked = call(
        path + "/photo",
        "POST",
        {"photoKey": jpeg["key"], "expectedPhotoRevision": revision},
        key="live-jpeg",
    )
    assert status == 200
    fresh = call(f"/generators/{gid}/readiness?date={day}")[1]["submission"]
    assert fresh == linked["submission"]
    _, jpeg_evidence = call(path + "/evidence")
    assert base64.b64decode(jpeg_evidence["url"].split(",", 1)[1]) == data
    checks["jpeg_upload_and_refresh_bytes_match"] = True
    status, not_ready = call(
        "/submissions", "POST", {"generatorId": gid, "collectionDate": day, "status": "NOT_READY"}
    )
    assert status == 200 and not_ready["submission"]["photoKeys"] == []
    checks["not_ready_without_photo"] = True
    return {
        "checks": checks,
        "passed": len(checks),
        "bytes": len(actual),
        "jpegBytes": len(data),
        "sha256": hashlib.sha256(actual).hexdigest(),
        "analysisState": analysis["state"],
        "photoStatus": screened["submission"]["photoStatus"],
        "mode": "real HTTP handlers / Moto DynamoDB / filesystem bytes / mock model",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.manifest.resolve()), indent=2))
