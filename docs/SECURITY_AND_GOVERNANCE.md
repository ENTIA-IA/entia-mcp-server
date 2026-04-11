# ENTIA MCP Server — Security & Governance Document

> Version: 1.0.6 | Date: 2026-04-11 (final session state)
> Service: `entia-mcp-server` | Cloud Run rev: `entia-mcp-server-00007-x7j`
> Domain: `mcp.entia.systems` (SSL live, CNAME → ghs.googlehosted.com)
> Author: PrecisionAI Marketing OU
> Related: `KERNEL_GOVERNANCE.md`, `SECURITY_AUDIT.md`, `SECRETS_INVENTORY.md`, `INFRASTRUCTURE_STATE.md`

---

## 1. Architecture & Attack Surface

### What the MCP Server Is

A **read-only proxy** that exposes 6 tools over the MCP protocol (JSON-RPC 2.0). It does NOT:
- Write to BigQuery, Firestore, or any database
- Create, modify, or delete entities
- Access admin endpoints or Kernel gates
- Store any persistent state (sessions are in-memory, max 100, TTL 30 min)
- Have direct access to GCP services (no service account keys)

All data flows through the existing ENTIA REST API:

```
External Agent → MCP Server (Cloud Run) → ENTIA API (Cloud Run) → BigQuery/Firestore
                  ↑ read-only proxy         ↑ auth + rate limits    ↑ production data
```

### Transport Security

| Transport | Protocol | Encryption | Use Case |
|-----------|----------|------------|----------|
| **stdio** | JSON-RPC over stdin/stdout | N/A (local process) | Claude Code on developer machine |
| **HTTP** | JSON-RPC over SSE (Server-Sent Events) | TLS 1.3 (Cloud Run managed) | Remote agents, Claude Managed Agents |

Cloud Run enforces HTTPS. No HTTP downgrade possible.

### Network Exposure

| Endpoint | Accessible From | Authentication |
|----------|-----------------|----------------|
| `/health` | Public internet | None (health check only) |
| `/mcp` | Public internet | MCP protocol (no auth on transport, auth on individual tools via ENTIA API key) |

The `/mcp` endpoint accepts any MCP client. Individual tools that require authentication validate via the upstream ENTIA API. Public tools (entity_lookup, get_entia_home, get_platform_stats) are rate-limited by the ENTIA API at the IP level.

---

## 2. Authentication Model

### Two-Layer Auth

```
Agent → MCP Server:  No auth on transport layer (MCP protocol standard)
MCP Server → ENTIA API:  x-entia-api-key header on every request
```

The MCP Server holds a single ENTIA API key (`ENTIA_API_KEY` env var) that authenticates it as a trusted client to the ENTIA API. This key is:
- Stored in GCP Secret Manager as `ENTIA_API_KEY`
- Mounted into Cloud Run via `--set-secrets` (not plain env var)
- Never exposed to external agents — agents see tool results, never the key
- Validated server-side by `core/auth.py` using `hmac.compare_digest()`

### Tool-Level Auth Requirements

| Tool | Auth Needed | ENTIA API Endpoint | Rate Limit (upstream) |
|------|-------------|-------------------|----------------------|
| `entity_lookup` | None | `GET /api/v1/demo/lookup` | 10 req/min/IP |
| `get_entia_home` | None | `GET /v1/identity/...` (HTML) | 60 req/min/IP |
| `search_entities` | API key | `GET /v1/search` | 10 req/min/IP |
| `lookup_by_domain` | N/A (stub) | N/A | N/A |
| `run_risk_audit` | API key | `POST /api/v1/audit` | 5 req/min/IP |
| `get_platform_stats` | None | `GET /api/v1/stats/live` | 60 req/min/IP |

### What Happens Without API Key

If `ENTIA_API_KEY` is not set:
- Public tools work normally
- Authenticated tools (`search_entities`, `run_risk_audit`) return an explicit error: "ENTIA_API_KEY required for this tool. Set the ENTIA_API_KEY env var."
- No silent fallback, no partial data, no degraded mode

---

## 3. Rate Limiting & Abuse Protection

### Upstream Rate Limits (enforced by ENTIA API)

All rate limits are enforced by `core/auth.py` on the main API gateway, NOT by the MCP Server itself. The MCP Server inherits whatever limits the ENTIA API enforces per IP or per API key.

| Tier | Endpoints | Limit | Enforcement |
|------|-----------|-------|-------------|
| demo | `/api/v1/demo/lookup` | 10 req/min/IP | IP-based |
| search | `/v1/search` | 10 req/min/IP | API key + IP |
| audit | `/api/v1/audit` | 5 req/min/IP | API key + IP |
| default | All other | 60 req/min/IP | IP-based |

