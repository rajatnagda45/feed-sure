"""Windows launcher integration: generated Vite settings must remain readable and public."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(sys.platform != "win32", reason="Windows PowerShell launcher")
def test_launcher_writes_bom_free_public_environment_without_starting_servers(tmp_path):
    project = tmp_path / "fixture with spaces"
    (project / "scripts").mkdir(parents=True)
    (project / "frontend").mkdir()
    script = project / "scripts/start_supabase_demo.ps1"
    source = Path(__file__).resolve().parents[2] / "scripts/start_supabase_demo.ps1"
    shutil.copyfile(source, script)
    (project / ".env").write_text(
        "SUPABASE_URL=https://fixture.supabase.co\n"
        "SUPABASE_PUBLISHABLE_KEY=test-public-key\n"
        "SUPABASE_SERVICE_ROLE_KEY=test-server-key-never-publish\n"
        "AUTH_PROVIDER=supabase\nPHOTO_STORAGE_PROVIDER=supabase\n"
        "SUPABASE_ACCOUNT_MANAGEMENT=true\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-File", str(script), "-PrepareOnly"],
        capture_output=True,
        text=True,
        check=True,
        timeout=20,
    )
    raw = (project / "frontend/.env.supabase.local").read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf")
    assert raw.decode("utf-8").splitlines() == [
        "VITE_AUTH_EMAIL_MODE=admin",
        "VITE_API_BASE_URL=http://localhost:8797",
        "VITE_SUPABASE_URL=https://fixture.supabase.co",
        "VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key",
    ]
    assert b"test-server-key" not in raw
    assert "test-server-key" not in result.stdout + result.stderr
    assert "No server started" in result.stdout
