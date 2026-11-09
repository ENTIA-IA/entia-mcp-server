"""Regression tests for MCP checkout denials returned by upstream transports."""

import json
from unittest.mock import patch

import httpx

from entia_mcp import server


def _call(response: httpx.Response):
    """Invoke the real MCP parser against an isolated httpx transport."""
    transport = httpx.MockTransport(lambda request: response)
    original_client = httpx.Client

    def client(*args, **kwargs):
        return original_client(*args, transport=transport, **kwargs)

    with patch.object(server.httpx, "Client", side_effect=client):
        return server._mcp_call("get_competitors", {"sector": "dental", "city": "Madrid"})


def test_empty_401_preserves_http_status_and_checkout_header():
    out = _call(httpx.Response(401, headers={"X-ENTIA-Checkout-Url": "https://example.org/checkout"}))
    assert out["status_code"] == 401
    assert out["upgrade_url"] == "https://example.org/checkout"


def test_html_402_preserves_http_status():
    out = _call(httpx.Response(402, text="<html>Payment required</html>"))
    assert out["status_code"] == 402
    assert "HTTP 402" in out["error"]


def test_sse_402_preserves_json_rpc_payment_error():
    payload = {"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "Payment required", "data": {"checkout_url": "https://example.org/buy"}}}
    response = httpx.Response(402, headers={"Content-Type": "text/event-stream"}, text="event: message\ndata: " + json.dumps(payload) + "\n\n")
    out = _call(response)
    assert out["status_code"] == 402
    assert out["error"]["data"]["checkout_url"] == "https://example.org/buy"


def test_json_401_retains_structured_payment_response():
    payload = {"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "Upgrade", "data": {"minimum_plan": "build"}}}
    out = _call(httpx.Response(401, json=payload))
    assert out["error"]["data"]["minimum_plan"] == "build"


def test_sse_401_without_result_returns_denial():
    out = _call(httpx.Response(401, text="event: message\ndata: {}\n\n"))
    assert out["status_code"] == 401