### MCP Server Rate Limiting (v1.0.6 — IMPLEMENTED)

The MCP Server implements **per-client, per-tool rate limiting** in-memory via sliding window counters (`src/rate_limiter.ts`). Limits are enforced **before** calling the upstream API — rejected calls cost nothing.

| Tool | Limit per client | Window | Enforcement |
|------|-----------------|--------|-------------|
| `entity_lookup` | 10/min | 60s sliding | Pre-upstream |
| `get_entia_home` | 10/min | 60s sliding | Pre-upstream |
| `search_entities` | 10/min | 60s sliding | Pre-upstream |
| `run_risk_audit` | **3/min** | 60s sliding | Pre-upstream |
| `get_platform_stats` | 20/min | 60s sliding | Pre-upstream |
| `lookup_by_domain` | 10/min | 60s sliding | Pre-upstream |

**Client identification:** Rate limits are keyed by `client_name` from the MCP `initialize` handshake. Each client has independent limits — one client hitting their ceiling does not affect others.

**When exceeded:** Returns MCP error with message: `"Rate limited: {tool} allows {limit} calls/min per client. Retry in {N}s."` No upstream call is made.

**Cleanup:** Expired sliding windows are pruned every 5 minutes to prevent memory growth.

**Verified:** 12 rapid entity_lookup calls → calls 1-10 OK, calls 11-12 rejected with rate limit message.

### Client Identity Tracking (v1.0.5 — IMPLEMENTED)

Every MCP session logs the connecting client's identity via `clientInfo` from the MCP `initialize` handshake:

| Field | Source | Example | Logged as |
|-------|--------|---------|-----------|
| `client_name` | `params.clientInfo.name` | `claude-desktop`, `cursor-ide` | `client_name` |
| `client_version` | `params.clientInfo.version` | `4.6`, `0.45` | `client_version` |
| `session_id` | Transport-generated UUID (first 8 chars) | `a3ef5c09` | `session_id` |

**Storage:** `src/session_store.ts` — in-memory Map, cleaned up on session close/expiry.

**Log events:**
- `session_start`: logged on every `initialize` with full client identity
- Every `tool call`: tagged with `client_name`, `client_version`, `session_id`

**Dashboard visibility:** MC panel at `/mc/mcp` shows:
- "Clientes conectados" section with calls, sessions, latency, last seen per client
- Live feed entries show client name next to tool name
- "N clientes externos conectados" banner (green when external clients exist, amber when only internal)

### Abuse Scenarios & Mitigations

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Agent spams entity_lookup | **LOW** | 10/min per-client rate limit. Rejected before upstream call. |
| Multiple agents share IP | **LOW** | Rate limits are per `client_name`, not per IP. Independent limits. |
| Agent enumerate entities via search | LOW | API key required + 10/min limit + `per_page` capped at 50. |
| Agent DDoS run_risk_audit | **LOW** | 3/min per-client hard limit + 30s timeout. |
| Stolen API key used from MCP | MEDIUM | Key rotation via Secret Manager. `client_name` logged for attribution. |
| Session exhaustion (DoS) | **LOW** | MAX_SESSIONS=100, TTL 30min, oldest-idle eviction. |
| Large POST body (OOM) | **LOW** | 1MB body limit, 413 rejection. |
| Prompt injection via entity data | LOW | MCP Server returns raw JSON — does not execute instructions. |

### Cost Control

| Metric | Value |
|--------|-------|
| Cost per call | ~€0.00004 (Cloud Run 256MB, <1s) |
| Max calls per client per hour | 600 (entity_lookup at 10/min) |
| Max cost per client per hour | €0.024 |
| Max cost per client per day | €0.58 |
| Dashboard visibility | KPI "Coste" card shows estimated EUR in real-time |

---

## 4. Data Safety & Invariant D11 (Zero Fabrication)

### Data Flow Integrity

The MCP Server is a **passthrough** — it does not:
- Generate, modify, or enrich any entity data
- Add placeholder values for missing fields
- Fabricate ratings, reviews, scores, or any metric
- Cache responses (every call hits the live ENTIA API)

What the agent receives is exactly what the ENTIA API returns. If a field is NULL in BigQuery, it is NULL (or absent) in the MCP response.

### JSON-LD Extraction (get_entia_home)

