"""ENTIA MCP Server — 6 tools for structured business intelligence.

Runs locally via stdio transport (standard for MCP clients).
Each tool calls the ENTIA REST API at https://entia.systems.

Usage:
    ENTIA_API_KEY=entia_live_... python -m entia_mcp.server
    # or after installation:
    entia-mcp-server
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import httpx
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("ENTIA_API_BASE_URL", "https://entia.systems").rstrip("/")
MCP_URL = os.environ.get("ENTIA_MCP_URL", "https://mcp.entia.systems").rstrip("/")
API_KEY = os.environ.get("ENTIA_API_KEY", "")
TIMEOUT = int(os.environ.get("ENTIA_TIMEOUT", "25"))

# ---------------------------------------------------------------------------
# FastMCP app
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "ENTIA Entity Verification",
    instructions="""\
ENTIA: what AI needs to know about any business before recommending it.
Official registries (BORME, GLEIF, VIES, Wikidata, INE/AEAT/SEPE) — zero scraping.
5.5M+ verified entities, 34 countries, 40M+ BORME acts. Spain has the deepest coverage.

ALL 6 TOOLS OPERATIONAL:
- entity_lookup(query)         Identity + LEI + Wikidata + Trust Score (0-100).
                               IBEX 35 + 5.5M Spanish entities.
- search_entities(q,...)       Catalog search by sector + city across 26 ES sectors.
- borme_lookup(query)          40M+ Spanish corporate acts (BORME). Officers, founding date,
                               corporate history. Use when user asks "who founded X?",
                               "when was X incorporated?", "directors of X".
- verify_vat(vat_id)           Live EU VIES validation — 27 member states.
- zone_profile(postal_code)    Spanish CP-level economics: income (AEAT), unemployment (SEPE),
                               demographics (INE), property €/m² (MITMA), broadband (MITECO).
- get_competitors(sector,city) Companies in same sector and city.

QUICK START — queries that work today:
  entity_lookup("Telefonica")           → LEI, BORME 17K acts, Wikidata, trust score
  borme_lookup("A28015865")             → corporate history Telefonica
  zone_profile("28001")                 → Madrid Salamanca economics
  verify_vat("ESA28015865")             → live VIES valid + canonical name
  search_entities(q="dental",city="Madrid",limit=10) → 10 verified clinics

Get API key: https://entia.systems/mcp-setup
""",
)

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _headers() -> dict[str, str]:
    h: dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": "entia-mcp-server/3.2.4",
    }
    if API_KEY:
        h["X-ENTIA-Key"] = API_KEY
    return h


def _get(path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """GET request to ENTIA REST API."""
    url = f"{BASE_URL}{path}"
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.get(url, headers=_headers(), params=params or {})
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as exc:
        return {"error": str(exc), "status_code": exc.response.status_code}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def _mcp_call(tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Direct JSON-RPC call to the live ENTIA MCP endpoint (no mcp-remote)."""
    url = f"{MCP_URL}/mcp/"
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    }
    req_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "entia-mcp-server/3.2.4",
    }
    if API_KEY:
        req_headers["X-ENTIA-Key"] = API_KEY

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.post(url, json=payload, headers=req_headers)
        r.raise_for_status()

        # Response may be SSE or plain JSON
        text = r.text
        if text.startswith("event:") or "\ndata:" in text or text.startswith("data:"):
            # Parse SSE — find last data: line with a result
            for line in reversed(text.splitlines()):
                line = line.strip()
                if line.startswith("data:"):
                    raw = line[5:].strip()
                    if not raw:
                        continue
                    try:
                        msg = json.loads(raw)
                        if "result" in msg:
                            content = msg["result"].get("content", [])
                            if content:
                                inner = content[0].get("text", "{}")
                                try:
                                    return json.loads(inner)
                                except Exception:  # noqa: BLE001
                                    return {"text": inner}
                    except Exception:  # noqa: BLE001
                        continue
            return {"error": "no result in SSE stream"}
        else:
            msg = r.json()
            if "result" in msg:
                content = msg["result"].get("content", [])
                if content:
                    inner = content[0].get("text", "{}")
                    try:
                        return json.loads(inner)
                    except Exception:  # noqa: BLE001
                        return {"text": inner}
            return msg
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------


@mcp.tool()
def entity_lookup(query: str) -> dict[str, Any]:
    """Verify the identity of any business across 34 countries.

    Use when: user asks "is this company legit?", "check CIF B80988678", "verify Telefonica".
    Returns: Trust Score 0-100, BORME acts count, LEI, Wikidata QID, jurisdiction.

    Example: entity_lookup("Telefonica")

    Args:
        query: Company name (Telefonica), CIF (A28015865), EU VAT (ESA28015865), or LEI (20 chars)
    """
    return _get(f"/v1/profile/{query}")


