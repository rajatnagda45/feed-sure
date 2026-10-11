"""Disposable localhost demo using Moto transport and the real v3 HTTP/domain handlers.

Run from the repository root: python scripts/local_demo.py --date 2026-10-12
No Docker, AWS credentials or persistent database is used. Photo analysis defaults to
offline fixtures; --photo-provider nvidia explicitly enables the hosted NVIDIA API.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import sys
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend/src"), str(ROOT / "backend")]


def main() -> None:
    """Start a loopback-only disposable API and save private local access separately."""
    parser = argparse.ArgumentParser(description=__doc__)
    tomorrow = datetime.now(timezone(timedelta(hours=5, minutes=30))).date() + timedelta(days=1)
    parser.add_argument("--date", type=date.fromisoformat, default=tomorrow)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument(
        "--routing-provider",
        choices=["osrm", "fallback"],
        default="osrm",
        help="OSRM road routing (sends demo coordinates) or offline estimates.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=ROOT / ".tmp/local-demo-access.json",
        help="Separate private access manifest for isolated sessions.",
    )
    parser.add_argument("--photo-dir", type=Path, default=None)
    parser.add_argument("--photo-provider", choices=["mock", "nvidia"], default="mock")
    parser.add_argument(
        "--photo-fixture",
        choices=["clean", "plastic", "hazard", "low_confidence", "malformed"],
        default="clean",
    )
    args = parser.parse_args()
    if args.photo_provider == "nvidia" and not os.getenv("NVIDIA_API_KEY", "").strip():
        parser.error("NVIDIA_API_KEY is required for --photo-provider nvidia")
    if not 1 <= args.port <= 65535 or not 1 <= args.frontend_port <= 65535:
        parser.error("port must be between 1 and 65535")
    # Reserve the port before replacing the private manifest; a failed second start is harmless.
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind(("127.0.0.1", args.port))
        listener.listen(128)
    except OSError as error:
        listener.close()
        parser.error(f"Local API port is unavailable: {error}")
    # Overrides apply only inside this child process. Never consult real account credentials.
    os.environ.update(
        AWS_ACCESS_KEY_ID="testing",
        AWS_SECRET_ACCESS_KEY="testing",
        AWS_DEFAULT_REGION="ap-south-1",
        AWS_REGION="ap-south-1",
        AWS_ENDPOINT_URL="",
        MOCK_LOCATION="true",
        ROUTING_PROVIDER=args.routing_provider,
        MOCK_BEDROCK="false" if args.photo_provider == "nvidia" else "true",
        PHOTO_ANALYSIS_PROVIDER="nvidia" if args.photo_provider == "nvidia" else "bedrock",
        MOCK_BEDROCK_FIXTURE=args.photo_fixture,
        ADMIN_TOKEN=secrets.token_urlsafe(32),
        PLANT_OWNER_TOKEN=secrets.token_urlsafe(32),
        DRIVER_TOKEN_SECRET=secrets.token_urlsafe(48),
        ALLOWED_ORIGIN=f"http://localhost:{args.frontend_port}",
    )
    import boto3
    import uvicorn
    from feedsure.common.config import get_config
    from feedsure.common.db import DynamoDB
    from moto import mock_aws
    from seed_data import seed_v3_database

    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="ap-south-1")
        # The marker labels transport as local; this resource never opens that endpoint.
        config = replace(get_config(), aws_endpoint_url="moto://in-process")
        tokens = seed_v3_database(replace(config, auth_provider="tokens"), resource, args.date)
        import dev_server

        dev_server.app.state.config = config
        dev_server.app.state.database = DynamoDB(config, resource)
        from feedsure.handlers.photos import LocalPhotoStore

        access_file = args.manifest.resolve()
        access_file.parent.mkdir(parents=True, exist_ok=True)
        photo_dir = args.photo_dir or access_file.parent / (access_file.stem + "-photos")
        dev_server.app.state.photo_store = LocalPhotoStore(photo_dir)
        access_file.write_text(
            json.dumps(
                {
                    "collectionDate": args.date.isoformat(),
                    "apiBaseUrl": f"http://localhost:{args.port}",
                    "frontendOrigin": config.allowed_origin,
                    "adminToken": config.admin_token,
                    "plantOwnerToken": config.plant_owner_token,
                    "generatorTokens": tokens,
                    "generatorLinks": {
                        gid: f"http://localhost:{args.frontend_port}/g/{gid}?t={token}"
                        for gid, token in tokens.items()
                    },
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        screening = (
            "live NVIDIA photo analysis"
            if args.photo_provider == "nvidia"
            else f"mock screening ({args.photo_fixture})"
        )
        photos = (
            "private Supabase photos"
            if config.photo_storage_provider == "supabase"
            else "local photo bytes"
        )
        print(
            f"Synthetic kitchens; Moto DynamoDB; {photos}; {screening}; "
            f"{args.routing_provider} routing (fallback estimates on failure). Date {args.date}."
        )
        print(f"Private access: {access_file}. DynamoDB state is discarded on process stop.")
        print(f"Photo bytes persist privately in {photo_dir} until retention or manual cleanup.")
        server = uvicorn.Server(
            uvicorn.Config(dev_server.app, host="127.0.0.1", port=args.port, access_log=False)
        )
        try:
            server.run(sockets=[listener])
        finally:
            listener.close()


if __name__ == "__main__":
    main()
