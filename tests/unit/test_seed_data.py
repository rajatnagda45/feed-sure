"""M1 seed-data integration against moto's in-memory DynamoDB."""

from __future__ import annotations

from typing import Any

import boto3
from feedsure.common.config import get_config
from feedsure.common.db import to_api_value
from moto import mock_aws
from seed_data import build_seed_records, ensure_local_tables, load_pilot, seed_database


def _scan(resource: Any, table_name: str) -> list[dict[str, Any]]:
    return to_api_value(resource.Table(table_name).scan()["Items"])


def test_seed_is_deterministic_idempotent_and_within_ranges(monkeypatch: Any) -> None:
    monkeypatch.setenv("STAGE", "seed-test")
    for variable in (
        "GENERATORS_TABLE",
        "HISTORY_TABLE",
        "SUBMISSIONS_TABLE",
        "PLANS_TABLE",
        "AWS_ENDPOINT_URL",
    ):
        monkeypatch.delenv(variable, raising=False)
    config = get_config()
    pilot = load_pilot()

    assert build_seed_records(pilot) == build_seed_records(pilot)

    with mock_aws():
        resource = boto3.resource("dynamodb", region_name=config.aws_region)
        ensure_local_tables(config, resource)

        first_summary, _records = seed_database(config, resource, pilot)
        first_generators = _scan(resource, config.generators_table)
        first_history = _scan(resource, config.history_table)

        second_summary, _records = seed_database(config, resource, pilot)
        second_generators = _scan(resource, config.generators_table)
        second_history = _scan(resource, config.history_table)

    assert first_summary.generators_written == second_summary.generators_written == 10
    assert first_summary.history_written == second_summary.history_written == 14 * 10
    assert len(second_generators) == 10
    assert len(second_history) == 14 * 10
    assert sorted(first_generators, key=lambda item: item["generatorId"]) == sorted(
        second_generators,
        key=lambda item: item["generatorId"],
    )
    assert sorted(first_history, key=lambda item: (item["generatorId"], item["date"])) == sorted(
        second_history,
        key=lambda item: (item["generatorId"], item["date"]),
    )

    ranges = {item["id"]: item["kg_range"] for item in pilot["generators"]}
    assert all(
        ranges[item["generatorId"]][0] <= item["kg"] <= ranges[item["generatorId"]][1]
        for item in second_history
    )
    assert all(
        len(
            {
                item["kg"]
                for item in second_history
                if item["generatorId"] == generator["generatorId"]
            }
        )
        > 1
        for generator in second_generators
    )
    assert any(item["contaminationFlag"] for item in second_history)
    assert any(item["pickupRejected"] for item in second_history)
    assert all(not item["pickupRejected"] or item["contaminationFlag"] for item in second_history)
