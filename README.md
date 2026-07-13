# ENTIA MCP Server

**Structured business intelligence for AI agents.**

ENTIA provides verified entity data across 10 countries — accessible via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) or REST API.

| Metric | Value |
|---|---|
| Verified entities | 5,220,360 |
| Countries | 34 |
| BORME mercantile acts | 40.3M |
| Healthcare professionals | 570K+ |
| MCP tools | 13 |
| REST endpoints | 4 |

## Quick Start (< 2 minutes)

### Option 1: Remote MCP Server (recommended)

No installation needed. Connect your MCP client directly:

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "entia": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.entia.systems/mcp"]
    }
  }
}
```

**Cursor IDE** — add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "entia": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.entia.systems/mcp"]
    }
  }
}
```

Then try:
```
Look up Telefonica in Spain
```

### Option 2: REST API

```bash
# Search entities
curl "https://entia.systems/v1/search?q=telefonica&country=ES&limit=5" \
  -H "X-ENTIA-Key: YOUR_API_KEY"

# Full entity profile (BORME + GLEIF + VIES + Wikidata)
curl "https://entia.systems/v1/profile/Telefonica?country=ES"

# EU VAT verification
curl "https://entia.systems/v1/verify/vat/ESA28015865"

# Platform stats
curl "https://entia.systems/v1/stats"
```

### Option 3: Python client (in this repo)

A Python client lives in this repo under `entia_mcp/` (wraps a subset of tools as convenience methods). The full 13-tool surface is always available via the hosted endpoint (Option 1). A published PyPI package is planned.

## 13 MCP Tools

| Tool | What it does |
|---|---|
| `entity_lookup` | Verify identity of any business by name, CIF/NIF, EU VAT or LEI. Cross-checks BORME, VIES, GLEIF. |
| `search_entities` | Search verified entities across 10 countries by name, keyword, country, or sector. |
| `verify_vat` | Real-time EU VAT validation via VIES (27 member states). |
| `zone_profile` | Spanish socioeconomic profile by postal code (INE/SEPE/AEAT): income, employment, business density. |
| `ai_ready_profile` | Full AI-ready JSON-LD profile for an entity (4-node @graph). |
| `get_competitors` | Real competitors in the same sector and geography. |
| `get_showcase` | Curated IBEX35 + EU showcase entities. Free, does not consume quota. |
| `professional_lookup` | Verify professional registrations across 24 Spanish health/legal/psychology verticals. Requires DPA (GDPR Art. 28). |
| `get_full_dossier` | Aggregator: 90+ fields about an entity in one call (combines 4 ENTIA sources). |
| `get_platform_stats` | Live platform stats: entities, countries, sources. |
| `run_risk_audit` | AI-readiness + digital risk audit for any domain. |
| `get_entia_home` | Full Schema.org JSON-LD @graph for an entity (Entia Home). |
| `lookup_by_domain` | Look up a business entity by its website domain. Roadmap: coming in v1.2. |

## Pricing

Free tier: **100 requests/day** per IP, no signup. Authoritative pricing is published live at
[entia.systems/.well-known/ai-pricing.json](https://entia.systems/.well-known/ai-pricing.json).

| Tier | Price | Requests | Overage |
|---|---|---|---|
| TRACE | Free | 100/day | Hard block |
| SIGNAL | EUR 29/month | 500/month | Hard block |
| BUILD | EUR 99/month | 2,500/month | Hard block |
| INTEGRATE | EUR 399/month | 10,000/month | EUR 0.15/req |
| OPERATE | EUR 1,499/month | 100,000/month | EUR 0.10/req |
| SCALE | EUR 2,500+/month | 500,000/month | EUR 0.05/req (contact) |
| ENTERPRISE | Custom | Unlimited | — |

Get your API key: [entia.systems/mcp-setup](https://entia.systems/mcp-setup)

## Data Sources

All data comes from official public registries:

- **BORME** -- Spanish Mercantile Registry (BOE)
- **VIES** -- EU VAT validation (European Commission)
- **GLEIF** -- Legal Entity Identifiers (Global LEI Foundation)
- **Wikidata** -- Knowledge Graph (Wikimedia Foundation)
- **REPS** -- Spanish Healthcare Professionals Registry
- **INE** -- Spanish National Statistics Institute
- **SEPE** -- Spanish Employment Service
- **AEAT** -- Spanish Tax Authority
- **Companies House** -- UK company registry
- **Sirene/INSEE** -- French company registry

## Links

- [API Documentation](https://entia.systems/mcp-docs)
- [Get API Key](https://entia.systems/mcp-setup)
- [Setup Guide](https://entia.systems/mcp-setup)
- [Client Dashboard](https://entia.systems/mcp-dashboard)
- [Official MCP Registry](https://registry.modelcontextprotocol.io)

## About

Built by [PrecisionAI Marketing OU](https://entia.systems) (Estonia, EU).

- VAT: EE102780516
- DUNS: 565868914
- e-Residency certified
- eIDAS compliant

## License

Proprietary. See [Terms of Service](https://entia.systems/legal/terms).

<!-- last-synced: 2026-07-04 (re-index nudge; content authoritative at v4.1.0, 13 tools) -->
