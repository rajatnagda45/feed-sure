"""V3 real-handler operational API with atomic readiness, dispatch and trip mutations."""

from __future__ import annotations

import copy
import hashlib
import hmac
import importlib
import re
import secrets
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import unquote

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from feedsure.common.config import Config, get_config
from feedsure.common.db import DynamoDB
from feedsure.common.http import error_response, json_response
from feedsure.common.v3 import (
    ApiError,
    body,
    clock,
    conflict,
    digest,
    fields,
    header,
    invalid,
    number,
    revision,
    secret_matches,
    service_date,
    split_plan,
    stamp,
    text,
    window,
)

PROFILE_FIELDS = {
    "generatorId",
    "name",
    "type",
    "address",
    "lat",
    "lng",
    "defaultLang",
    "supportedMaterial",
    "simulated",
}


class Service:
    """Operate durable domain records; injectable calculations are for tests only."""

    def __init__(
        self,
        event: dict[str, Any],
        config: Config,
        database: DynamoDB | None,
        now: datetime | None,
        planner: Any = None,
        reconciler: Any = None,
    ) -> None:
        self.event, self.config, self._db = event, config, database
        self.now = (now or datetime.now(UTC)).astimezone(UTC)
        self.planner, self.reconciler = planner, reconciler

    @property
    def db(self) -> DynamoDB:
        """Construct AWS transport only after validation/authentication reaches storage."""
        if self._db is None:
            self._db = DynamoDB(self.config)
        return self._db

    def admin(self) -> dict[str, str]:
        """Authenticate the configured dispatcher without accepting client identities."""
        token = header(self.event, "x-admin-token")
        expected = self.config.admin_token
        if (
            not token
            or expected in {"", "CHANGE_ME"}
            or not hmac.compare_digest(token.encode(), expected.encode())
        ):
            raise ApiError(401, "UNAUTHORIZED", "Admin token is not valid.")
        return {"type": "ADMIN", "id": "dispatcher"}

    def generator(self, generator_id: str, *, allow_admin: bool = False) -> tuple[dict, dict]:
        """Authenticate one kitchen or an attributable dispatcher operation."""
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", generator_id):
            invalid("generatorId must be a valid slug.")
        actor = self.admin() if allow_admin and header(self.event, "x-admin-token") else None
        supplied = header(self.event, "x-generator-token")
        if actor is None and not supplied:
            raise ApiError(401, "UNAUTHORIZED", "Generator token is required.")
        record = self.db.get("generators", {"generatorId": generator_id}, consistent_read=True)
        if not record:
            raise ApiError(404, "NOT_FOUND", "Generator was not found.")
        if actor is None:
            if not secret_matches(supplied, str(record.get("tokenHash", ""))):
                raise ApiError(401, "UNAUTHORIZED", "Generator token is not valid.")
            actor = {"type": "GENERATOR", "id": generator_id}
        return record, actor

    def profile(self, record: dict[str, Any]) -> dict[str, Any]:
        """Strip private and legacy screening-probability fields from kitchen profiles."""
        result = {k: v for k, v in record.items() if k in PROFILE_FIELDS}
        result.setdefault("name", str(record["generatorId"]))
        result.setdefault("type", "unknown")
        result.setdefault("defaultLang", "en")
        result.setdefault("address", f"Coordinates: {record.get('lat')}, {record.get('lng')}")
        result.setdefault("supportedMaterial", True)
        result.setdefault("simulated", False)
        result["pickupWindow"] = {
            "start": record.get("pickupStart", "06:00"),
            "end": record.get("pickupEnd", "09:00"),
        }
        return result

    def meta(self, day: str) -> dict[str, Any]:
        """Read the strongly consistent service-date revision and active-trip marker."""
        return self.db.get(
            "operations", {"collectionDate": day, "recordKey": "META"}, consistent_read=True
        ) or {"collectionDate": day, "recordKey": "META", "inputRevision": 0}

    def meta_action(self, before: dict, after: dict) -> dict:
        """Condition an input write on the exact prior date-scoped revision."""
        action = self.db.conditional_put(
            "operations", after, "(attribute_not_exists(recordKey) OR inputRevision = :r)"
        )
        action["Put"]["ExpressionAttributeValues"] = {":r": before["inputRevision"]}
        return action

    def defaults(self) -> dict[str, Any]:
        """Return shared configured planning assumptions with concrete field names."""
        c = self.config
        return {
            "targetKg": c.target_kg,
            "truckCapacityKg": c.truck_capacity_kg,
            "capacityBuffer": c.capacity_buffer,
            "readinessPrior": c.readiness_prior,
            "shiftStart": c.shift_start,
            "shiftEnd": c.shift_end,
            "serviceMin": c.service_min,
            "maxRadiusKm": c.max_radius_km,
            "mandatoryIds": [],
        }

    def snapshot(self, day: str) -> dict[str, Any]:
        """Read heads consistently and detect an edit during the snapshot operation."""
        for _ in range(3):
            before = self.meta(day)
            rows = self.db.query(
                "operations",
                KeyConditionExpression=Key("collectionDate").eq(day),
                ConsistentRead=True,
            )
            heads = {row["recordKey"]: row for row in rows}
            profiles = []
            for record in sorted(self.db.scan("generators"), key=lambda g: g["generatorId"]):
                profile = self.profile(record)
                gid = record["generatorId"]
                ready = heads.get("READY#" + gid, {}).get("submission")
                hazard = heads.get("HAZARD#" + gid, {}).get("hazard")
                profile.update(
                    readiness=ready,
                    readinessStatus=ready["status"] if ready else "UNCONFIRMED",
                    unresolvedHazards=[hazard] if hazard and hazard["action"] == "ENTER" else [],
                )
                profiles.append(profile)
            if before["inputRevision"] == self.meta(day)["inputRevision"]:
                return {
                    "schemaVersion": 3,
                    "collectionDate": day,
                    "inputRevision": before["inputRevision"],
                    "generators": profiles,
                    "depot": {
                        "id": "plant",
                        "lat": self.config.plant_lat,
                        "lng": self.config.plant_lng,
                    },
                    "defaults": self.defaults(),
                    "serviceMode": {
                        "database": "local" if self.config.aws_endpoint_url else "aws",
                        "screening": "not_used",
                        "matrix": "fallback" if self.config.mock_location else "location",
                    },
                    "simulated": any(p["simulated"] for p in profiles),
                }
        conflict("Planning inputs changed during the read. Refresh and retry.")

    def readiness(self, request: dict[str, Any]) -> dict[str, Any]:
        """Save readiness before optional screening, atomically advancing input revision."""
        fields(
            request,
            {
                "generatorId",
                "collectionDate",
                "status",
                "confirmedKg",
                "weightSource",
                "window",
                "lang",
                "reason",
                "photoKeys",
                "confirmedBy",
            },
        )
        gid = text(request.get("generatorId"), "generatorId", required=True)
        generator, actor = self.generator(gid, allow_admin=True)
        day = service_date(request.get("collectionDate"))
        status = request.get("status")
        if status not in ("READY", "NOT_READY"):
            invalid("status must be READY or NOT_READY.")
        lang = request.get("lang", "en")
        if lang not in ("en", "hi"):
            invalid("lang must be en or hi.")
        reason = text(request.get("reason"), "reason", required=actor["type"] == "ADMIN")
        confirmed_by = text(
            request.get("confirmedBy"), "confirmedBy", required=actor["type"] == "ADMIN"
        )
        if actor["type"] == "GENERATOR" and confirmed_by:
            invalid("Only an admin may record phone confirmations.")
        kg, source, time_window, photos = 0.0, None, None, []
        if status == "READY":
            kg = number(request.get("confirmedKg"), "confirmedKg", 0.001)
            source = request.get("weightSource")
            if source not in ("SCALE", "ESTIMATE"):
                invalid("weightSource must be SCALE or ESTIMATE.")
            time_window = window(request.get("window"))
            photos = request.get("photoKeys", [])
            if (
                not isinstance(photos, list)
                or len(photos) > 1
                or any(
                    not isinstance(k, str)
                    or len(k) > 500
                    or not k.startswith(f"submissions/{gid}/")
                    for k in photos
                )
            ):
                invalid("Provide at most one own-generator photo key.")
        before = self.meta(day)
        new_revision = before["inputRevision"] + 1
        timestamp = stamp(self.now)
        submission_id = f"{gid}#{timestamp}#{secrets.token_hex(8)}"
        cutoff = datetime.fromisoformat(day + "T" + clock(self.config.ready_cutoff)).replace(
            tzinfo=timezone(timedelta(hours=5, minutes=30))
        ) - timedelta(days=1)
        record = {
            "schemaVersion": 3,
            "submissionId": submission_id,
            "ts": submission_id,
            "generatorId": gid,
            "collectionDate": day,
            "date": day,
            "status": status,
            "confirmedKg": kg,
            "weightSource": source,
            "window": time_window,
            "lang": lang,
            "reason": reason,
            "photoKeys": photos,
            "confirmedBy": confirmed_by,
            "actor": actor,
            "recordedAt": timestamp,
            "late": self.now > cutoff,
            "photoStatus": "NOT_CHECKED",
            "simulated": bool(generator.get("simulated", False)),
            "inputRevision": new_revision,
        }
        head = {"collectionDate": day, "recordKey": "READY#" + gid, "submission": record}
        after = {**before, "inputRevision": new_revision}
        self.db.transact(
            [
                self.meta_action(before, after),
                self.db.conditional_put("submissions", record, "attribute_not_exists(ts)"),
                {"Put": {"TableName": self.db.table_name("operations"), "Item": head}},
            ]
        )
        return {"submission": record, "inputRevision": new_revision}

    def hazard(self, gid: str, request: dict) -> dict:
        """Enter or resolve a human hazard, preserving attributable history."""
        actor = self.admin()
        generator, _ = self.generator(gid, allow_admin=True)
        fields(request, {"collectionDate", "action", "reason"})
        day = service_date(request.get("collectionDate"))
        action = request.get("action")
        if action not in ("ENTER", "RESOLVE"):
            invalid("Hazard action must be ENTER or RESOLVE.")
        reason = text(request.get("reason"), "reason", required=True)
        before = self.meta(day)
        current = self.db.get(
            "operations",
            {"collectionDate": day, "recordKey": "HAZARD#" + gid},
            consistent_read=True,
        )
        if action == "RESOLVE" and (not current or current["hazard"]["action"] != "ENTER"):
            conflict("There is no unresolved hazard to resolve.")
        record = {
            "schemaVersion": 3,
            "generatorId": gid,
            "collectionDate": day,
            "action": action,
            "reason": reason,
            "actor": actor,
            "recordedAt": stamp(self.now),
            "simulated": bool(generator.get("simulated")),
            "hazardId": "h-" + secrets.token_hex(8),
        }
        audit = {
            "scopeKey": "HAZARD#" + day + "#" + gid,
            "idempotencyKey": "AUDIT#" + record["hazardId"],
            "current": record,
            "previous": current,
            "schemaVersion": 3,
        }
        after = {**before, "inputRevision": before["inputRevision"] + 1}
        self.db.transact(
            [
                self.meta_action(before, after),
                {
                    "Put": {
                        "TableName": self.db.table_name("operations"),
                        "Item": {
                            "collectionDate": day,
                            "recordKey": "HAZARD#" + gid,
                            "hazard": record,
                        },
                    }
                },
                self.db.conditional_put(
                    "mutation_log", audit, "attribute_not_exists(idempotencyKey)"
                ),
            ]
        )
        return {"hazard": record, "inputRevision": after["inputRevision"]}

    def calculations(self) -> tuple[Any, Any]:
        """Load the actual Session 2 interfaces, never substitute the legacy planner."""
        if self.planner is not None and self.reconciler is not None:
            return self.planner, self.reconciler
        try:
            module = importlib.import_module("feedsure.planner.reconcile")
            planner = importlib.import_module("feedsure.planner.plan").build_plan
            return planner, module.reconcile_trip
        except (ImportError, AttributeError) as error:
            raise ApiError(
                503, "DEPENDENCY_NOT_READY", "Session 2 calculations are not ready."
            ) from error

    def create_plan(self, request: dict) -> dict:
        """Build a real draft from consistent heads and date-bounded history."""
        self.admin()
        fields(
            request,
            {
                "collectionDate",
                "targetKg",
                "truckCapacityKg",
                "capacityBuffer",
                "shiftStart",
                "shiftEnd",
                "serviceMin",
                "maxRadiusKm",
                "mandatoryIds",
            },
        )
        day = service_date(request.get("collectionDate"))
        params = self.defaults()
        for field, bounds in {
            "targetKg": (0.001, 100000),
            "truckCapacityKg": (0.001, 100000),
            "capacityBuffer": (0, 1),
            "serviceMin": (0.001, 120),
            "maxRadiusKm": (0.001, 200),
        }.items():
            if field in request:
                params[field] = number(request[field], field, *bounds)
        for field in ("shiftStart", "shiftEnd"):
            if field in request:
                params[field] = clock(request[field])
        if params["shiftStart"] >= params["shiftEnd"]:
            invalid("Shift end must follow start.")
        snapshot = self.snapshot(day)
        mandatory = request.get("mandatoryIds", [])
        valid_ids = {g["generatorId"] for g in snapshot["generators"]}
        if (
            not isinstance(mandatory, list)
            or any(not isinstance(v, str) for v in mandatory)
            or len(mandatory) != len(set(mandatory))
            or set(mandatory) - valid_ids
        ):
            invalid("mandatoryIds must contain unique enrolled generator IDs.")
        params["mandatoryIds"] = mandatory
        planner, _ = self.calculations()
        from feedsure.planner.matrix import build_matrix, ordered_points

        matrix = build_matrix(
            ordered_points(snapshot["depot"], snapshot["generators"]),
            plan_date=day,
            config=self.config,
            database=self.db,
            now=self.now,
        )
        history = {}
        start = (date.fromisoformat(day) - timedelta(days=28)).isoformat()
        end = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
        for gid in sorted(valid_ids):
            history[gid] = self.db.query(
                "history",
                KeyConditionExpression=Key("generatorId").eq(gid) & Key("date").between(start, end),
            )
        inputs = {
            k: snapshot[k]
            for k in ("collectionDate", "inputRevision", "generators", "depot", "simulated")
        }
        inputs.update(params=params, history=history, matrix=matrix)
        result = planner(inputs)
        if result.get("collectionDate") != day or "expectedCollectionKg" not in result.get(
            "plan", {}
        ).get("totals", {}):
            raise ApiError(503, "DEPENDENCY_NOT_READY", "Planner does not implement contract v3.")
        short_id = "p-" + secrets.token_hex(8)
        plan_key = day + "#" + short_id
        stored = {
            **result,
            "schemaVersion": 3,
            "date": day,
            "planId": short_id,
            "planKey": plan_key,
            "version": 1,
            "state": "DRAFT",
            "executionRevision": 0,
            "createdAt": stamp(self.now),
            "dispatchedAt": None,
            "inputs": inputs,
            "inputIds": [
                g["readiness"]["submissionId"] for g in snapshot["generators"] if g["readiness"]
            ],
            "serviceMode": {**snapshot["serviceMode"], "matrix": matrix["source"]},
        }
        before = self.meta(day)
        if before["inputRevision"] != inputs["inputRevision"]:
            conflict("Inputs changed while calculating. Re-plan.")
        # Writing META unchanged creates it on first use and binds the draft snapshot atomically.
        self.db.transact(
            [
                self.meta_action(before, before),
                self.db.conditional_put("plans", stored, "attribute_not_exists(planId)"),
            ]
        )
        return self.public_plan(stored)

    def load_plan(self, plan_key: str) -> dict:
        """Strongly read a v3 plan by its actual public key."""
        day, pid = split_plan(plan_key)
        plan = self.db.get("plans", {"date": day, "planId": pid}, consistent_read=True)
        if not plan or plan.get("schemaVersion") != 3:
            raise ApiError(404, "NOT_FOUND", "V3 plan was not found.")
        return plan

    def public_plan(self, plan: dict) -> dict:
        """Expose an envelope without bearer hashes or secret issuance material."""
        result = {
            k: v
            for k, v in plan.items()
            if k
            not in {"driverTokenHash", "driverExpiresEpoch", "driverIssuedVersion", "ttl", "date"}
        }
        result["planId"] = plan["planKey"]
        return result

    def alerts(self, plan: dict) -> list[dict]:
        """Show post-snapshot changes without mutating frozen driver stops."""
        current = self.meta(plan["collectionDate"])["inputRevision"]
        return (
            []
            if current == plan["inputRevision"]
            else [
                {
                    "code": "INPUTS_CHANGED",
                    "inputRevision": current,
                    "message": "Kitchen or hazard state changed; review.",
                }
            ]
        )

    def driver_token(self, plan: dict) -> str:
        """Regenerate scoped access for authorised retry without storing a raw bearer token."""
        secret = self.config.driver_token_secret
        if len(secret) < 32 or secret == "CHANGE_ME":
            raise ApiError(503, "DEPENDENCY_NOT_READY", "Configure DRIVER_TOKEN_SECRET.")
        value = f"{plan['planKey']}|{plan['driverIssuedVersion']}|{plan['driverExpiresEpoch']}"
        return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()

    def driver(self, plan: dict) -> dict:
        """Validate token generation, expiry and dispatched trip scope."""
        token_generation_valid = (
            (
                len(self.config.driver_token_secret) >= 32
                and secret_matches(self.driver_token(plan), plan.get("driverTokenHash", ""))
            )
            if plan.get("driverIssuedVersion")
            else False
        )
        if (
            plan["state"] != "DISPATCHED"
            or not token_generation_valid
            or self.now.timestamp() >= plan.get("driverExpiresEpoch", 0)
            or not secret_matches(
                header(self.event, "x-driver-token"), plan.get("driverTokenHash", "")
            )
        ):
            raise ApiError(401, "UNAUTHORIZED", "Driver access is invalid or expired.")
        return {"type": "DRIVER", "id": plan["planKey"]}

    def replay(self, scope: str, request: dict) -> tuple[str, dict | None]:
        """Replay an identical scoped payload; reject a reused key with different content."""
        key = header(self.event, "idempotency-key")
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", key):
            invalid("Idempotency-Key is required (1-128 safe ASCII characters).")
        row = self.db.get(
            "mutation_log",
            {"scopeKey": scope, "idempotencyKey": "DEDUP#" + key},
            consistent_read=True,
        )
        if row:
            if row["requestHash"] != digest(request):
                conflict("Idempotency key was used with a different payload.")
            return key, row["response"]
        return key, None

    def mutation_actions(
        self, scope: str, key: str, request: dict, response: dict, previous: dict | None
    ) -> list[dict]:
        """Separate expiring dedup from retained audit, redacting precise location copies."""
        dedup = {
            "scopeKey": scope,
            "idempotencyKey": "DEDUP#" + key,
            "requestHash": digest(request),
            "response": response,
            "schemaVersion": 3,
            "ttl": int((self.now + timedelta(days=self.config.dedup_retention_days)).timestamp()),
        }
        audit_response = copy.deepcopy(response)
        for value in audit_response.values():
            if isinstance(value, dict):
                value.pop("gps", None)
        prior = {k: v for k, v in (previous or {}).items() if k != "gps"}
        audit = {
            "scopeKey": scope,
            "idempotencyKey": "AUDIT#" + secrets.token_hex(12),
            "requestHash": dedup["requestHash"],
            "response": audit_response,
            "previous": prior,
            "correctionReason": request.get("correctionReason"),
            "recordedAt": stamp(self.now),
            "schemaVersion": 3,
        }
        return [
            self.db.conditional_put("mutation_log", row, "attribute_not_exists(idempotencyKey)")
            for row in (dedup, audit)
        ]

    def access_response(self, plan: dict) -> dict:
        """Return access only on authenticated issuance, never ordinary plan reads."""
        return {
            "plan": self.public_plan(plan),
            "driverAccess": {
                "token": self.driver_token(plan),
                "expiresAt": stamp(datetime.fromtimestamp(plan["driverExpiresEpoch"], UTC)),
            },
        }

    def dispatch(self, plan_key: str, request: dict) -> dict:
        """Freeze a reviewed draft atomically with its date revision and single active trip."""
        self.admin()
        fields(request, {"expectedVersion", "expectedInputRevision"})
        expected = revision(request.get("expectedVersion"))
        input_revision = revision(request.get("expectedInputRevision"))
        plan = self.load_plan(plan_key)
        scope = "DISPATCH#" + plan["planKey"]
        key, replay = self.replay(scope, request)
        if replay is not None:
            return self.access_response(plan)
        if plan["state"] == "DISPATCHED":
            if expected not in {plan["version"], plan["version"] - 1}:
                conflict("Dispatch version is stale.")
            if input_revision != plan["inputRevision"]:
                conflict("Dispatch input revision is stale.")
            return self.access_response(plan)
        before = self.meta(plan["collectionDate"])
        if (
            plan["state"] != "DRAFT"
            or expected != plan["version"]
            or input_revision != plan["inputRevision"]
            or input_revision != before["inputRevision"]
        ):
            conflict("Plan is stale. Refresh inputs and re-plan before dispatch.")
        if before.get("activePlanKey"):
            conflict("A trip is already dispatched for this collection date.")
        if plan["status"] != "FEASIBLE" or plan["mandatoryConflicts"] or not plan["plan"]["stops"]:
            conflict("Resolve mandatory conflicts and select stops before dispatch.")
        if any(
            g["unresolvedHazards"]
            for g in plan["inputs"]["generators"]
            if g["generatorId"] in {s["generatorId"] for s in plan["plan"]["stops"]}
        ):
            conflict("An included kitchen has an unresolved hazard.")
        expiry = int((self.now + timedelta(hours=self.config.driver_token_hours)).timestamp())
        stored = {
            **plan,
            "state": "DISPATCHED",
            "version": plan["version"] + 1,
            "dispatchedAt": stamp(self.now),
            "driverExpiresEpoch": expiry,
            "driverIssuedVersion": plan["version"] + 1,
        }
        stored["driverTokenHash"] = hashlib.sha256(self.driver_token(stored).encode()).hexdigest()
        plan_action = self.db.conditional_put("plans", stored, "#v = :v AND #s = :s")
        plan_action["Put"].update(
            ExpressionAttributeNames={"#v": "version", "#s": "state"},
            ExpressionAttributeValues={":v": expected, ":s": "DRAFT"},
        )
        meta_action = self.meta_action(before, {**before, "activePlanKey": stored["planKey"]})
        meta_action["Put"]["ConditionExpression"] += " AND attribute_not_exists(activePlanKey)"
        actions = self.mutation_actions(
            scope, key, request, {"planKey": stored["planKey"], "version": stored["version"]}, None
        )
        self.db.transact([meta_action, plan_action, *actions])
        return self.access_response(stored)

    def execution(
        self, plan: dict, replacements: dict | None = None, gate_override: dict | None = None
    ) -> dict:
        """Recompute using latest current records rather than counting correction history."""
        rows = self.db.query(
            "pickups",
            KeyConditionExpression=Key("planKey").eq(plan["planKey"]),
            ConsistentRead=True,
        )
        by_id = {p["generatorId"]: p for p in rows}
        by_id.update(replacements or {})
        gate = gate_override or self.db.get(
            "gate_logs",
            {"date": plan["collectionDate"], "planId": plan["planId"]},
            consistent_read=True,
        )
        _, reconcile = self.calculations()
        result = reconcile(
            {
                "stops": [
                    {"generatorId": s["generatorId"], "pickup": by_id.get(s["generatorId"])}
                    for s in plan["plan"]["stops"]
                ],
                "gate": gate,
                "absoluteToleranceKg": self.config.absolute_tolerance_kg,
                "percentageTolerancePct": self.config.percentage_tolerance_pct,
            }
        )
        visible_gate = {**gate, "reconciliation": result} if gate is not None else None
        return {"pickups": list(by_id.values()), "gate": visible_gate, "reconciliation": result}

    def current_condition(self, table: str, record: dict, expected: int) -> dict:
        """Require creation or the exact current record revision."""
        action = self.db.conditional_put(table, record, "attribute_not_exists(revision)")
        if expected:
            action["Put"].update(
                ConditionExpression="revision = :r", ExpressionAttributeValues={":r": expected}
            )
        return action

    def gps(self, value: Any, stop: dict) -> dict:
        """Treat absent/weak location as unknown supporting evidence."""
        if value is None:
            return {"gps": None, "gpsStatus": "UNKNOWN", "distanceM": None, "gpsExpiresAt": None}
        if not isinstance(value, dict):
            invalid("gps must be an object or null.")
        fields(value, {"lat", "lng", "accuracyM", "deviceAt"})
        lat = number(value.get("lat"), "gps.lat", -90, 90)
        lng = number(value.get("lng"), "gps.lng", -180, 180)
        accuracy = number(value.get("accuracyM"), "gps.accuracyM", 0, 100000)
        device = value.get("deviceAt")
        if device is not None:
            try:
                if (
                    not isinstance(device, str)
                    or datetime.fromisoformat(device.replace("Z", "+00:00")).tzinfo is None
                ):
                    raise ValueError
            except ValueError:
                invalid("deviceAt must be a timezone-aware timestamp.")
        distance, status = None, "UNKNOWN"
        if accuracy <= self.config.gps_accuracy_m:
            from feedsure.planner.matrix import haversine_km

            distance = round(haversine_km({"lat": lat, "lng": lng}, stop) * 1000, 2)
            status = "OUT_OF_RANGE" if distance > self.config.geofence_m else "IN_RANGE"
        return {
            "gps": {"lat": lat, "lng": lng, "accuracyM": accuracy, "deviceAt": device},
            "gpsStatus": status,
            "distanceM": distance,
            "gpsExpiresAt": int(
                (self.now + timedelta(days=self.config.gps_retention_days)).timestamp()
            ),
        }

    def pickup(self, request: dict) -> dict:
        """Save/correct an assigned stop outcome with atomic capacity and retry protection."""
        fields(
            request,
            {
                "planKey",
                "generatorId",
                "outcome",
                "kg",
                "weightSource",
                "reason",
                "remainingKg",
                "remainingUnknown",
                "gps",
                "expectedRevision",
                "correctionReason",
            },
        )
        plan = self.load_plan(request.get("planKey"))
        actor = self.driver(plan)
        gid = request.get("generatorId")
        stop = next((s for s in plan["plan"]["stops"] if s["generatorId"] == gid), None)
        if not stop:
            raise ApiError(401, "UNAUTHORIZED", "Kitchen is not assigned to this trip.")
        scope = "PICKUP#" + plan["planKey"] + "#" + gid
        key, replay = self.replay(scope, request)
        if replay is not None:
            return replay
        expected = revision(request.get("expectedRevision"))
        old = self.db.get(
            "pickups", {"planKey": plan["planKey"], "generatorId": gid}, consistent_read=True
        )
        if (old or {}).get("revision", 0) != expected:
            conflict("Pickup revision changed. Refresh before correcting.")
        correction = text(request.get("correctionReason"), "correctionReason", required=bool(old))
        outcome = request.get("outcome")
        if outcome not in ("COLLECTED", "PARTIAL", "NOT_READY", "SKIPPED"):
            invalid("Unsupported pickup outcome.")
        kg = number(request.get("kg"), "kg")
        source = request.get("weightSource")
        reason = text(request.get("reason"), "reason", required=outcome != "COLLECTED")
        if outcome in {"COLLECTED", "PARTIAL"}:
            if kg <= 0 or source not in ("SCALE", "ESTIMATE"):
                invalid("Collected/partial requires positive kg and SCALE/ESTIMATE source.")
        elif kg != 0 or source is not None:
            invalid("Not-ready/skipped requires zero kg and null source.")
        remaining, unknown = request.get("remainingKg"), request.get("remainingUnknown", False)
        if not isinstance(unknown, bool):
            invalid("remainingUnknown must be a boolean.")
        if outcome == "PARTIAL":
            if unknown == (remaining is not None):
                invalid("Partial requires either remainingKg or remainingUnknown.")
            if remaining is not None:
                remaining = number(remaining, "remainingKg", 0.001)
        elif remaining is not None or unknown:
            invalid("Remaining quantity is only valid for partial pickups.")
        record = {
            "schemaVersion": 3,
            "planKey": plan["planKey"],
            "generatorId": gid,
            "collectionDate": plan["collectionDate"],
            "recordKey": f"{plan['collectionDate']}#{plan['planId']}#{gid}",
            "outcome": outcome,
            "kg": kg,
            "weightSource": source,
            "reason": reason,
            "remainingKg": remaining,
            "remainingUnknown": unknown,
            "correctionReason": correction,
            "revision": expected + 1,
            "recordedAt": stamp(self.now),
            "actor": actor,
            "simulated": bool(plan["simulated"]),
            "inputSnapshot": stop,
            **self.gps(request.get("gps"), stop),
        }
        execution = self.execution(plan, {gid: record})
        if sum(p["kg"] for p in execution["pickups"]) > plan["params"]["truckCapacityKg"]:
            conflict("Recorded load exceeds truck capacity; record a partial pickup/return.")
        response = {"pickup": record, "reconciliation": execution["reconciliation"]}
        plan_action = self.execution_action(plan)
        hazard_checks = []
        if kg > 0:
            hazard_checks = [
                {
                    "ConditionCheck": {
                        "TableName": self.db.table_name("operations"),
                        "Key": {
                            "collectionDate": plan["collectionDate"],
                            "recordKey": "HAZARD#" + gid,
                        },
                        "ConditionExpression": (
                            "attribute_not_exists(recordKey) OR hazard.#a = :resolved"
                        ),
                        "ExpressionAttributeNames": {"#a": "action"},
                        "ExpressionAttributeValues": {":resolved": "RESOLVE"},
                    }
                }
            ]
        self.db.transact(
            [
                self.current_condition("pickups", record, expected),
                plan_action,
                *hazard_checks,
                *self.mutation_actions(scope, key, request, response, old),
            ]
        )
        return response

    def execution_action(self, plan: dict) -> dict:
        """Serialise all pickup/gate writes on the trip execution revision."""
        action = self.db.conditional_put(
            "plans",
            {**plan, "executionRevision": plan.get("executionRevision", 0) + 1},
            "executionRevision = :r AND #s = :s",
        )
        action["Put"].update(
            ExpressionAttributeNames={"#s": "state"},
            ExpressionAttributeValues={":r": plan.get("executionRevision", 0), ":s": "DISPATCHED"},
        )
        return action

    def gate(self, request: dict) -> dict:
        """Save net intake and correction history; never allocate truck mass to kitchens."""
        actor = self.admin()
        fields(
            request,
            {
                "planKey",
                "netKg",
                "weightSource",
                "reference",
                "expectedRevision",
                "correctionReason",
                "grossKg",
                "tareKg",
            },
        )
        plan = self.load_plan(request.get("planKey"))
        if plan["state"] != "DISPATCHED":
            conflict("Gate logging requires a dispatched trip.")
        scope = "GATE#" + plan["planKey"]
        key, replay = self.replay(scope, request)
        if replay is not None:
            return replay
        expected = revision(request.get("expectedRevision"))
        old = self.db.get(
            "gate_logs",
            {"date": plan["collectionDate"], "planId": plan["planId"]},
            consistent_read=True,
        )
        if (old or {}).get("revision", 0) != expected:
            conflict("Gate revision changed. Refresh before correcting.")
        net = number(request.get("netKg"), "netKg", 0, 100000)
        source = request.get("weightSource")
        if source not in ("SCALE", "ESTIMATE"):
            invalid("weightSource must be SCALE or ESTIMATE.")
        gross = tare = None
        if "grossKg" in request or "tareKg" in request:
            gross = number(request.get("grossKg"), "grossKg", 0, 100000)
            tare = number(request.get("tareKg"), "tareKg", 0, 100000)
            if gross < tare or abs(gross - tare - net) > 0.000001:
                invalid("Gross must be >= tare; netKg must equal gross minus tare.")
        correction = text(request.get("correctionReason"), "correctionReason", required=bool(old))
        record = {
            "schemaVersion": 3,
            "date": plan["collectionDate"],
            "planId": plan["planId"],
            "planKey": plan["planKey"],
            "netKg": net,
            "weightSource": source,
            "grossKg": gross,
            "tareKg": tare,
            "reference": text(request.get("reference"), "reference"),
            "correctionReason": correction,
            "revision": expected + 1,
            "recordedAt": stamp(self.now),
            "actor": actor,
            "simulated": plan["simulated"],
        }
        result = self.execution(plan, gate_override=record)["reconciliation"]
        record["reconciliation"] = result
        response = {"gate": record, "reconciliation": result}
        self.db.transact(
            [
                self.current_condition("gate_logs", record, expected),
                self.execution_action(plan),
                *self.mutation_actions(scope, key, request, response, old),
            ]
        )
        return response

    def receipts(self, gid: str, month: str | None) -> dict:
        """Query only this generator's pickup index and join linked trip-level gate state."""
        self.generator(gid)
        expression = Key("generatorId").eq(gid)
        if month:
            service_date(month + "-01")
            expression &= Key("recordKey").begins_with(month + "-")
        rows = self.db.query("pickups", IndexName="byGenerator", KeyConditionExpression=expression)
        records = []
        for pickup in rows:
            plan = self.load_plan(pickup["planKey"])
            execution = self.execution(plan)
            reconciliation = execution["reconciliation"]
            records.append(
                {
                    "pickup": pickup,
                    "planKey": plan["planKey"],
                    "collectionDate": plan["collectionDate"],
                    "gateStatus": reconciliation["status"],
                    "gateRecorded": execution["gate"] is not None,
                    "provisional": reconciliation["provisional"],
                }
            )
        return {"schemaVersion": 3, "generatorId": gid, "records": records}

    def route(self) -> dict:
        """Dispatch HTTP surface shared by SAM and the local shim."""
        method = (self.event.get("requestContext") or {}).get("http", {}).get("method", "GET")
        path = self.event.get("rawPath") or ""
        query = self.event.get("queryStringParameters") or {}
        if method == "GET" and path in {"/operations", "/submissions"}:
            self.admin()
            day = service_date(query.get("date"))
            snapshot = self.snapshot(day)
            return (
                snapshot
                if path == "/operations"
                else {
                    "submissions": [
                        g["readiness"] for g in snapshot["generators"] if g["readiness"]
                    ],
                    "inputRevision": snapshot["inputRevision"],
                    "schemaVersion": 3,
                }
            )
        if path == "/submissions" and method == "POST":
            return self.readiness(body(self.event))
        if path == "/generators" and method == "GET":
            self.admin()
            return {"generators": [self.profile(g) for g in self.db.scan("generators")]}
        match = re.fullmatch(r"/generators/([^/]+)(?:/(receipts|hazard-reviews))?", path)
        if match:
            gid, suffix = match.groups()
            if suffix == "hazard-reviews" and method == "POST":
                return self.hazard(gid, body(self.event))
            if suffix == "receipts" and method == "GET":
                return self.receipts(gid, query.get("month"))
            if suffix is None and method == "GET":
                record, _ = self.generator(gid)
                return {"generator": self.profile(record)}
        if path == "/plans" and method == "POST":
            return self.create_plan(body(self.event))
        match = re.fullmatch(r"/plans/([^/]+)(?:/(details|dispatch|driver))?", path)
        if match:
            value, suffix = match.groups()
            if suffix == "dispatch" and method == "POST":
                return self.dispatch(value, body(self.event))
            if suffix == "driver" and method == "GET":
                plan = self.load_plan(value)
                self.driver(plan)
                visible = self.public_plan(plan)
                visible.pop("inputs", None)
                visible.pop("baseline", None)
                return {"plan": visible, **self.execution(plan), "alerts": self.alerts(plan)}
            if method == "GET":
                self.admin()
                if suffix == "details":
                    plan = self.load_plan(value)
                    return {
                        "plan": self.public_plan(plan),
                        "execution": self.execution(plan),
                        "alerts": self.alerts(plan),
                    }
                day = service_date(unquote(value))
                rows = self.db.query(
                    "plans", KeyConditionExpression=Key("date").eq(day), ConsistentRead=True
                )
                rows = [p for p in rows if p.get("schemaVersion") == 3]
                active_key = self.meta(day).get("activePlanKey")
                active = next((p for p in rows if p["planKey"] == active_key), None)
                latest = active or (
                    max(rows, key=lambda p: (p["createdAt"], p["planId"])) if rows else None
                )
                return {"plan": self.public_plan(latest) if latest else None}
        if path == "/pickups" and method == "POST":
            return self.pickup(body(self.event))
        if path == "/gate-logs" and method == "POST":
            return self.gate(body(self.event))
        if re.fullmatch(r"/submissions/[^/]+/screen", path) and method == "POST":
            submission_id = unquote(path.split("/")[2])
            gid = submission_id.split("#")[0]
            self.generator(gid, allow_admin=True)
            raise ApiError(503, "DEPENDENCY_NOT_READY", "Optional P1 screening is not shipped.")
        raise ApiError(404, "NOT_FOUND", "Endpoint was not found.")


