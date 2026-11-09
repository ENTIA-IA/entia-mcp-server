"""Basic ENTIA usage over the hosted MCP server: lookup, search, VAT, stats.

Works without an API key: the free TRACE view answers entity_lookup,
search_entities, verify_vat and get_platform_stats. A tool above your plan
answers HTTP 401 with the plan it needs and an X-ENTIA-Checkout-Url header;
the MCP Python SDK raises on that 401, so step 5 shows it with a raw request.

    pip install "mcp>=1.8,<2"
    python examples/basic_usage.py            # free TRACE view
    ENTIA_API_KEY=... python examples/basic_usage.py   # your plan

Get a key at https://entia.systems/mcp-setup.
Pricing: https://entia.systems/.well-known/ai-pricing.json
"""
import asyncio
import json
import os

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

ENTIA_MCP_URL = os.environ.get("ENTIA_MCP_URL", "https://mcp.entia.systems/mcp")


def _headers() -> dict[str, str]:
    key = os.environ.get("ENTIA_API_KEY")
    return {"x-entia-key": key} if key else {}


def _payload(result) -> dict:
    """Return the tool's JSON payload (structuredContent or first text block)."""
    if getattr(result, "structuredContent", None):
        return result.structuredContent
    for block in result.content:
        text = getattr(block, "text", None)
        if text:
            try:
                return json.loads(text)
            except ValueError:
                return {"text": text}
    return {}


async def show(session: ClientSession, title: str, tool: str, args: dict) -> None:
    print(f"\n=== {title} ===")
    try:
        r = await session.call_tool(tool, args)
    except Exception as exc:  # keep the tour going if one tool misbehaves
        print(f"  {tool} failed: {exc}")
        return
    data = _payload(r)
    if r.isError:
        print(f"  {tool} needs plan: {data.get('required_tier')}")
        print(f"  Checkout: {data.get('checkout_url')}")
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2)[:800])


async def main() -> None:
    async with streamablehttp_client(ENTIA_MCP_URL, headers=_headers()) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = (await session.list_tools()).tools
            print(f"Connected to {ENTIA_MCP_URL}: {len(tools)} tools")

            await show(session, "1. entity_lookup", "entity_lookup", {"q": "Telefonica"})
            await show(
                session,
                "2. search_entities",
                "search_entities",
                {"q": "clinica dental", "country": "es", "city": "Madrid", "limit": 3},
            )
            await show(session, "3. verify_vat", "verify_vat", {"q": "ESA28015865"})
            await show(session, "4. get_platform_stats", "get_platform_stats", {})
            if os.environ.get("ENTIA_API_KEY"):
                await show(
                    session,
                    "5. A paid tool (get_competitors, BUILD plan)",
                    "get_competitors",
                    {"sector": "dental", "city": "Madrid"},
                )

    if not os.environ.get("ENTIA_API_KEY"):
        print("\n=== 5. A paid tool without a key (get_competitors, BUILD plan) ===")
        resp = httpx.post(
            ENTIA_MCP_URL,
            headers={"accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "get_competitors", "arguments": {"sector": "dental", "city": "Madrid"}},
            },
            timeout=60,
        )
        print(f"  HTTP {resp.status_code}")
        print(f"  Checkout: {resp.headers.get('X-ENTIA-Checkout-Url')}")

if __name__ == "__main__":
    asyncio.run(main())
