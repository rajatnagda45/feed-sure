"""Small DynamoDB boundary shared by handlers and maintenance scripts."""

from __future__ import annotations

from decimal import Decimal
from math import isfinite
from typing import Any, Literal

import boto3

from feedsure.common.config import Config, get_config

TableName = Literal[
    "generators",
    "history",
    "submissions",
    "plans",
    "operations",
    "pickups",
    "gate_logs",
    "mutation_log",
]


def to_db_value(value: Any) -> Any:
    """Recursively convert Python floats into DynamoDB-safe decimals."""
    if isinstance(value, float):
        if not isfinite(value):
            raise ValueError("DynamoDB numbers must be finite")
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: to_db_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_db_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(to_db_value(item) for item in value)
    return value


def to_api_value(value: Any) -> Any:
    """Recursively convert DynamoDB decimals into JSON-compatible numbers."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {key: to_api_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_api_value(item) for item in value]
    if isinstance(value, tuple):
        return [to_api_value(item) for item in value]
    return value


class DynamoDB:
    """Resolve table names and expose small, paginated DynamoDB operations."""

    def __init__(self, config: Config | None = None, resource: Any | None = None) -> None:
        """Create a wrapper using injected resources in tests or boto3 in production."""
        self.config = config or get_config()
        if resource is None:
            options: dict[str, Any] = {"region_name": self.config.aws_region}
            if self.config.aws_endpoint_url:
                options.update(
                    endpoint_url=self.config.aws_endpoint_url,
                    aws_access_key_id="testing",
                    aws_secret_access_key="testing",
                )
            resource = boto3.resource("dynamodb", **options)
        self.resource = resource

    def table_name(self, table: TableName) -> str:
        """Return the configured physical name for a logical table."""
        return {
            "generators": self.config.generators_table,
            "history": self.config.history_table,
            "submissions": self.config.submissions_table,
            "plans": self.config.plans_table,
            "operations": self.config.operations_table,
            "pickups": self.config.pickups_table,
            "gate_logs": self.config.gate_logs_table,
            "mutation_log": self.config.mutation_log_table,
        }[table]

    def get(
        self,
        table: TableName,
        key: dict[str, Any],
        *,
        consistent_read: bool = False,
    ) -> dict[str, Any] | None:
        """Fetch one item by primary key."""
        response = self.resource.Table(self.table_name(table)).get_item(
            Key=to_db_value(key),
            ConsistentRead=consistent_read,
        )
        item = response.get("Item")
        return to_api_value(item) if item is not None else None

    def put(self, table: TableName, item: dict[str, Any]) -> None:
        """Upsert one item by its table primary key."""
        self.resource.Table(self.table_name(table)).put_item(Item=to_db_value(item))

    def transact(self, actions: list[dict[str, Any]]) -> None:
        """Atomically apply native-value actions using the DynamoDB resource serializer."""
        self.resource.meta.client.transact_write_items(TransactItems=to_db_value(actions))

    def conditional_put(
        self, table: TableName, item: dict[str, Any], condition: str
    ) -> dict[str, Any]:
        """Construct an atomic Put action; callers provide optimistic conditions."""
        return {
            "Put": {
                "TableName": self.table_name(table),
                "Item": item,
                "ConditionExpression": condition,
            }
        }

    def query(self, table: TableName, **kwargs: Any) -> list[dict[str, Any]]:
        """Query all pages and return JSON-compatible items."""
        table_resource = self.resource.Table(self.table_name(table))
        options = to_db_value(kwargs)
        items: list[dict[str, Any]] = []
        while True:
            response = table_resource.query(**options)
            items.extend(to_api_value(response.get("Items", [])))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                return items
            options["ExclusiveStartKey"] = last_key

    def scan(self, table: TableName, **kwargs: Any) -> list[dict[str, Any]]:
        """Scan all pages and return JSON-compatible items."""
        table_resource = self.resource.Table(self.table_name(table))
        options = to_db_value(kwargs)
        items: list[dict[str, Any]] = []
        while True:
            response = table_resource.scan(**options)
            items.extend(to_api_value(response.get("Items", [])))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                return items
            options["ExclusiveStartKey"] = last_key
