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
        "authorization",
        "x-admin-token",
        "x-plant-token",
        "x-generator-token",
        "x-driver-token",
        "idempotency-key",
    ],
)


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
