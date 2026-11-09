"""ENTIA + LangChain agent over the hosted MCP server.

Requirements:
    pip install langchain-mcp-adapters langgraph langchain-openai

No ENTIA install needed: langchain-mcp-adapters loads the tools straight from
https://mcp.entia.systems/mcp. Without ENTIA_API_KEY the agent gets the free
TRACE view and only the tools that TRACE opens (read from ai-pricing.json).
This example deliberately remains TRACE-only even if ENTIA_API_KEY is set:
the presence of a key alone does not prove a paid entitlement.
a tool above your plan answers HTTP 401 with an X-ENTIA-Checkout-Url header,
and the MCP SDK raises on that 401, which would stop the agent mid-run.
Get a key at https://entia.systems/mcp-setup.
"""
import asyncio
import os

import httpx
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

ENTIA_MCP_URL = os.environ.get("ENTIA_MCP_URL", "https://mcp.entia.systems/mcp")
PRICING_URL = "https://entia.systems/.well-known/ai-pricing.json"


def trace_tool_names() -> set[str]:
    """Tools the free TRACE plan opens, from the published pricing card."""
    card = httpx.get(PRICING_URL, timeout=30).json()
    return {t["id"] for t in card.get("tools", []) if t.get("tier_minimum") == "trace"}

SYSTEM = (
    "You are a business verification assistant powered by ENTIA. "
    "Use entity_lookup for a company's verified identity, search_entities to find "
    "companies, and verify_vat for EU VAT numbers. Always cite the trust score and "
    "the sources. If a tool says a paid plan is required, say so and give its "
    "checkout_url; never invent the missing data."
)


async def main() -> None:
    key = os.environ.get("ENTIA_API_KEY")
    client = MultiServerMCPClient(
        {
            "entia": {
                "url": ENTIA_MCP_URL,
                "transport": "streamable_http",
                "headers": {"x-entia-key": key} if key else {},
            }
        }
    )
    tools = await client.get_tools()
    # A key does not establish its plan. This public demonstration is always
    # constrained to TRACE; never hand unauthorized paid tools to the agent.
    allowed = trace_tool_names()
    tools = [t for t in tools if t.name in allowed]
    print(f"Loaded {len(tools)} ENTIA tools: {[t.name for t in tools]}")

    agent = create_react_agent(ChatOpenAI(model="gpt-4o-mini", temperature=0), tools, prompt=SYSTEM)

    queries = [
        "Is VAT number ESA28015865 valid? Who does it belong to?",
        "Find 3 dental clinics in Barcelona and compare their trust scores",
        "Give me the verified identity of Inditex in Spain",
    ]
    for q in queries:
        print(f"\n{'=' * 60}\nQuery: {q}\n{'=' * 60}")
        result = await agent.ainvoke({"messages": [("user", q)]})
        print(f"\nAnswer: {result['messages'][-1].content}")


if __name__ == "__main__":
    asyncio.run(main())
