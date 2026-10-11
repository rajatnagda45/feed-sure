"""The future Supabase seed retains exact geography and matches the running demo."""

from __future__ import annotations

import csv
import json
from collections import Counter
from dataclasses import replace
from datetime import date
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError

import boto3
import pytest
from export_demo_dataset import build_dataset, seed_sql, table_rows, write_exports
from feedsure.common.config import get_config
from feedsure.common.db import DynamoDB
from feedsure.handlers.operations import Service
from moto import mock_aws
from seed_data import load_demo_locations, seed_v3_database
from seed_supabase import NoRedirect, insert_dataset

DAY = date(2026, 10, 12)


def test_dataset_preserves_coordinates_and_marks_operational_records():
    dataset = build_dataset(DAY)
    assert dataset == build_dataset(DAY)
    assert len(dataset["generators"]) == 10 and len(dataset["history"]) == 140
    assert Counter(row["status"] for row in dataset["readiness"]) == {
        "READY": 7,
        "NOT_READY": 1,
        "UNCONFIRMED": 2,
    }
    for row, source in zip(dataset["generators"], load_demo_locations(), strict=True):
        assert (row["lat"], row["lng"]) == (source["lat"], source["lng"])
        assert row["venueName"] == source["name"]
        assert not any(row["verification"].values())
    assert all(
        row["simulated"] and row["quantitySource"] == "SIMULATED"
        for row in dataset["readiness"] + dataset["history"]
    )
    serialized = json.dumps(dataset).lower()
    assert not any(secret in serialized for secret in ("token", "password", "apikey"))
    assert max(row["date"] for row in dataset["history"]) == "2026-10-11"


def test_exported_readiness_matches_real_local_snapshot(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "dataset-test-admin")
    with mock_aws():
        config = replace(get_config(), aws_endpoint_url="moto://in-process")
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        seed_v3_database(config, resource, DAY)
        service = Service(
            {"headers": {"X-Admin-Token": config.admin_token}},
            config,
            DynamoDB(config, resource),
            None,
        )
        snapshot = {
            row["generatorId"]: row for row in service.snapshot(DAY.isoformat())["generators"]
        }
        for row in build_dataset(DAY)["readiness"]:
            actual = snapshot[row["generatorId"]]
            assert actual["readinessStatus"] == row["status"]
            assert (actual["readiness"] or {}).get("confirmedKg") == row["confirmedKg"]


def test_exports_round_trip_and_sql_preserves_edits(tmp_path: Path):
    dataset = build_dataset(DAY)
    # Mapped names must never escape the SQL payload.
    dataset["generators"][0]["name"] = "O'Brien $feedsure$; DROP TABLE anything;"
    write_exports(dataset, tmp_path / "exports", tmp_path / "seed.sql")
    assert json.loads((tmp_path / "exports/feedsure_demo.json").read_text("utf-8")) == dataset
    for table, rows in table_rows(dataset).items():
        with (tmp_path / f"exports/{table}.csv").open(encoding="utf-8", newline="") as handle:
            csv_rows = list(csv.DictReader(handle))
        assert len(csv_rows) == len(rows)
        if "generators" in table:
            assert float(csv_rows[0]["lat"]) == rows[0]["lat"]
            assert json.loads(csv_rows[0]["location_source"]) == rows[0]["location_source"]
    sql = (tmp_path / "seed.sql").read_text("utf-8")
    assert "$feedsurex$" in sql
    assert sql.count("do nothing;") == 3
    assert "create table" not in sql and "delete from" not in sql
    assert seed_sql(table_rows(dataset)) == sql


def test_rest_insert_is_ordered_idempotent_and_uses_server_headers(monkeypatch):
    requests = []

    class FakeOpener:
        def open(self, request, timeout):
            requests.append(request)
            assert timeout == 30
            assert request.headers["Apikey"] == "private-server-key"
            assert request.headers["Prefer"] == "resolution=ignore-duplicates,return=representation"
            return BytesIO(request.data)

    monkeypatch.setattr("seed_supabase.build_opener", lambda *_: FakeOpener())
    counts = insert_dataset("https://example.supabase.co", "private-server-key", build_dataset(DAY))
    assert list(counts.values()) == [10, 10, 140]
    assert "/feedsure_demo_generators?on_conflict=generator_id" in requests[0].full_url
    assert "generator_id,collection_date" in requests[1].full_url
    assert NoRedirect().redirect_request(None, None, 307, None, None, None) is None


@pytest.mark.parametrize(
    "url",
    [
        "http://example.supabase.co",
        "https://user:pass@host",
        "https://host/path",
        "https://host?token=secret",
        "",
    ],
)
def test_rest_rejects_unsafe_project_urls_before_transmission(monkeypatch, url):
    monkeypatch.setattr("seed_supabase.build_opener", lambda *_: pytest.fail("network opened"))
    with pytest.raises(ValueError, match="origin"):
        insert_dataset(url, "private-key", build_dataset(DAY))


def test_rest_errors_do_not_reveal_private_response_or_credentials(monkeypatch):
    class FailingOpener:
        def open(self, request, timeout):
            raise HTTPError(
                request.full_url, 401, "private-key echoed", {}, BytesIO(b"private-key echoed")
            )

    monkeypatch.setattr("seed_supabase.build_opener", lambda *_: FailingOpener())
    with pytest.raises(RuntimeError, match="HTTP 401") as error:
        insert_dataset("https://example.supabase.co", "private-key", build_dataset(DAY))
    assert "private-key" not in str(error.value)
