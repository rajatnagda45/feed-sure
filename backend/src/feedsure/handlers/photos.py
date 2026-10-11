"""Optional evidence transport and observation-only screening; readiness stays durable."""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import re
import secrets
import struct
import zlib
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import boto3
from botocore.config import Config as BotoConfig

from feedsure.common.v3 import ApiError, fields, invalid, revision, stamp
from feedsure.screening.bedrock_client import invoke_screening
from feedsure.screening.mock import load_fixture
from feedsure.screening.prompt import build_photo_prompt
from feedsure.screening.validate import validate_photo_observations


def validate_image(data: bytes, content_type: str, config: Any) -> None:
    """Check bounded size, image structure and dimensions without native Lambda dependencies."""
    if not config.upload_min_bytes <= len(data) <= config.upload_max_bytes:
        invalid("Photo must be within the configured upload size limits.")
    width = height = 0
    if content_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        offset, ended, pixels = 8, False, bytearray()
        scanlines: list[tuple[int, int]] = []
        palette = False
        while offset + 12 <= len(data):
            length = int.from_bytes(data[offset : offset + 4], "big")
            chunk = data[offset + 4 : offset + 8]
            end = offset + 12 + length
            if end > len(data):
                invalid("PNG is truncated.")
            payload = data[offset + 8 : end - 4]
            if zlib.crc32(chunk + payload) != int.from_bytes(data[end - 4 : end], "big"):
                invalid("PNG checksum is invalid.")
            if offset == 8:
                if chunk != b"IHDR" or length != 13:
                    invalid("PNG header is invalid.")
                width, height = struct.unpack(">II", payload[:8])
                depth, color, compression, filtering, interlace = payload[8:]
                channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color)
                valid_depths = {
                    0: {1, 2, 4, 8, 16},
                    2: {8, 16},
                    3: {1, 2, 4, 8},
                    4: {8, 16},
                    6: {8, 16},
                }
                if channels is None or depth not in valid_depths[color] or compression or filtering:
                    invalid("PNG encoding is invalid.")
                if interlace not in (0, 1):
                    invalid("PNG interlace is invalid.")
                passes = (
                    [(0, 0, 1, 1)]
                    if not interlace
                    else [
                        (0, 0, 8, 8),
                        (4, 0, 8, 8),
                        (0, 4, 4, 8),
                        (2, 0, 4, 4),
                        (0, 2, 2, 4),
                        (1, 0, 2, 2),
                        (0, 1, 1, 2),
                    ]
                )
                for x, y, dx, dy in passes:
                    columns = max(0, (width - x + dx - 1) // dx)
                    rows = max(0, (height - y + dy - 1) // dy)
                    if columns and rows:
                        scanlines.append(((columns * channels * depth + 7) // 8 + 1, rows))
            elif chunk == b"IHDR":
                invalid("PNG has multiple headers.")
            if chunk == b"PLTE":
                if pixels or not length or length % 3 or length > 768:
                    invalid("PNG palette is invalid.")
                palette = True
            if chunk not in {b"IHDR", b"PLTE", b"IDAT", b"IEND"} and not chunk[0] & 32:
                invalid("PNG critical chunk is unsupported.")
            if chunk == b"IDAT":
                if color == 3 and not palette:
                    invalid("PNG indexed image needs a palette.")
                pixels.extend(payload)
            offset = end
            if chunk == b"IEND":
                ended = length == 0 and offset == len(data)
                break
        if not ended or not pixels:
            invalid("PNG data is incomplete.")
        try:
            decoder = zlib.decompressobj()
            decoded = decoder.decompress(bytes(pixels), config.photo_max_decoded_bytes + 1)
            if (
                len(decoded) > config.photo_max_decoded_bytes
                or not decoder.eof
                or decoder.unused_data
            ):
                invalid("PNG decoded data exceeds limits or is invalid.")
            if len(decoded) != sum(row_bytes * rows for row_bytes, rows in scanlines):
                invalid("PNG scanlines are invalid.")
            position = 0
            for row_bytes, rows in scanlines:
                if any(
                    decoded[index] > 4
                    for index in range(position, position + row_bytes * rows, row_bytes)
                ):
                    invalid("PNG row filter is invalid.")
                position += row_bytes * rows
        except zlib.error:
            invalid("PNG pixel data is invalid.")
    elif (
        content_type == "image/jpeg" and data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9")
    ):
        offset, scan, quantization, huffman = 2, False, False, False
        components: set[int] = set()
        while offset + 4 <= len(data):
            if data[offset] != 255:
                invalid("JPEG marker is invalid.")
            while offset < len(data) and data[offset] == 255:
                offset += 1
            if offset + 3 > len(data):
                invalid("JPEG is truncated.")
            marker = data[offset]
            length = int.from_bytes(data[offset + 1 : offset + 3], "big")
            if length < 2 or offset + 1 + length > len(data):
                invalid("JPEG segment is invalid.")
            if marker == 0xDB:
                quantization = length >= 67
            if marker == 0xC4:
                huffman = length >= 19
            if marker in (0xC0, 0xC1, 0xC2):
                if length < 8:
                    invalid("JPEG frame is invalid.")
                height, width = struct.unpack(">HH", data[offset + 4 : offset + 8])
                count = data[offset + 8]
                if data[offset + 3] != 8 or count not in (1, 3, 4) or length != 8 + count * 3:
                    invalid("JPEG frame components are invalid.")
                components = {data[offset + 9 + index * 3] for index in range(count)}
                if len(components) != count:
                    invalid("JPEG frame components are duplicated.")
            if marker == 0xDA:
                count = data[offset + 3]
                if (
                    not components
                    or not quantization
                    or not huffman
                    or count not in (1, 3, 4)
                    or length != 6 + count * 2
                    or any(data[offset + 4 + index * 2] not in components for index in range(count))
                ):
                    invalid("JPEG scan header is invalid.")
                scan = offset + 1 + length < len(data) - 2
                break
            offset += 1 + length
        if not scan:
            invalid("JPEG pixel data is missing.")
    else:
        invalid("Photo bytes must match JPEG or PNG content type.")
    if (
        not 0 < width <= config.photo_max_dimension
        or not 0 < height <= config.photo_max_dimension
        or width * height > config.photo_max_pixels
    ):
        invalid("Photo dimensions exceed limits.")


class LocalPhotoStore:
    """Persist actual bytes privately for the explicitly enabled loopback runner only."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def paths(self, key: str) -> tuple[Path, Path]:
        if not re.fullmatch(r"submissions/[a-z0-9][a-z0-9-]{0,62}/[a-f0-9]{32}\.(jpg|png)", key):
            invalid("Invalid local photo key.")
        photo = self.root / key
        return photo, photo.with_suffix(photo.suffix + ".json")

    def issue(self, key: str, content_type: str, service: Any) -> None:
        photo, metadata = self.paths(key)
        photo.parent.mkdir(parents=True, exist_ok=True)
        metadata.write_text(
            json.dumps(
                {
                    "contentType": content_type,
                    "uploadUntil": service.now.timestamp() + service.config.upload_expiry_seconds,
                    "retainUntil": (
                        service.now + timedelta(days=service.config.photo_retention_days)
                    ).timestamp(),
                }
            ),
            encoding="utf-8",
        )

    def metadata(self, key: str, service: Any) -> dict:
        photo, metadata = self.paths(key)
        if not metadata.is_file():
            raise ApiError(404, "NOT_FOUND", "Photo is unavailable.")
        info = json.loads(metadata.read_text(encoding="utf-8"))
        if service.now.timestamp() >= info["retainUntil"]:
            photo.unlink(missing_ok=True)
            metadata.unlink(missing_ok=True)
            raise ApiError(404, "NOT_FOUND", "Photo retention expired.")
        return info

    def put(self, key: str, data: bytes, content_type: str, service: Any) -> None:
        info = self.metadata(key, service)
        if service.now.timestamp() >= info["uploadUntil"]:
            raise ApiError(409, "CONFLICT", "Upload expired. Prepare a new upload.")
        if content_type != info["contentType"]:
            invalid("Upload content type changed.")
        validate_image(data, content_type, service.config)
        photo, _ = self.paths(key)
        if photo.exists():
            if photo.read_bytes() != data:
                raise ApiError(
                    409, "CONFLICT", "Upload key already contains different bytes."
                ) from None
            return
        # Exclusive creation makes the same-key network retry safe and prevents replacement.
        try:
            with photo.open("xb") as handle:
                handle.write(data)
        except FileExistsError:
            if photo.read_bytes() != data:
                raise ApiError(409, "CONFLICT", "Upload key contains different bytes.") from None

    def get(self, key: str, service: Any) -> tuple[bytes, str]:
        info = self.metadata(key, service)
        photo, _ = self.paths(key)
        if not photo.is_file():
            raise ApiError(404, "NOT_FOUND", "Upload has not completed.")
        with photo.open("rb") as handle:
            data = handle.read(service.config.upload_max_bytes + 1)
        validate_image(data, info["contentType"], service.config)
        return data, info["contentType"]


class Photos:
    """Use existing service authentication, date transactions and mutation audit."""

    def __init__(self, service: Any) -> None:
        self.s = service

    def s3(self) -> Any:
        return boto3.client(
            "s3",
            region_name=self.s.config.aws_region,
            config=BotoConfig(connect_timeout=1, read_timeout=3, retries={"max_attempts": 0}),
        )

    def key(self, value: Any, gid: str) -> str:
        if not isinstance(value, str) or not re.fullmatch(
            rf"submissions/{re.escape(gid)}/[a-f0-9]{{32}}\.(jpg|png)", value
        ):
            invalid("Provide an issued own-kitchen photo key.")
        return value

    def uploads(self, request: dict) -> dict:
        fields(request, {"generatorId", "contentType"})
        gid = request.get("generatorId")
        if not isinstance(gid, str):
            invalid("generatorId must be a valid slug.")
        self.s.generator(gid, allow_admin=True)
        content_type = request.get("contentType")
        if content_type not in ("image/jpeg", "image/png"):
            invalid("Choose JPEG or PNG.")
        extension = "jpg" if content_type == "image/jpeg" else "png"
        key = f"submissions/{gid}/{secrets.token_hex(16)}.{extension}"
        if self.s.photo_store:
            self.s.photo_store.issue(key, content_type, self.s)
            upload = {
                "slot": "top",
                "key": key,
                "url": "/local-photos/" + key,
                "fields": {},
                "transport": "local",
            }
        else:
            post = self.s3().generate_presigned_post(
                Bucket=self.s.config.photos_bucket,
                Key=key,
                Fields={"Content-Type": content_type},
                Conditions=[
                    {"Content-Type": content_type},
                    [
                        "content-length-range",
                        self.s.config.upload_min_bytes,
                        self.s.config.upload_max_bytes,
                    ],
                ],
                ExpiresIn=self.s.config.upload_expiry_seconds,
            )
            upload = {"slot": "top", "key": key, **post, "transport": "s3"}
        return {"uploads": [upload]}

    def load(self, key: str) -> tuple[bytes, str]:
        if self.s.photo_store:
            return self.s.photo_store.get(key, self.s)
        try:
            response = self.s3().get_object(Bucket=self.s.config.photos_bucket, Key=key)
            if (
                not self.s.config.upload_min_bytes
                <= response["ContentLength"]
                <= self.s.config.upload_max_bytes
            ):
                invalid("Photo size is invalid.")
            data = response["Body"].read(self.s.config.upload_max_bytes + 1)
            content_type = response.get("ContentType", "")
            validate_image(data, content_type, self.s.config)
            return data, content_type
        except ApiError:
            raise
        except Exception as error:
            raise ApiError(
                409, "CONFLICT", "Uploaded photo is unavailable. Retry upload."
            ) from error

    def owned(self, submission_id: str) -> tuple[dict, dict]:
        submission_id = unquote(submission_id)
        gid = submission_id.split("#")[0]
        _, actor = self.s.generator(gid, allow_admin=True)
        record = self.s.db.get(
            "submissions", {"generatorId": gid, "ts": submission_id}, consistent_read=True
        )
        if not record or record.get("schemaVersion") != 3:
            raise ApiError(404, "NOT_FOUND", "Submission was not found.")
        return record, actor

    def evidence(self, submission_id: str) -> dict:
        record, _ = self.owned(submission_id)
        if not record.get("photoKeys"):
            raise ApiError(404, "NOT_FOUND", "No evidence attached.")
        data, content_type = self.load(record["photoKeys"][0])
        self.verify_evidence(record, data)
        if self.s.photo_store:
            return {
                "url": f"data:{content_type};base64," + base64.b64encode(data).decode(),
                "transport": "local",
            }
        return {
            "url": self.s3().generate_presigned_url(
                "get_object",
                Params={"Bucket": self.s.config.photos_bucket, "Key": record["photoKeys"][0]},
                ExpiresIn=self.s.config.upload_expiry_seconds,
            ),
            "transport": "s3",
        }

    def verify_evidence(self, record: dict, data: bytes) -> None:
        """Reject altered attached bytes rather than analysing different evidence silently."""
        if record.get("photoSha256") and hashlib.sha256(data).hexdigest() != record["photoSha256"]:
            raise ApiError(409, "CONFLICT", "Evidence changed. Attach a new photo.")

    def mutate(self, submission_id: str, request: dict, *, screen: bool) -> dict:
        fields(
            request, {"expectedPhotoRevision"} if screen else {"expectedPhotoRevision", "photoKey"}
        )
        old, actor = self.owned(submission_id)
        scope = ("SCREEN#" if screen else "PHOTO#") + old["submissionId"]
        key, replay = self.s.replay(scope, request)
        if replay is not None:
            return replay
        expected = revision(request.get("expectedPhotoRevision"))
        if old.get("photoRevision", 0) != expected:
            raise ApiError(409, "CONFLICT", "Photo revision changed. Refresh before retrying.")
        day, gid = old["collectionDate"], old["generatorId"]
        before = self.s.meta(day)
        head = self.s.db.get(
            "operations", {"collectionDate": day, "recordKey": "READY#" + gid}, consistent_read=True
        )
        if not head or head["submission"]["submissionId"] != old["submissionId"]:
            raise ApiError(409, "CONFLICT", "A newer readiness confirmation exists.")
        updated = copy.deepcopy(old)
        hazard = None
        if not screen:
            if "photoKey" not in request:
                invalid("photoKey is required; use null to remove a photo.")
            photo = request.get("photoKey")
            sha256 = None
            if photo is not None:
                data, content_type = self.load(self.key(photo, gid))
                sha256 = hashlib.sha256(data).hexdigest()
                if not self.s.photo_store:
                    # Signed upload forms can overwrite their key until expiry. Freeze a
                    # separate private copy whose key has never been issued for upload.
                    extension = "jpg" if content_type == "image/jpeg" else "png"
                    photo = f"submissions/{gid}/{secrets.token_hex(16)}.{extension}"
                    self.s3().put_object(
                        Bucket=self.s.config.photos_bucket,
                        Key=photo,
                        Body=data,
                        ContentType=content_type,
                    )
            updated.update(
                photoKeys=[photo] if photo else [],
                photoSha256=sha256,
                photoStatus="NOT_CHECKED",
                analysis=None,
            )
        else:
            if not old.get("photoKeys"):
                invalid("Attach a photo before analysis.")
            data, _ = self.load(self.key(old["photoKeys"][0], gid))
            self.verify_evidence(old, data)
            prompt = build_photo_prompt()
            observation = None
            for _ in range(2):
                try:
                    if self.s.config.mock_bedrock:
                        name = self.s.config.mock_bedrock_fixture
                        fixture = json.loads(load_fixture("clean" if name == "auto" else name))
                        fixture.pop("visible_contaminant_pct", None)
                        fixture["notes"] = (
                            "Configured mock fixture; does not describe the selected photo."
                        )
                        raw = json.dumps(fixture)
                    else:
                        raw = invoke_screening([data], prompt, self.s.config)
                    observation = validate_photo_observations(raw)
                    break
                except Exception:
                    continue
            status = "NOT_CHECKED"
            if observation:
                hazard_types = {"glass", "sharp_metal", "battery", "syringe_or_medical_waste"}
                hazardous = observation["hazard"] or any(
                    i["type"] in hazard_types for i in observation["items"]
                )
                if hazardous:
                    status = "REVIEW_HAZARD"
                    current = self.s.db.get(
                        "operations",
                        {"collectionDate": day, "recordKey": "HAZARD#" + gid},
                        consistent_read=True,
                    )
                    if not current or current["hazard"]["action"] != "ENTER":
                        hazard = {
                            "schemaVersion": 3,
                            "generatorId": gid,
                            "collectionDate": day,
                            "action": "ENTER",
                            "reason": "Photo flagged a possible hazard; human review required.",
                            "actor": actor,
                            "recordedAt": stamp(self.s.now),
                            "simulated": old["simulated"],
                            "source": "mock" if self.s.config.mock_bedrock else "aws",
                            "submissionId": old["submissionId"],
                        }
                else:
                    status = (
                        "ADVICE"
                        if (
                            observation["items"]
                            or observation["image_quality"] != "ok"
                            or observation["confidence"] < self.s.config.min_confidence
                        )
                        else "NO_ISSUE_OBSERVED"
                    )
            updated.update(
                photoStatus=status,
                analysis={
                    "state": "FAILED" if observation is None else "COMPLETE",
                    "mode": "mock" if self.s.config.mock_bedrock else "aws",
                    "observations": observation,
                    "recordedAt": stamp(self.s.now),
                    "limit": "Visible surface only; no safety or whole-load certification.",
                },
            )
        after = {**before, "inputRevision": before["inputRevision"] + 1}
        updated.update(
            photoRevision=expected + 1,
            inputRevision=after["inputRevision"],
            photoUpdatedAt=stamp(self.s.now),
            photoActor=actor,
        )
        response = {"submission": updated, "inputRevision": after["inputRevision"]}
        action = self.s.db.conditional_put(
            "submissions",
            updated,
            "attribute_not_exists(photoRevision)" if expected == 0 else "photoRevision = :r",
        )
        if expected:
            action["Put"]["ExpressionAttributeValues"] = {":r": expected}
        actions = [
            self.s.meta_action(before, after),
            action,
            {
                "Put": {
                    "TableName": self.s.db.table_name("operations"),
                    "Item": {**head, "submission": updated},
                }
            },
            *self.s.mutation_actions(scope, key, request, response, old),
        ]
        if hazard:
            actions.append(
                {
                    "Put": {
                        "TableName": self.s.db.table_name("operations"),
                        "Item": {
                            "collectionDate": day,
                            "recordKey": "HAZARD#" + gid,
                            "hazard": hazard,
                        },
                    }
                }
            )
        self.s.db.transact(actions)
        return response
