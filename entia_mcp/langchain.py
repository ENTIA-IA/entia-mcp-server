"""ENTIA LangChain Integration — StructuredTools for AI agents.

Usage:
    from entia_mcp.langchain import build_entia_tools
    tools = build_entia_tools()
    # Use with create_tool_calling_agent() or AgentExecutor
"""

from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel, Field

from entia_mcp.client import EntiaClient, EntiaAPIError


# ── Input schemas ────────────────────────────────────────────────────

class EntiaSearchInput(BaseModel):
    query: str = Field(..., description="Business name or free-text company query")
    country: Optional[str] = Field(default="ES", description="ISO country code (ES, GB, FR, DE...)")
    limit: int = Field(default=5, ge=1, le=20, description="Maximum results")


class EntiaProfileInput(BaseModel):
    entity: str = Field(..., description="CIF, EU VAT, LEI, company name, or entity slug")
    country: Optional[str] = Field(default=None, description="ISO country code hint")


class EntiaVATInput(BaseModel):
    vat_id: str = Field(..., description="EU VAT number with country prefix (e.g. ESA28015865)")


# ── Tool functions ───────────────────────────────────────────────────

def _search(query: str, country: str = "ES", limit: int = 5) -> str:
    client = EntiaClient()
    try:
        result = client.search(query=query, country=country, limit=limit)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except EntiaAPIError as e:
        return json.dumps({"error": "search_failed", "message": str(e)})


def _profile(entity: str, country: str = None) -> str:
    client = EntiaClient()
    try:
        result = client.profile(entity=entity, country=country)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except EntiaAPIError as e:
        return json.dumps({"error": "profile_failed", "message": str(e)})


def _verify_vat(vat_id: str) -> str:
    client = EntiaClient()
    try:
        result = client.verify_vat(vat_id=vat_id)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except EntiaAPIError as e:
        return json.dumps({"error": "vat_failed", "message": str(e)})


def _health() -> str:
    client = EntiaClient()
    return json.dumps(client.health(), indent=2)


# ── Build tools ──────────────────────────────────────────────────────

def build_entia_tools() -> list:
    """Create LangChain StructuredTools for ENTIA.

    Returns 4 tools: entia_search, entia_profile, entia_verify_vat, entia_health.
    Compatible with create_tool_calling_agent() and AgentExecutor.

    Requires: pip install entia-mcp[langchain]
    """
    try:
        from langchain_core.tools import StructuredTool
    except ImportError:
        raise ImportError(
            "langchain-core is required. Install with: pip install entia-mcp[langchain]"
        )

    return [
        StructuredTool.from_function(
            func=_search,
            name="entia_search",
            description=(
                "Search ENTIA for businesses by name across 34 countries. "
                "Use this first when the exact entity identifier is unknown. "
                "Returns: name, city, sector, phone, website, ENTIA URL."
            ),
            args_schema=EntiaSearchInput,
        ),
        StructuredTool.from_function(
            func=_profile,
            name="entia_profile",
            description=(
                "Get a full entity profile from ENTIA including trust score, "
                "BORME mercantile history, GLEIF LEI, VIES VAT status, and Wikidata. "
                "Use after entia_search when you have the entity name or CIF."
            ),
            args_schema=EntiaProfileInput,
        ),
        StructuredTool.from_function(
            func=_verify_vat,
            name="entia_verify_vat",
            description=(
                "Verify an EU VAT number via VIES (27 member states). "
                "Provide the full VAT ID with country prefix, e.g. ESA28015865."
            ),
            args_schema=EntiaVATInput,
        ),
        StructuredTool.from_function(
            func=_health,
            name="entia_health",
            description="Check ENTIA API connectivity and configuration.",
        ),
    ]
