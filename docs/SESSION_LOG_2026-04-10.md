# ENTIA MCP Server — Session Log 2026-04-10

> From zero to production in one session.
> Final state: v1.0.4 live on `mcp.entia.systems` with SSL, 8 security fixes, structured logging.

---

## Timeline

| Time (UTC) | Action | Revision | Verification |
|---|---|---|---|
| 21:09 | Project scaffold: package.json, tsconfig, .gitignore | — | `npm install` 0 vulnerabilities |
| 21:12 | 6 tools + server.ts + index.ts compiled | — | `tsc` 0 errors |
| 21:13 | stdio test: entity_lookup | — | Telefonica SA, Trust Score 83, GLEIF ACTIVE |
| 21:13 | stdio test: get_platform_stats | — | 5,667,923 entities, 34 countries |
| 21:19 | **v1.0.0 deployed to Cloud Run** | 00001-5n2 | `curl /health` → OK |
| 21:20 | MCP handshake over HTTP verified | 00001 | SSE response with server info |
| 21:20 | GitHub repo created | — | `ENTIA-IA/entia-mcp-server` (private) |
| 21:25 | Fix: "verified" → "registered" in 4 tool descriptions | 00002-6r9 | tool descriptions checked via tools/list |
| 21:27 | README: data coverage note added | 00002 | — |
| 21:39 | Structured logging deployed (logger.ts) | 00003-b7d | `entity_lookup("BBVA")` → 2 log entries (upstream 652ms + tool 670ms) |
| 21:39 | Execution plan documented (4 capas + 5 channels) | — | Committed to docs/ |
| 22:05 | `mcp.entia.systems` domain mapping created | — | `CertificateProvisioned: True` |
| 22:13 | Fix: HTTP transport rewritten (per-session architecture) | 00004-rr5 | `initialize` → session ID → `tools/call` Inditex → full response |
| 22:42 | Security audit: 8 fixes + ENTIA icon | 00005-x8s | Path traversal blocked by Zod regex |
| 22:43 | **`mcp.entia.systems` SSL live** | 00005 | `curl https://mcp.entia.systems/health` → OK v1.0.4 |

---

## Commits (9 total)

| # | Hash | Message |
|---|---|---|
| 1 | `6d59ec8` | feat: ENTIA MCP Server v1.0.0 — 6 tools over public API |
| 2 | `b2a61d4` | fix: multi-stage Dockerfile — build TypeScript inside container |
| 3 | `2121e7f` | fix: "verified" → "registered" in all tool descriptions |
| 4 | `0f46517` | docs: Security & Governance document — full platform integration |
| 5 | `691b917` | feat: structured logging — every tool call and upstream request logged |
| 6 | `7082a91` | docs: Execution plan — observability (4 capas) + distribution (5 channels) |
| 7 | `4836a40` | fix: HTTP transport — per-session architecture for Claude.ai compatibility |
| 8 | `1b7ee33` | security: fix 1 CRITICAL + 2 HIGH + 3 MEDIUM + add ENTIA icon |

---

## Security Audit Results

