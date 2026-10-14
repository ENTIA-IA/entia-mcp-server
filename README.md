# ENTIA MCP Server

**Structured business intelligence for AI agents.**

ENTIA gives AI agents verified business identity data from official public registries — accessible via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) or REST API.

| Metric | Value |
|---|---|
| Verified entities | 11,330,391 |
| BORME mercantile acts | 40.3M |
| Active sources | 16 |
| MCP tools | 12 |

<sub>Figures from live `get_platform_stats` and `tools/list` at https://mcp.entia.systems/mcp (2026-10-14).</sub>

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

A Python client lives in this repo under `entia_mcp/` (wraps a subset of tools as convenience methods). The full 12-tool surface is always available via the hosted endpoint (Option 1). A published PyPI package is planned.

## 12 MCP Tools

| Tool | What it does |
|---|---|
| `entity_lookup` | Verify identity of any business by name, CIF/NIF, EU VAT or LEI. Cross-checks BORME, VIES, GLEIF. |
| `search_entities` | Search verified entities by name, keyword, country, city or sector. |
| `verify_vat` | Real-time EU VAT validation via VIES (27 member states). |
| `zone_profile` | Spanish socioeconomic profile by postal code (INE/SEPE/AEAT): income, employment, business density. |
| `get_competitors` | Real competitors in the same sector and geography. |
| `get_showcase` | Curated IBEX35 + EU showcase entities. Free, does not consume quota. |
| `professional_lookup` | Verify professional registrations across 24 Spanish health/legal/psychology verticals. Requires DPA (GDPR Art. 28). |
| `get_full_dossier` | Aggregator: 90+ fields about an entity in one call (combines 4 ENTIA sources). |
| `get_platform_stats` | Live platform stats: entities, sources. Free, does not consume quota. |
| `run_risk_audit` | AI-readiness + digital risk audit for any domain. |
| `get_entia_home` | Full Schema.org JSON-LD @graph for an entity (Entia Home). |
| `get_entity_home_projection` | Machine-readable projection of an Entia Home record (v1). |

## Try it free (no key)

`entity_lookup` works without an API key and returns a trace-level identity preview.
`get_showcase` and `get_platform_stats` do not consume quota.

## Pricing

Monthly subscription in EUR. **No overage on any plan:** when you reach your monthly
quota, requests are paused (HTTP 429) until the next billing month. Billing unit:
entity returned ("entidad consultada"), deduplicated per UTC calendar day.

| Plan | EUR / month | Entities / month |
|---|---|---|
| TRACE | Free | 100 (preview) |
| EDGE | 9.90 | 10,000 (edge-cached responses only) |
| SIGNAL | 29 | 500 |
| BUILD | 99 | 2,500 |
| INTEGRATE | 399 | 10,000 |
| OPERATE | 1,499 | 100,000 |
| SCALE | Custom, from 2,500 | 500,000+ |
| ENTERPRISE | Custom | — |

Human pricing: [entia.systems/pricing](https://entia.systems/pricing) ·
Machine-readable: [ai-pricing.json](https://entia.systems/.well-known/ai-pricing.json) ·
[/api/v1/mcp/plans](https://api.entia.systems/api/v1/mcp/plans)

**API/MCP access is not a data licence.** Plans cover per-lookup grounding only. AI training,
fine-tuning, dataset creation and bulk extraction require the separate
[ENTIA AI Training & Corpus License (ENTIA-LTC-1.0)](https://entia.systems/legal/en/ai-training-license).

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

**Code: MIT** (see [`LICENSE`](LICENSE)). This server is a thin MCP wrapper: it
speaks JSON-RPC and proxies to the ENTIA API. Keeping the wrapper open is
deliberate — it lets any client audit exactly what is sent and returned.

**Data: proprietary — MIT does not apply to it.** The verified-entity corpus
reached through this server is licensed separately and access is controlled by
API key. Use of the data is governed by the
[Data Licensing Framework](https://entia.systems/legal/data-licensing),
the [MCP Terms](https://entia.systems/legal/mcp-terms) and the
[Terms of Service](https://entia.systems/legal/terms), and is protected by the
sui generis database right (Directive 96/9/EC). Cloning this repository grants
no right whatsoever over the corpus.

<!-- last-synced: 2026-10-14 — tools/list (12 tools), get_platform_stats, ai-pricing.json v1.6.7, /api/v1/mcp/plans. -->