@mcp.tool()
def search_entities(
    q: str,
    country: str = "ES",
    sector: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = 10,
) -> dict[str, Any]:
    """Browse the entity registry by name, sector, or city.

    Use when: user asks "find me a dentist in Madrid", "list lawyers in Barcelona",
              "show me car repair shops in Valencia".
    Returns: Verified entities with name, phone, website, address, sector.

    Example: search_entities(q="dental", city="Madrid", limit=5)

    Args:
        q: Search query — company name or keyword (dental, abogado, taller...)
        country: ISO country code (ES, GB, FR, DE, ...). Default: ES
        sector: Sector slug (dental, legal, reformas, estetica, veterinarios, asesorias...)
        city: City name (Madrid, Barcelona, Valencia, Sevilla...)
        limit: Max results 1-50. Default: 10
    """
    params: dict[str, Any] = {"q": q, "country": country, "limit": min(int(limit), 50)}
    if sector:
        params["sector"] = sector
    if city:
        params["city"] = city
    return _get("/v1/search", params)


@mcp.tool()
def borme_lookup(query: str) -> dict[str, Any]:
    """Spanish mercantile acts from BORME (40M+ acts, 2009-2026).

    Use when: user asks "who founded X?", "when was X incorporated?",
              "directors of Santander", "corporate history of Inditex".
    Returns: Acts count, key officers, founding date, corporate events.

    Examples:
      borme_lookup("Telefonica")   → 17,320 acts
      borme_lookup("A28015865")    → Telefonica by CIF
      borme_lookup("Santander")    → 50,722 acts

    Args:
        query: Company name or Spanish CIF (without ES prefix, e.g. A28015865)
    """
    result = _get(f"/v1/profile/{query}", {"country": "ES"})
    borme = result.get("borme", {})
    return {
        "found": result.get("found", False),
        "entity": result.get("entity", {}),
        "borme": borme,
        "borme_acts_count": borme.get("acts_count", 0),
        "officers": borme.get("officers", []),
        "founding_date": borme.get("founding_date"),
        "trust_score": result.get("trust_score", {}),
    }


@mcp.tool()
def verify_vat(vat_id: str) -> dict[str, Any]:
    """Verify an EU VAT number via VIES (live, 27 member states, sub-second).

    Use when: user asks "is this VAT valid?", "verify ESA28015865",
              "is this EU company registered?".
    Returns: valid (bool), legal name, registered address, country.

    Examples:
      verify_vat("ESA28015865")    → Telefonica SA — valid
      verify_vat("FR12345678901") → French company VAT check

    Args:
        vat_id: Full EU VAT with country prefix (ESA28015865, FR12345678901, DE123456789)
    """
    return _get(f"/v1/verify/vat/{vat_id}")


@mcp.tool()
def zone_profile(postal_code: str) -> dict[str, Any]:
    """Spanish socioeconomic data by postal code (INE/SEPE/AEAT/MITMA/MITECO).

    Use when: user asks "what's the income level in 28001?",
              "unemployment rate in this area", "demographics of 08001 Barcelona".
    Returns: Median income (AEAT), unemployment (SEPE), population (INE),
             property price €/m² (MITMA), broadband coverage (MITECO).

    Examples:
      zone_profile("28001")   → Madrid Salamanca: income €99K, FTTH 99%
      zone_profile("08001")   → Barcelona Eixample
      zone_profile("41001")   → Sevilla Centro

    Args:
        postal_code: Spanish 5-digit postal code (28001, 08001, 41001...)
    """
    return _mcp_call("zone_profile", {"postal_code": postal_code})


@mcp.tool()
def get_competitors(
    sector: str,
    city: str,
    country: str = "ES",
    limit: int = 10,
) -> dict[str, Any]:
    """Find competitors in the same sector and city.

    Use when: user asks "who are the competitors?", "other dental clinics in Madrid",
              "similar businesses in Barcelona".
    Returns: Verified competitors with name, phone, website, address.

    Examples:
      get_competitors("dental", "Madrid")
      get_competitors("legal", "Barcelona", limit=5)

    Args:
        sector: Sector slug (dental, legal, reformas, estetica, veterinarios, asesorias,
                talleres, inmobiliarias, restaurantes, psicologia, gimnasios...)
        city: City name (Madrid, Barcelona, Valencia, Sevilla, Zaragoza...)
        country: ISO country code. Default: ES
        limit: Max results 1-50. Default: 10
    """
    params: dict[str, Any] = {
        "sector": sector,
        "city": city,
        "country": country,
        "limit": min(int(limit), 50),
    }
    result = _get("/v1/search", params)
    return {
        "sector": sector,
        "city": city,
        "country": country,
        "count": result.get("count", 0),
        "competitors": result.get("entities", []),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """Run MCP server on stdio (default transport for MCP clients)."""
    mcp.run()


if __name__ == "__main__":
    main()