| ID | Severity | Issue | Status |
|---|---|---|---|
| S1 | **CRITICAL** | Session memory exhaustion — no max sessions, no TTL, no cleanup | **FIXED** — MAX_SESSIONS=100, TTL 30min, cleanup sweep every 60s, oldest-idle eviction |
| S2 | **HIGH** | No request body size limit — OOM via large POST | **FIXED** — 1MB max, returns 413 |
| S3 | **HIGH** | Path traversal in get_entia_home — sector/city/slug unsanitized | **FIXED** — Zod regex `/^[a-z0-9-]+$/` on all path params |
| S4 | **MEDIUM** | Upstream error bodies forwarded to clients — potential API key leak | **FIXED** — truncate 200 chars + strip hex >20, Bearer tokens, sk-* keys |
| S5 | **MEDIUM** | Health endpoint leaks session count | **FIXED** — removed from /health response |
| S6 | **MEDIUM** | No CORS headers | **DEFERRED** — v1.1 (MCP clients don't use browser CORS) |
| S7 | **LOW** | Query hints in logs may contain business identifiers | **ACCEPTED** — truncated to 50 chars, documented |
| S8 | **LOW** | No max length on query strings | **FIXED** — max 500 chars on entity_lookup.q and search_entities.q |
| S9 | **LOW** | Domain field not validated | **FIXED** — regex + max 253 chars |
| B1 | **MEDIUM** | JSON-LD regex only extracts first block | **ACCEPTED** — ENTIA pages use single @graph block |
| B2 | **LOW** | Custom error classes never used | **ACCEPTED** — harmless, useful for v1.1 |
| B4 | **LOW** | No graceful shutdown | **FIXED** — SIGTERM/SIGINT handler drains sessions |
| P5 | **LOW** | Version mismatch package.json vs server.ts | **FIXED** — both 1.0.4 |

**Score: 8 fixed, 1 deferred, 3 accepted (low risk).**

---

## Architecture (Final)

```
Any MCP Client (Claude.ai, Claude Code, Managed Agents, custom)
        │
        │  MCP protocol (JSON-RPC 2.0 over Streamable HTTP)
        │  Session-based: POST init → session ID → POST/GET/DELETE
        ▼
mcp.entia.systems (Cloud Run, europe-west1)
  ├── index.ts     — HTTP server, session management, security limits
  ├── server.ts    — 6 tools registered with withLogging() wrapper
  ├── client.ts    — HTTP client to ENTIA API (error sanitization)
  ├── logger.ts    — Structured JSON logging → Cloud Logging
  └── tools/
      ├── entity_lookup.ts      (public, 10/min)
      ├── get_entia_home.ts     (public, JSON-LD from HTML)
      ├── search_entities.ts    (API key, 10/min)
      ├── lookup_by_domain.ts   (stub 501 — v1.1)
      ├── run_risk_audit.ts     (API key, 5/min, 30s timeout)
      └── get_platform_stats.ts (public, 1h cache)
        │
        │  REST HTTP (fetch, x-entia-api-key header)
        ▼
entia.systems API (Cloud Run, europe-west1)
  ├── /api/v1/demo/lookup
  ├── /v1/identity/{cc}/{sector}/{city}/{slug}
  ├── /v1/search
  ├── /api/v1/audit
  └── /api/v1/stats/live
```

### Security Limits

| Limit | Value | Purpose |
|---|---|---|
| MAX_SESSIONS | 100 | Prevent memory exhaustion |
| SESSION_TTL_MS | 30 min | Clean idle sessions |
| CLEANUP_INTERVAL_MS | 60s | Periodic sweep |
| MAX_BODY_BYTES | 1 MB | Prevent OOM via large POST |
| Path params | `/^[a-z0-9-]+$/` | Block path traversal |
| Query strings | max 500 chars | Prevent oversized queries |
| Domain field | regex + max 253 | RFC compliance |
| Error messages | max 200 chars + key stripping | Prevent upstream info leak |
| Graceful shutdown | SIGTERM/SIGINT handler | Clean drain on Cloud Run revision swap |

---

## Files (final count)

```
entia-mcp-server/          (13 source files, ~900 lines TypeScript)
├── src/
│   ├── index.ts           (168 lines) — HTTP server + session management + security
│   ├── server.ts          (127 lines) — 6 tools with withLogging() wrapper
│   ├── client.ts          (160 lines) — HTTP client + error sanitization
│   ├── config.ts          (12 lines)  — env vars
│   ├── logger.ts          (90 lines)  — Cloud Logging structured JSON
│   ├── tools/
│   │   ├── entity_lookup.ts      (22 lines)
│   │   ├── get_entia_home.ts     (44 lines)
│   │   ├── search_entities.ts    (33 lines)
│   │   ├── lookup_by_domain.ts   (26 lines)
│   │   ├── run_risk_audit.ts     (32 lines)
│   │   └── get_platform_stats.ts (11 lines)
│   └── types/
│       ├── entity.ts      (52 lines)
│       └── errors.ts      (25 lines)
├── docs/
│   ├── SECURITY_AND_GOVERNANCE.md           (390 lines)
│   ├── EXECUTION_PLAN_OBSERVABILITY_DISTRIBUTION.md  (350 lines)
│   └── SESSION_LOG_2026-04-10.md            (this file)
├── Dockerfile             (multi-stage: builder + production)
├── README.md              (with data coverage note)
├── package.json           (v1.0.4)
├── tsconfig.json
├── .env.example
└── .gitignore
```

---

## URLs (production)

| Purpose | URL |
|---|---|
| **MCP endpoint** | `https://mcp.entia.systems/mcp` |
| **Health check** | `https://mcp.entia.systems/health` |
| **MCP endpoint (direct)** | `https://entia-mcp-server-574503109832.europe-west1.run.app/mcp` |
| **GitHub** | `https://github.com/ENTIA-IA/entia-mcp-server` (private) |

### Agent Connection Config

```json
{
  "mcp_servers": [{
    "type": "url",
    "url": "https://mcp.entia.systems/mcp",
    "name": "entia"
  }]
}
```

---

## Verified Tool Responses (production data)

### entity_lookup("Telefonica")
- TELEFONICA SA, LEI 549300EEJH4FEPDBBR25
- Trust Score: 83, Badge: PARTIAL
- GLEIF: ACTIVE, Wikidata: Q160229
- Signature: HMAC-SHA256, cert CERT-9B5F486A6DD6

### entity_lookup("Inditex")
- INDITEX ASSETS LP, LEI 254900OCAS6YRHDIV992
- Trust Score: 83, Badge: PARTIAL
- GLEIF: ACTIVE, Wikidata: Q44504

### get_platform_stats
- 5,667,923 total entities
- 34 countries active
- 498,726 Entia Homes published
- ES: 1,582,658 entities (34 sectors)
- GB: 2,887,910 entities (26 sectors)

---

## Next Steps (documented in EXECUTION_PLAN)

| Priority | Task | Timeline |
|---|---|---|
| 1 | BQ log sink (`mcp_analytics` dataset) | This week |
| 2 | Smithery.ai listing (make repo public first) | This week |
| 3 | MC Dashboard panel (McpObservability.tsx) | Next week |
| 4 | Anthropic MCP registry PR | Next week |
| 5 | Per-client API keys (Firestore `api_keys`) | Month 1 |
| 6 | v1.1: `lookup_by_domain` + content negotiation | Month 1 |
