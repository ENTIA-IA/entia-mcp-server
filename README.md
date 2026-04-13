# ENTIA MCP Server

**Structured business intelligence for AI agents.**

ENTIA provides verified entity data across 34 countries — accessible via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) or REST API.

| Metric | Value |
|---|---|
| Verified entities | 5.5M+ |
| Countries | 34 |
| BORME mercantile acts | 40.3M |
| Healthcare professionals | 570K+ |
| MCP tools | 20 |
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
      "args": ["mcp-remote", "https://entia.systems/mcp/"]
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
      "args": ["mcp-remote", "https://entia.systems/mcp/"]
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

### Option 3: Python Client

```bash
pip install entia-mcp
```

```python
from entia_mcp import EntiaClient

client = EntiaClient(api_key="entia_live_...")

# Search
results = client.search("dental clinic", country="ES", limit=5)

# Profile
profile = client.profile("Telefonica", country="ES")
print(profile["trust_score"])  # {"score": 84, "badge": "PARTIAL"}

# VAT verification
vat = client.verify_vat("ESA28015865")
print(vat["valid"])  # True
```

### Option 4: LangChain Integration

```python
from entia_mcp.langchain import build_entia_tools

tools = build_entia_tools()
# Returns: [entia_search, entia_profile, entia_health]
# Ready for create_tool_calling_agent()
```

## 20 MCP Tools

| Tool | What it does |
|---|---|
| `entity_lookup` | Full entity dossier from 5.5M verified entities |
| `search_entities` | Browse registry by name, sector, city, country |
| `borme_lookup` | 40.3M Spanish mercantile acts (2009-2026) |
| `borme_new_constitutions` | Newly formed companies feed |
| `borme_officer_changes` | Director appointments/removals (KYC/KYB) |
| `verify_healthcare_professional` | 523K professionals (REPS) |
| `verify_dentist` | 44K colegiados (Consejo General Dentistas) |
| `verify_psychologist` | Colegiados (COP) |
| `search_regcess` | 120K healthcare centers |
| `verify_vat` | EU VAT via VIES (27 member states) |
| `zone_profile` | Socioeconomic data by postal code (INE/SEPE/AEAT) |
| `get_competitors` | Competitors in same sector and location |
| `municipality_profile` | Population + CNAE distribution |
| `get_platform_stats` | Registry size and data coverage |
| + 6 more | Healthcare, economic intelligence |

## Pricing

| Tier | Price | Requests | Overage |
|---|---|---|---|
| Free | EUR 0 | 20/day | Hard block |
| Pro | EUR 199/month | 1,000/month | EUR 0.15/req |
| Scale | EUR 990/month | 10,000/month | EUR 0.10/req |
| Enterprise | EUR 2,500/month | 100,000/month | EUR 0.05/req |

Get your API key: [entia.systems/get-started](https://entia.systems/get-started)

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
- [Get API Key](https://entia.systems/get-started)
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
