"""Local FastAPI shim for the Lambda handlers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from feedsure.common.config import get_config
from feedsure.common.routes import ROUTES
from feedsure.handlers import operations

Handler = Callable[[dict[str, Any], Any], dict[str, Any]]

config = get_config()
app = FastAPI(title="FeedSure CBG local API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.allowed_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=[
        "content-type",
        "x-admin-token",
        "x-plant-token",
        "x-account-token",
        "x-generator-token",
        "x-driver-token",
        "idempotency-key",
    ],
)


@app.api_route("/auth/login", methods=["POST"])
@app.api_route("/auth/register", methods=["POST"])
@app.api_route("/auth/logout", methods=["POST"])
@app.api_route("/auth/account", methods=["GET", "POST"])
@app.api_route("/auth/accounts", methods=["GET", "POST"])
@app.post("/auth/accounts/{login_id}")
async def local_login(request: Request) -> Response:
    """Exchange IDs/passwords only when explicitly bootstrapped by the loopback demo."""
    from feedsure.common.v3 import ApiError

    accounts = getattr(request.app.state, "local_accounts", None)
    if (
        accounts is None
        or request.client is None
        or request.client.host
        not in {
            "127.0.0.1",
            "::1",
            "testclient",
        }
    ):
        return Response(status_code=404)
    if request.headers.get("origin") not in {None, request.app.state.config.allowed_origin}:
        return Response(status_code=403)
    try:
        import json

        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 4096:
                raise ApiError(400, "INVALID_INPUT", "Login request exceeds 4 KB.")
        try:
            payload = json.loads(data) if request.method == "POST" else {}
        except (ValueError, UnicodeError) as error:
            raise ApiError(400, "INVALID_INPUT", "Login request must be valid JSON.") from error
        if not isinstance(payload, dict):
            raise ApiError(400, "INVALID_INPUT", "Login request must be an object.")
        path = request.url.path
        if path == "/auth/login":
            result = accounts.login(payload)
        elif path == "/auth/register":
            result = accounts.register(payload)
        else:
            session_token = request.headers.get("x-account-token", "")
            login_id, account = accounts.session(
                session_token, admin=path.startswith("/auth/accounts")
            )
            if path == "/auth/logout":
                accounts.sessions.pop(session_token, None)
                result = {"ok": True}
            elif path == "/auth/accounts":
                result = (
                    accounts.register(payload, admin=True)
                    if request.method == "POST"
                    else {
                        "accounts": [
                            accounts.public(key, row)
                            for key, row in sorted(accounts.accounts.items())
                            if row["status"] != "DELETED"
                        ],
                    }
                )
            elif path.startswith("/auth/accounts/"):
                result = accounts.manage(request.path_params["login_id"], payload, actor=login_id)
            elif request.method == "GET":
                result = accounts.public(login_id, account)
            else:
                import hmac

                current = payload.pop("currentPassword", None)
                if (
                    not isinstance(current, str)
                    or len(current) > 256
                    or not hmac.compare_digest(
                        accounts.hash_password(current, account["salt"]), account["hash"]
                    )
                ):
                    raise ApiError(401, "UNAUTHORIZED", "Current password is incorrect.")
                if payload.get("action") not in ("password", "delete"):
                    raise ApiError(
                        400, "INVALID_INPUT", "Choose password change or account deletion."
                    )
                # Admin self-deletion remains protected by manage().
                result = accounts.manage(login_id, payload, actor="self-service")
        return Response(
            json.dumps(result), media_type="application/json", headers={"cache-control": "no-store"}
        )
    except ApiError as error:
        from feedsure.common.http import error_response

        response = error_response(error.status, error.code, error.message)
        return Response(
            response["body"],
            status_code=error.status,
            media_type="application/json",
            headers={"cache-control": "no-store"},
        )


@app.middleware("http")
async def local_account_access(request: Request, call_next: Any) -> Response:
    """Recheck account lifecycle on every operational request, including photo uploads."""
    from feedsure.common.http import error_response
    from feedsure.common.v3 import ApiError

    accounts = getattr(request.app.state, "local_accounts", None)
    if accounts and not request.url.path.startswith("/auth/"):
        try:
            translated = accounts.translate(dict(request.headers))
            request.scope["headers"] = [
                (key.encode(), value.encode()) for key, value in translated.items()
            ]
        except ApiError as error:
            result = error_response(error.status, error.code, error.message)
            return Response(
                result["body"],
                status_code=error.status,
                media_type="application/json",
                headers={"cache-control": "no-store"},
            )
    return await call_next(request)


async def _invoke(request: Request, handler: Handler) -> Response:
    body = await request.body()
    event: dict[str, Any] = {
        "version": "2.0",
        # ASGI path is already decoded. URL.path reparses a decoded '#' as a fragment.
        "rawPath": request.scope["path"],
        "rawQueryString": request.scope.get("query_string", b"").decode("utf-8"),
        "headers": dict(request.headers),
        "queryStringParameters": dict(request.query_params) or None,
        "pathParameters": dict(request.path_params) or None,
        "requestContext": {
            "http": {
                "method": request.method,
                "path": request.scope["path"],
            }
        },
        "body": body.decode("utf-8") if body else None,
        "isBase64Encoded": False,
    }
    result = handler(event, None)
    headers = dict(result.get("headers", {}))
    media_type = headers.pop("content-type", "application/json")
    return Response(
        content=result.get("body", ""),
        status_code=int(result.get("statusCode", 200)),
        headers=headers,
        media_type=media_type,
    )


async def operational_route(request: Request) -> Response:
    """Forward all v3 routes to real handlers; no canned local success responses."""
    if hasattr(request.app.state, "database"):
        # Explicit local Moto transport injection; domain handlers/calculations are unchanged.
        def local_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
            return operations.handle_request(
                event,
                config=request.app.state.config,
                database=request.app.state.database,
                photo_store=getattr(request.app.state, "photo_store", None),
            )

        return await _invoke(request, local_handler)
    return await _invoke(request, operations.lambda_handler)


for method, path in ROUTES:
    app.add_api_route(path, operational_route, methods=[method])


@app.post("/uploads")
async def upload_route(request: Request) -> Response:
    """Forward the optional single-photo upload endpoint."""
    return await operational_route(request)


@app.post("/local-photos/{key:path}")
async def local_photo_upload(request: Request, key: str) -> Response:
    """Bounded authenticated binary transport, absent in deployed SAM and disabled by default."""
    from feedsure.common.v3 import ApiError
    from feedsure.handlers.photos import Photos

    store = getattr(request.app.state, "photo_store", None)
    if (
        store is None
        or request.client is None
        or request.client.host not in {"127.0.0.1", "::1", "testclient"}
    ):
        return Response(status_code=404)
    service = operations.Service(
        {"headers": dict(request.headers)},
        request.app.state.config,
        request.app.state.database,
        None,
        photo_store=store,
    )
    try:
        gid = key.split("/")[1] if key.startswith("submissions/") else ""
        service.generator(gid, allow_admin=True)
        Photos(service).key(key, gid)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > service.config.upload_max_bytes:
                raise ApiError(400, "INVALID_INPUT", "Photo exceeds upload limit.")
        store.put(key, bytes(data), request.headers.get("content-type", ""), service)
        return Response(status_code=204, headers={"cache-control": "no-store"})
    except ApiError as error:
        from feedsure.common.http import error_response

        result = error_response(error.status, error.code, error.message)
        return Response(result["body"], status_code=error.status, media_type="application/json")