The `get_entia_home` tool extracts JSON-LD from the HTML `<script type="application/ld+json">` tag. This is:
- Standard structured data extraction (same method used by Google, Bing, LLMs)
- No modification of the JSON-LD content
- If no JSON-LD tag exists, returns `null` with an explicit note

### Data Coverage Transparency

All tool descriptions explicitly state coverage limitations:
- "5.5M+ **registered** entities" (not "verified")
- "Coverage varies by country: ES ~900K enriched, GB/FR name+address only"
- "Check data_coverage field in response"
- "Only ~79K pass Quality Gate for full publication"

This complies with D11 (zero fabrication) applied to metadata and documentation.

---

## 5. Secrets Management

### Secrets in This Service

| Secret | Source | Mount Method | Used By |
|--------|--------|-------------|---------|
| `ENTIA_API_KEY` | GCP Secret Manager | `--set-secrets` (Cloud Run) | `client.ts` — all authenticated API calls |

### Secrets NOT in This Service

The MCP Server does NOT have access to:
- Stripe keys (billing is handled by the main API)
- SMTP credentials (email is handled by the main API)
- Database credentials (no direct BQ/Firestore access)
- AI/LLM keys (no direct LLM calls — the audit tool delegates to the main API)
- Signing keys (HMAC signatures are generated by the main API)

This is by design. The MCP Server's blast radius is limited to read-only API access.

### Secret Rotation

If the `ENTIA_API_KEY` is compromised:
1. Rotate the secret in GCP Secret Manager: `gcloud secrets versions add ENTIA_API_KEY --data-file=-`
2. Redeploy MCP Server (picks up new secret automatically via `--set-secrets`)
3. No client-facing changes needed — external agents don't see or use this key

---

## 6. Governance Kernel Integration

### Sacred Map Classification

| File | Classification | Rationale |
|------|---------------|-----------|
| `src/server.ts` | **RESTRICTED** | Tool descriptions define the public contract — changes affect agent behavior |
| `src/client.ts` | **RESTRICTED** | Auth header and API routing — wrong header breaks all authenticated tools |
| `src/config.ts` | RESTRICTED | Environment variable handling |
| `src/tools/*.ts` | FREE | Individual tool implementations — isolated, testable |
| `src/types/*.ts` | FREE | Type definitions only |
| `Dockerfile` | **RESTRICTED** | Build + deploy definition |
| `package.json` | RESTRICTED | Dependency versions |

### State Machine

The MCP Server does NOT participate in the entity state machine. It only reads entities that are already in states CERTIFIED, PUBLISHED, or INDEXED. It cannot transition any entity to any state.

### Gates

