"""ENTIA + CrewAI example — connect to the ENTIA MCP server from any MCP-native framework.

No package install of ENTIA needed: CrewAI (like LangGraph, LlamaIndex, Claude Desktop,
Cursor) speaks MCP natively. You just point it at the remote server.

    pip install crewai crewai-tools mcp

ENTIA gives your agent VERIFIED business identity so it does not hallucinate about
companies: name/VAT/CIF anchored to official registries (VIES, BORME, GLEIF), trust
scoring, ownership and risk signals across 10 countries (11.3M+ entities).

Free tier (TRACE) needs no signup for a preview. For full dossiers set ENTIA_API_KEY
(get one at https://entia.systems/mcp-setup).
"""
import os

from crewai import Agent, Task, Crew
from crewai_tools import MCPServerAdapter

# 1. Connect to the ENTIA remote MCP server (Streamable HTTP). Zero install.
server_params = {
    "url": "https://mcp.entia.systems/mcp",
    "transport": "streamable-http",
    # Optional: paid tiers unlock get_full_dossier / run_risk_audit.
    "headers": {"x-entia-key": os.environ["ENTIA_API_KEY"]} if os.environ.get("ENTIA_API_KEY") else {},
}

with MCPServerAdapter(server_params) as entia_tools:
    print(f"Loaded {len(entia_tools)} ENTIA tools: {[t.name for t in entia_tools]}")

    # 2. Give the tools to a KYB / due-diligence agent.
    analyst = Agent(
        role="Business Verification Analyst",
        goal="Verify companies against official registries and never invent data.",
        backstory=(
            "You ground every company claim in ENTIA's verified corpus. You always cite "
            "the trust score and the source (VIES / BORME / GLEIF). If a field is not "
            "verified, you say so — you never fabricate."
        ),
        tools=entia_tools,
        verbose=True,
    )

    task = Task(
        description=(
            "Verify the Spanish company with VAT ESA28015865. Return its legal name, "
            "trust score, whether the VAT is VIES-valid, and any BORME/ownership signal."
        ),
        expected_output="A verified identity summary with trust score and cited sources.",
        agent=analyst,
    )

    crew = Crew(agents=[analyst], tasks=[task], verbose=True)
    print(crew.kickoff())
