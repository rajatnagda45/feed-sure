"""Regression: local bootstrapping must not require a real Supabase user session."""

from __future__ import annotations

import json
import os
import socket

from feedsure.handlers.operations import handle_request


def test_supabase_demo_bootstraps_and_keeps_runtime_login_required(monkeypatch, tmp_path):
    import dev_server
    import local_demo
    import uvicorn

    for name in (
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_DEFAULT_REGION",
        "AWS_REGION",
        "AWS_ENDPOINT_URL",
        "MOCK_LOCATION",
        "MOCK_BEDROCK",
        "MOCK_BEDROCK_FIXTURE",
        "ADMIN_TOKEN",
        "PLANT_OWNER_TOKEN",
        "DRIVER_TOKEN_SECRET",
        "ALLOWED_ORIGIN",
    ):
        monkeypatch.setenv(name, os.environ.get(name, ""))
    for name in ("config", "database", "photo_store"):
        monkeypatch.setattr(
            dev_server.app.state, name, getattr(dev_server.app.state, name, None), raising=False
        )

    monkeypatch.setenv("AUTH_PROVIDER", "supabase")
    monkeypatch.setenv("PHOTO_STORAGE_PROVIDER", "supabase")
    monkeypatch.setenv("STAGE", "supabase-demo-test")
    access_path = tmp_path / "access.json"
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_demo.py",
            "--port",
            str(port),
            "--manifest",
            str(access_path),
            "--date",
            "2026-10-12",
        ],
    )
    checked = []

    def inspect_runtime(server, sockets):
        app = server.config.app
        config = app.state.config
        assert config.auth_provider == "supabase"
        assert config.photo_storage_provider == "supabase"
        assert len(app.state.database.scan("generators")) == 10
        assert len(app.state.database.scan("submissions")) == 8
        assert app.state.database.get("generators", {"generatorId": "demo-kitchen-01"})
        manifest = json.loads(access_path.read_text())
        assert "demo-kitchen-01" in manifest["generatorTokens"]
        result = handle_request(
            {
                "rawPath": "/generators/demo-kitchen-01",
                "headers": {"X-Generator-Token": manifest["generatorTokens"]["demo-kitchen-01"]},
            },
            config=config,
            database=app.state.database,
        )
        assert result["statusCode"] == 401
        checked.append(True)

    monkeypatch.setattr(uvicorn.Server, "run", inspect_runtime)
    local_demo.main()
    assert checked == [True]
