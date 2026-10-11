"""Independent correction/reconciliation regression through the real local HTTP shim."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from urllib.parse import quote

import boto3
import pytest
from fastapi.testclient import TestClient
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from moto import mock_aws
from seed_data import seed_v3_database


def test_corrections_refresh_both_driver_and_own_receipt_without_changing_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A corrected pickup changes trip totals, retains the frozen route, and stays private."""
    monkeypatch.setenv("ADMIN_TOKEN", "independent-qa-admin")
    monkeypatch.setenv("DRIVER_TOKEN_SECRET", "independent-qa-secret-at-least-32-characters")
    monkeypatch.setenv("MOCK_LOCATION", "true")
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    with mock_aws():
        config = replace(get_config(), aws_endpoint_url="moto://in-process")
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        tokens = seed_v3_database(config, resource, date(2026, 10, 12))
        database = DynamoDB(config, resource)
        import dev_server

        monkeypatch.setattr(dev_server.app.state, "config", config, raising=False)
        monkeypatch.setattr(dev_server.app.state, "database", database, raising=False)
        admin = {"X-Admin-Token": config.admin_token}
        gid = "demo-kitchen-01"
        with TestClient(dev_server.app) as http:
            for identifier, token in tokens.items():
                response = http.post(
                    "/submissions",
                    headers={"X-Generator-Token": token},
                    json={
                        "generatorId": identifier,
                        "collectionDate": "2026-10-12",
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
                assert response.status_code == 200, response.text
            response = http.post(
                "/plans", headers=admin, json={"collectionDate": "2026-10-12", "targetKg": 80}
            )
            assert response.status_code == 200, response.text
            plan = response.json()
            path = "/plans/" + quote(plan["planKey"], safe="")
            response = http.post(
                path + "/dispatch",
                headers={**admin, "Idempotency-Key": "qa-dispatch"},
                json={"expectedVersion": 1, "expectedInputRevision": plan["inputRevision"]},
            )
            assert response.status_code == 200, response.text
            driver = {"X-Driver-Token": response.json()["driverAccess"]["token"]}
            pickup = {
                "planKey": plan["planKey"],
                "generatorId": gid,
                "outcome": "COLLECTED",
                "kg": 100,
                "weightSource": "SCALE",
                "expectedRevision": 0,
            }
            response = http.post(
                "/pickups", headers={**driver, "Idempotency-Key": "qa-pickup"}, json=pickup
            )
            assert response.status_code == 200, response.text
            gate = {
                "planKey": plan["planKey"],
                "netKg": 100,
                "weightSource": "SCALE",
                "expectedRevision": 0,
            }
            response = http.post(
                "/gate-logs", headers={**admin, "Idempotency-Key": "qa-gate"}, json=gate
            )
            assert response.status_code == 200, response.text
            assert response.json()["reconciliation"]["status"] == "WITHIN_TOLERANCE"
            correction = {
                **pickup,
                "kg": 60,
                "weightSource": "ESTIMATE",
                "expectedRevision": 1,
                "correctionReason": "Synthetic scale entry correction",
            }
            headers = {**driver, "Idempotency-Key": "qa-correction"}
            response = http.post("/pickups", headers=headers, json=correction)
            assert response.status_code == 200, response.text
            assert http.post("/pickups", headers=headers, json=correction).json() == response.json()
            assert (
                http.post("/pickups", headers=headers, json={**correction, "kg": 61}).status_code
                == 409
            )
            read = http.get(path + "/driver", headers=driver).json()
            assert read["plan"]["plan"]["stops"] == plan["plan"]["stops"]
            assert read["reconciliation"]["pickedKg"] == 60
            assert read["reconciliation"]["deltaKg"] == 40
            assert read["reconciliation"]["status"] == "REVIEW"
            assert read["reconciliation"]["provisional"] is True
            receipt_path = f"/generators/{gid}/receipts?month=2026-10"
            receipt = http.get(receipt_path, headers={"X-Generator-Token": tokens[gid]}).json()[
                "records"
            ][0]
            assert receipt["pickup"]["kg"] == 60 and receipt["gateStatus"] == "REVIEW"
            assert (
                http.get(
                    receipt_path, headers={"X-Generator-Token": tokens["demo-kitchen-02"]}
                ).status_code
                == 401
            )
