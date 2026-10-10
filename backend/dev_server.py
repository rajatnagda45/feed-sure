"""Local FastAPI shim for the Lambda handlers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from feedsure.common.config import get_config
from feedsure.handlers import generators, plans, submissions, uploads

Handler = Callable[[dict[str, Any], Any], dict[str, Any]]

config = get_config()
app = FastAPI(title="FeedSure CBG local API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.allowed_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "x-admin-token"],
)


async def _invoke(request: Request, handler: Handler) -> Response:
    body = await request.body()
    event: dict[str, Any] = {
        "version": "2.0",
        "rawPath": request.url.path,
        "rawQueryString": request.url.query,
        "headers": dict(request.headers),
        "queryStringParameters": dict(request.query_params) or None,
        "pathParameters": dict(request.path_params) or None,
        "requestContext": {
            "http": {
                "method": request.method,
                "path": request.url.path,
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


@app.get("/generators")
@app.get("/generators/{generator_id}")
async def generator_routes(request: Request, generator_id: str | None = None) -> Response:
    """Forward generator requests to the Lambda handler."""
    del generator_id
    return await _invoke(request, generators.lambda_handler)


@app.post("/uploads")
async def upload_route(request: Request) -> Response:
    """Forward upload requests to the Lambda handler."""
    return await _invoke(request, uploads.lambda_handler)


@app.get("/submissions")
@app.post("/submissions")
async def submission_routes(request: Request) -> Response:
    """Forward submission requests to the Lambda handler."""
    return await _invoke(request, submissions.lambda_handler)


@app.post("/plans")
@app.get("/plans/{date}")
async def plan_routes(request: Request, date: str | None = None) -> Response:
    """Forward plan requests to the Lambda handler."""
    del date
    return await _invoke(request, plans.lambda_handler)