No Kernel gates fire during MCP Server requests:
- **pre_change_gate**: Not triggered (MCP Server doesn't modify files)
- **pre_pipeline_gate**: Not triggered (MCP Server doesn't ingest entities)
- **pre_publish_gate**: Not triggered (MCP Server doesn't publish entities)
- **pre_index_gate**: Not triggered (MCP Server doesn't index entities)

The MCP Server is a **consumer** of the pipeline output, not a participant.

### Invariants Relevant to MCP

| Invariant | Applies | How |
|-----------|---------|-----|
| D2 (No fix without proof) | YES | Any change to tool descriptions or client logic must be verified with a real API call before deploy |
| D11 (Zero fabrication) | YES | Tool descriptions must accurately represent data coverage. No "5.5M verified" if only 79K are publish-ready |
| D12 (No local execution) | YES | MCP Server runs on Cloud Run, not locally. stdio mode is for development only |
| D14 (Pipeline-to-frontend verification) | PARTIAL | MCP tool responses should be verified end-to-end: BQ → API → MCP → agent output |

---

## 7. Cloud Run Deployment

### Security Hardening (v1.0.4 — 2026-04-10)

| Protection | Implementation | File |
|---|---|---|
| **Session exhaustion** | MAX_SESSIONS=100, TTL 30min, cleanup sweep 60s, oldest-idle eviction | index.ts |
| **Body size limit** | 1MB max POST body, 413 rejection | index.ts |
| **Path traversal** | Zod regex `/^[a-z0-9-]+$/` on sector, city, slug | get_entia_home.ts |
| **Error sanitization** | Truncate 200 chars, strip API keys/Bearer/sk-* | client.ts |
| **Health info leak** | Session count removed from /health | index.ts |
| **Input length** | max 500 chars on queries, max 253 on domains | entity_lookup.ts, run_risk_audit.ts |
| **Domain validation** | RFC-compliant regex on domain field | run_risk_audit.ts |
| **Graceful shutdown** | SIGTERM/SIGINT → drain sessions → exit | index.ts |

### Service Configuration

| Parameter | Value |
|-----------|-------|
| **Service name** | `entia-mcp-server` |
| **Region** | `europe-west1` (same as all ENTIA services) |
| **Image** | `gcr.io/systems-ia-entia/entia-mcp-server:v1.0.6` |
| **Port** | 3000 |
| **Memory** | 256Mi |
| **CPU** | 1 |
| **Min instances** | 0 (cold start OK — MCP clients handle latency) |
| **Max instances** | 5 |
| **Auth** | `--allow-unauthenticated` (MCP protocol requires open HTTP) |
| **Secrets** | `ENTIA_API_KEY=ENTIA_API_KEY:latest` (mounted from Secret Manager) |
| **Env vars** | `MCP_TRANSPORT=http`, `MCP_PORT=3000` |

### Service URLs

```
Custom domain:  https://mcp.entia.systems/mcp          ← PRIMARY
Health:         https://mcp.entia.systems/health
Direct:         https://entia-mcp-server-574503109832.europe-west1.run.app/mcp
DNS:            mcp.entia.systems CNAME ghs.googlehosted.com (TTL 3600)
SSL:            Google-managed, auto-renewal
```

### Relationship to Other Cloud Run Services

| Service | Purpose | Interaction with MCP |
|---------|---------|---------------------|
| `entia-api-gateway` | Main API (FastAPI, Python) | **MCP Server calls this** — all 6 tools proxy to this |
| `entia-api-gateway-dev-lane` | Dev version | Not used by MCP Server |
| `entia-client-dashboard` | CEO Dashboard (Next.js) | No interaction |
| `entia-ia-score-v5` | Legacy risk scoring | No interaction |

---

## 8. Incident Response

### If the MCP Server Goes Down

Impact: External agents lose access to ENTIA tools. No data loss. No pipeline impact.

Recovery:
1. Check Cloud Run logs: `gcloud run services logs read entia-mcp-server --region=europe-west1`
2. Check health: `curl https://entia-mcp-server-574503109832.europe-west1.run.app/health`
3. If unhealthy, redeploy: `gcloud run deploy entia-mcp-server --image gcr.io/systems-ia-entia/entia-mcp-server:v1.0.1 --region europe-west1`
4. Verify: MCP initialize handshake over HTTP

### If the ENTIA API Key is Compromised

1. Rotate immediately: `echo "new_key" | gcloud secrets versions add ENTIA_API_KEY --data-file=-`
2. Redeploy MCP Server (auto-picks new secret)
3. Audit ENTIA API logs for unauthorized access patterns
4. No external agent credentials need to change (they don't see the key)

### If an Agent Abuses the MCP Server

1. Identify IP from Cloud Run logs
2. Rate limits are enforced upstream — no action needed on MCP Server
3. If persistent, add IP to Cloud Armor deny list (requires Cloud Armor setup — v1.1)

---

## 9. v1.1 Security Roadmap

| Item | Priority | Description |
|------|----------|-------------|
| Custom domain + CNAME | HIGH | `mcp.entia.systems` via Cloud Run domain mapping |
| Per-client API keys | HIGH | Each MCP client gets own key tied to Stripe plan. Track usage per client. |
| MCP-level rate limiting | MEDIUM | Redis-based limiter in the MCP Server itself, independent of upstream |
| Cloud Armor WAF | MEDIUM | DDoS protection and IP-based blocking on Cloud Run |
| Content negotiation | LOW | `Accept: application/ld+json` on `/v1/identity/` to avoid HTML parsing |
| `/v1/entity?domain=` | LOW | New endpoint for `lookup_by_domain` tool |
| Audit logging | MEDIUM | Log every tool call to BigQuery `mcp_access_log` table |
| Input sanitization | LOW | Validate tool inputs beyond Zod schema (e.g., domain format, SQL injection in search queries) |

---

## 10. Compliance

### GDPR (EU 2016/679)

- MCP Server does NOT store personal data
- MCP Server does NOT process personal data — it proxies public registry data
- Entity data served is from official public registries (BORME, Companies House, SIRENE, GLEIF)
- IP addresses are logged by Cloud Run (GCP standard) — covered by GCP DPA

### eIDAS (EU 910/2014)

- HMAC-SHA256 signatures on entity data are generated by the main API, not the MCP Server
- MCP Server serves signed data as-is — does not modify signatures
- The `legal_framework` field in entity_lookup responses declares eIDAS compliance

### EU AI Act (2024/1689)

- MCP Server is an **API interface**, not an AI system
- It does not make automated decisions about entities
- Tool descriptions transparently declare data coverage limitations
- No opacity risk — agents receive exactly what the database contains

---

## Appendix A: Full Service Inventory (ENTIA Platform)

### Cloud Run Services (5 total, post-MCP)

| # | Service | Image | Region | Purpose |
|---|---------|-------|--------|---------|
| 1 | `entia-api-gateway` | `gcr.io/systems-ia-entia/entia-api-gateway:*` | europe-west1 | Main API (FastAPI). 97 endpoints. Auth + rate limiting |
| 2 | `entia-api-gateway-dev-lane` | same, dev tag | europe-west1 | Dev version with lax rules |
| 3 | `entia-api-gateway-dev-audit` | same, audit tag | europe-west1 | Audit-specific dev version |
| 4 | `entia-client-dashboard` | `gcr.io/systems-ia-entia/entia-client-dashboard:*` | europe-west1 | CEO Dashboard (Next.js + Supabase) |
| 5 | **`entia-mcp-server`** | `gcr.io/systems-ia-entia/entia-mcp-server:v1.0.1` | europe-west1 | **MCP Server (Node.js). 6 tools. Read-only proxy** |

### Cloud Run Jobs (12)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `batch-publisher` | On-demand | Mass Entia Home generation |
| `heartbeat` | Daily 00:00 | Health monitoring + backup |
| `overlord-sync` | Daily 06:00 | BQ → Firestore sync |
| `llm-citation-monitor` | */15 min | LLM probing (6 models) |
| `report-technical` | */2h | Technical status email |
| `report-roi` | */4h | ROI + Stripe + GA4 email |
| `public-api-harvester` | Daily 03:00 | 21+ public APIs harvest |
| `harvester-fr-scale` | Daily 05:00 | France (Sirene + INPI) |
| `harvester-gb-bulk` | Daily 02:00 | UK Companies House bulk |
| `harvester-native-apis` | Daily 04:00 | Nordic APIs (Brreg, CVR, PRH) |
| `enrich-jsonld` | On-demand | JSON-LD enrichment |
| `llm-monitor-test` | Daily 12:00 | LLM monitor test run |

### Cloud Scheduler (10)

| Job | Frequency | Status |
|-----|-----------|--------|
| `llm-monitor-scheduler` | */15 min (Madrid) | ENABLED |
| `llm-probing-pulse-scheduler` | */15 min (Madrid) | ENABLED |
| `llm-probing-core-scheduler` | 4x/day (Madrid) | ENABLED |
| `llm-probing-full-scheduler` | Weekly Sun 23:00 (Madrid) | ENABLED |
| `entity-cache-scheduler` | Daily 04:30 (Madrid) | ENABLED |
| `report-technical-scheduler` | */15 min (Madrid) | ENABLED |
| `report-roi-scheduler` | 2x/hour (Madrid) | ENABLED |
| `email-queue-processor` | */5 min (UTC) | PAUSED |
| `infra-health-check` | Daily 08:00 (Madrid) | ENABLED |
| `cp-anchor-pipeline` | Weekly Sun 02:00 (Madrid) | ENABLED |

### GCP Secrets (55 total, 42 active)

Categories: AI/LLM (9), Payment (4), SMTP (12), Auth/Signing (7), Infrastructure (7), Data Sources (4), Dashboard (3).

See `docs/SECRETS_INVENTORY.md` for full inventory.

---

## Appendix B: Deploy Checklist (MCP Server)

Before any deploy to production:

- [ ] `npx tsc` — 0 errors
- [ ] stdio test: `tools/list` returns 6 tools
- [ ] stdio test: `entity_lookup("Telefonica")` returns real data
- [ ] Rate limit test: 12 rapid calls → calls 11-12 rejected
- [ ] Tool descriptions use "registered" (never "verified" for total count)
- [ ] Client identity visible in logs: `client_name`, `session_id`
- [ ] No secrets in source code (grep for API keys, tokens)
- [ ] `.gitignore` excludes `.env`, `dist/`, `node_modules/`
- [ ] Cloud Build: `gcloud builds submit --tag gcr.io/systems-ia-entia/entia-mcp-server:vX.Y.Z`
- [ ] Cloud Run deploy with `--set-secrets` (not `--set-env-vars` for API key)
- [ ] Health check: `curl .../health` returns `{"status":"ok"}`
- [ ] MCP handshake: POST `/mcp` with SSE headers returns server info
- [ ] Commit + push to `ENTIA-IA/entia-mcp-server`
