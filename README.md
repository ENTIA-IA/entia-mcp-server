# ENTIA MCP Server

MCP Server for the [ENTIA](https://entia.systems) entity verification and trust infrastructure platform. Exposes 5.6M+ verified business entities across 34 countries to any MCP-compatible AI agent.

## Tools

| Tool | Auth | Description |
|------|------|-------------|
| `entity_lookup` | Public | Look up entity by name, CIF/NIF, EU VAT, or LEI |
| `get_entia_home` | Public | Get full JSON-LD @graph (4 nodes) for a verified entity |
| `search_entities` | API key | Search entities by name, country, sector |
| `lookup_by_domain` | API key | Look up entity by domain (v1.1 — stub) |
| `run_risk_audit` | API key | AI-readiness audit on any domain (0-100 score) |
| `get_platform_stats` | Public | Real-time platform statistics |

## Quick Start (Claude Code / stdio)

```bash
npm install
npm run build
```

Add to your Claude Code config (`~/.claude.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "entia": {
      "command": "node",
      "args": ["/path/to/entia-mcp-server/dist/index.js"],
      "env": {
        "ENTIA_API_KEY": "your_key_here"
      }
    }
  }
}
```

## HTTP Transport (Cloud Run)

```bash
npm run build
docker build -t entia-mcp-server .
docker run -p 3000:3000 -e ENTIA_API_KEY=xxx -e MCP_TRANSPORT=http entia-mcp-server
```

Health check: `GET /health`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENTIA_API_KEY` | For auth tools | — | ENTIA API key |
| `ENTIA_API_BASE` | No | `https://entia.systems` | API base URL |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `MCP_PORT` | No | `3000` | HTTP port |

## v1.1 Roadmap

- `lookup_by_domain`: Requires `/v1/entity?domain=` endpoint (pending API deploy)
- `get_entia_home`: Content negotiation (`Accept: application/ld+json`) for direct JSON-LD response
- Webhook subscriptions for entity change events

## License

Proprietary. PrecisionAI Marketing OU.
