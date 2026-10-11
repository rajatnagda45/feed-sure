"""Prepare or insert the mapped demo dataset through Supabase REST using stdlib."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from export_demo_dataset import TABLE_KEYS, build_dataset, table_rows


class NoRedirect(HTTPRedirectHandler):
    """Keep server credentials on the explicitly configured destination."""

    def redirect_request(
        self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


def insert_dataset(url: str, key: str, dataset: dict[str, Any]) -> dict[str, int]:
    """Insert missing demo rows; reruns never replace previously edited rows."""
    parsed = urlparse(url)
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (parsed.scheme != "https" and not (local and parsed.scheme == "http")) or (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("SUPABASE_URL must be an HTTPS project origin or a local HTTP origin.")
    if not key.strip():
        raise ValueError("Set SUPABASE_SERVICE_ROLE_KEY in the server environment.")
    counts = {}
    opener = build_opener(NoRedirect())
    for table, rows in table_rows(dataset).items():
        request = Request(
            f"{url.rstrip('/')}/rest/v1/{table}?on_conflict={TABLE_KEYS[table]}",
            data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates,return=representation",
            },
            method="POST",
        )
        try:
            with opener.open(request, timeout=30) as response:
                counts[table] = len(json.load(response))
        except HTTPError as error:
            raise RuntimeError(
                f"Supabase insert failed for {table}: HTTP {error.code}. "
                "Earlier tables may be inserted; rerun safely after fixing it."
            ) from None
        except URLError:
            raise RuntimeError(
                f"Supabase connection failed for {table}. "
                "Earlier tables may be inserted; rerun safely after fixing it."
            ) from None
    return counts


def main() -> None:
    """Default to a credential-free dry run; --apply selects the actual remote write."""
    tomorrow = datetime.now(timezone(timedelta(hours=5, minutes=30))).date() + timedelta(days=1)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, default=tomorrow)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    dataset = build_dataset(args.date)
    if not args.apply:
        print(
            json.dumps(
                {
                    "dryRun": True,
                    "collectionDate": args.date.isoformat(),
                    "rows": {table: len(rows) for table, rows in table_rows(dataset).items()},
                },
                indent=2,
            )
        )
        return
    try:
        counts = insert_dataset(
            os.environ.get("SUPABASE_URL", ""),
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            dataset,
        )
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps({"insertedRows": counts}, indent=2))


if __name__ == "__main__":
    main()
