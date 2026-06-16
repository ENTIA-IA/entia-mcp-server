# AGENTS.md

This repository publishes the public catalog/metadata for the ENTIA MCP server.

- **Hosted endpoint (production):** `https://mcp.entia.systems/mcp` (streamable-http). Connect with `npx mcp-remote https://mcp.entia.systems/mcp`.
- **Runtime stack:** Cloudflare (edge) + Hetzner (origin). No AWS, no GCP.
- **Source of truth:** the live `tools/list` and `get_platform_stats` of the hosted endpoint, plus `https://entia.systems/.well-known/mcp.json` / `ai-pricing.json`. Catalog files here (`server.json`, `glama.json`) must mirror those exactly — no inflated or marketing figures.