def handle_request(
    event: dict[str, Any],
    *,
    config: Config | None = None,
    database: DynamoDB | None = None,
    now: datetime | None = None,
    planner: Any = None,
    reconciler: Any = None,
) -> dict[str, Any]:
    """Execute the same real domain handler under Lambda, local transport or moto tests."""
    try:
        response = Service(
            event, config or get_config(), database, now, planner, reconciler
        ).route()
        result = json_response(200, response)
    except ApiError as error:
        result = error_response(error.status, error.code, error.message)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        reasons = error.response.get("CancellationReasons", [])
        if code == "ConditionalCheckFailedException" or (
            code == "TransactionCanceledException"
            and any(r.get("Code") == "ConditionalCheckFailed" for r in reasons)
        ):
            result = error_response(
                409, "CONFLICT", "Concurrent change. Refresh/retry with same key."
            )
        else:
            result = error_response(
                502, "UPSTREAM_FAILED", "Storage operation failed. Retry safely."
            )
    except BotoCoreError:
        result = error_response(502, "UPSTREAM_FAILED", "Storage operation failed. Retry safely.")
    except ValueError:
        result = error_response(400, "INVALID_INPUT", "Calculation input is invalid.")
    result["headers"].update({"cache-control": "no-store", "referrer-policy": "no-referrer"})
    return result


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """AWS entrypoint for operational v3 routes."""
    del context
    return handle_request(event)
