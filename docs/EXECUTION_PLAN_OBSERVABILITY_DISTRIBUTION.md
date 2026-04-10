# ENTIA MCP Server — Execution Plan: Observability + Distribution

> Date: 2026-04-10
> Status: LOGGING DEPLOYED (v1.0.2). Distribution PENDING.
> Owner: Fernando Vilches / PrecisionAI Marketing OU

---

## Current State (post v1.0.2)

| What | Status | Where |
|------|--------|-------|
| MCP Server live | OK | Cloud Run rev `entia-mcp-server-00003-b7d` |
| 6 tools working | OK | 4 functional + 1 stub + get_platform_stats |
| Structured logging | DEPLOYED | stderr → Cloud Logging (JSON structured) |
| Cloud Run request logs | FREE | GCP Console → Cloud Run → Logs |
| Observability dashboard | NOT BUILT | Need MC panel or standalone |
| Distribution channels | ZERO | Nobody knows this exists |
| Custom domain | NOT CONFIGURED | `mcp.entia.systems` CNAME pending |

---

## CAPA 1 — Logs de Cloud Run (DONE)

### What We Have Now

Every tool call produces 2 log entries in Cloud Logging:

**1. Upstream call (client.ts):**
```json
{
  "severity": "DEBUG",
  "message": "Upstream GET /api/v1/demo/lookup → 200 652ms",
  "method": "GET",
  "path": "/api/v1/demo/lookup",
  "status": 200,
  "latency_ms": 652,
  "auth": false,
  "rate_limited": false
}
```

**2. Tool call (server.ts):**
```json
{
  "severity": "INFO",
  "message": "MCP tool:entity_lookup ok 670ms",
  "tool": "entity_lookup",
  "auth": false,
  "latency_ms": 670,
  "status": "ok",
  "query_hint": "BBVA",
  "api_key_hash": "0fe25fbc"
}
```

### How to Query Logs Now

```bash
# All MCP tool calls in last hour
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="entia-mcp-server" AND jsonPayload.tool!=""' \
  --project=systems-ia-entia --limit=50 --format=json

# Only errors
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="entia-mcp-server" AND jsonPayload.status="error"' \
  --project=systems-ia-entia --limit=50

# Rate limited calls
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="entia-mcp-server" AND jsonPayload.rate_limited=true' \
  --project=systems-ia-entia --limit=50

# By specific tool
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="entia-mcp-server" AND jsonPayload.tool="run_risk_audit"' \
  --project=systems-ia-entia --limit=50
```

### What's Missing in Capa 1

- No BQ sink yet — logs expire after 30 days in Cloud Logging
- No alerting — if all calls start failing, nobody knows
- No dashboard — have to query manually

---

## CAPA 2 — BigQuery Sink + Dashboard (THIS WEEK)

### Step 2.1: Create BQ Log Sink

Route MCP Server logs to BigQuery for permanent storage and dashboarding.

```bash
# Create dataset
bq mk --dataset --location=EU systems-ia-entia:mcp_analytics

# Create log sink
gcloud logging sinks create mcp-tool-calls \
  bigquery.googleapis.com/projects/systems-ia-entia/datasets/mcp_analytics \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="entia-mcp-server" AND jsonPayload.tool!=""' \
  --project=systems-ia-entia
```

This creates a table `mcp_analytics.cloudrun_googleapis_com_stderr` with every tool call as a row. Schema auto-detected from structured JSON.

### Step 2.2: Create Summary View

```sql
CREATE OR REPLACE VIEW mcp_analytics.v_tool_calls_daily AS
SELECT
  DATE(timestamp) as date,
  JSON_VALUE(jsonPayload, '$.tool') as tool,
  JSON_VALUE(jsonPayload, '$.auth') as auth,
  JSON_VALUE(jsonPayload, '$.status') as status,
  COUNT(*) as calls,
  AVG(CAST(JSON_VALUE(jsonPayload, '$.latency_ms') AS INT64)) as avg_latency_ms,
  MAX(CAST(JSON_VALUE(jsonPayload, '$.latency_ms') AS INT64)) as max_latency_ms,
  COUNTIF(JSON_VALUE(jsonPayload, '$.status') = 'error') as errors,
  COUNTIF(JSON_VALUE(jsonPayload, '$.error_type') = 'rate_limited') as rate_limited,
FROM `systems-ia-entia.mcp_analytics.cloudrun_googleapis_com_stderr`
GROUP BY 1, 2, 3, 4
ORDER BY date DESC, calls DESC;
```

### Step 2.3: CEO Dashboard Panel (MC)

Add a new page `McpObservability.tsx` to the CEO Dashboard (`static/ceo_v2/`):

**KPI Strip:**
- Total tool calls (today / 7d / 30d)
- Unique API key hashes (= distinct clients)
- Error rate (%)
- Avg latency (ms)
- Most popular tool

**Charts:**
- Tool calls per hour (stacked bar by tool name)
- Latency distribution (histogram)
- Error rate trend (line chart)
- Tool popularity breakdown (pie chart)

**Live Feed:**
- Last 20 tool calls with tool, status, latency, timestamp
- Red highlight on errors

**Backend endpoint needed:**
```
GET /api/v1/dashboard/mcp-stats
  → Queries mcp_analytics.v_tool_calls_daily
  → Returns { today: {}, week: {}, month: {}, recent_calls: [] }
```

### Step 2.4: Alerting

Create Cloud Monitoring alert:

```bash
# Alert if error rate > 50% in 5 min window
gcloud monitoring policies create \
  --display-name="MCP Server Error Rate > 50%" \
  --condition-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="entia-mcp-server"' \
  --condition-threshold-value=0.5 \
  --notification-channels=email:fv@entia.systems
```

Simpler alternative: Add to existing `report-technical` Cloud Run Job that already emails every 2h. Add MCP stats section.

---

## CAPA 3 — Per-Client API Key Analytics (NEXT WEEK)

### Current: Single Key

All MCP calls use one shared `ENTIA_API_KEY`. The `api_key_hash` field in logs shows `0fe25fbc` for everything.

### Target: Per-Client Keys

When external clients connect:
1. Client signs up → gets unique API key tied to Stripe subscription
2. Client configures MCP Server with their key
3. Every tool call logs their key hash
4. Dashboard shows usage per client

### Implementation Plan

**In ENTIA API (api_gateway.py):**
- Create Firestore collection `api_keys` with: key_hash, client_email, plan, created_at, rate_limit
- Modify `core/auth.py` to validate against `api_keys` collection (not just single secret)
- Log key_hash on every request

**In MCP Server:**
- Already logs `api_key_hash` — no changes needed
- When client uses their own key, their hash appears in logs automatically

**In Dashboard:**
- Group tool calls by `api_key_hash`
- Show per-client: calls/day, tools used, error rate, last active

---

## CAPA 4 — Distribution Channels (THIS WEEK)

### Channel 1: Smithery.ai (10 minutes, no approval needed)

**What:** Community directory of MCP servers. Hundreds listed. Developers browse it.

**Action:**
1. Go to https://smithery.ai
2. Submit ENTIA MCP Server with:
   - Name: `entia-mcp-server`
   - Description: "Verify any business entity across 34 countries. 5.5M+ registered entities from official registries (BORME, Companies House, SIRENE, GLEIF). Returns Schema.org JSON-LD with trust scores."
   - URL: `https://entia-mcp-server-574503109832.europe-west1.run.app/mcp`
   - GitHub: `https://github.com/ENTIA-IA/entia-mcp-server` (make public first)
   - Tools: List all 6 with descriptions

**Prerequisite:** Make GitHub repo public. Currently private.

**Timeline:** Can do today. Fer needs to flip repo to public.

### Channel 2: Anthropic MCP Registry

**What:** Official directory at https://github.com/modelcontextprotocol/servers

**Action:**
1. Fork `modelcontextprotocol/servers`
2. Add entry in `servers.json` or relevant directory
3. Submit PR with:
   - Server name, description, URL
   - List of tools with schemas
   - Example usage
4. Wait for review (days to weeks)

**Timeline:** Submit PR this week. Approval timeline unknown.

### Channel 3: X / Twitter Developer Community

**What:** Developers building on Claude Managed Agents are active on X right now.

**Action:**
1. Post from @entia_systems (or Fer's account):
   - Screenshot of entity_lookup returning Telefonica with Trust Score 83
   - The JSON config to connect in 3 lines
   - #MCP #Claude #AI hashtags
   - Tag @AnthropicAI

**Content draft:**
```
We just shipped ENTIA MCP Server — any AI agent can now verify 
business entities across 34 countries in real-time.

5.5M+ entities from BORME, Companies House, SIRENE, GLEIF.
Trust scores, JSON-LD, risk audits.

Connect in 3 lines:
{
  "mcp_servers": [{
    "type": "url",
    "url": "https://entia-mcp-server-574503109832.europe-west1.run.app/mcp",
    "name": "entia"
  }]
}

#MCP #Claude #AI #EntityVerification
```

**Timeline:** Post this week after custom domain is live.

### Channel 4: README + Public Repo

**What:** First impression for any developer who finds the server.

**Current:** README exists but repo is private.

**Action:**
1. Make repo public
2. Add "MCP Compatible" badge to README
3. Add 3-line usage example at the top
4. Add link to `mcp.entia.systems` once CNAME is live

**Timeline:** After CNAME is configured.

### Channel 5: entia.systems/developers Page

**What:** ENTIA's own developer portal already exists at `/developers`.

**Action:**
- Add MCP Server section with: description, tools list, config JSON, link to GitHub repo
- This is the canonical reference for ENTIA's API and MCP offering

**Timeline:** Next update to public_html/developers.html.

---

## Execution Timeline

### Today (2026-04-10) — DONE
- [x] Structured logging deployed (v1.0.2)
- [x] Every tool call logged: tool, auth, latency, error_type
- [x] Every upstream call logged: method, path, status, latency
- [x] Security & Governance doc written

### This Week (2026-04-11 to 2026-04-14)
- [ ] **CNAME `mcp.entia.systems`** — Cloud Run domain mapping + DNS
- [ ] **BQ log sink** — Route MCP logs to `mcp_analytics` dataset
- [ ] **Summary view** — `v_tool_calls_daily` in BigQuery
- [ ] **Smithery.ai listing** — Make repo public + submit
- [ ] **MCP section in /developers** — HTML update

### Next Week (2026-04-15 to 2026-04-21)
- [ ] **MC Dashboard panel** — `McpObservability.tsx` with KPIs + charts
- [ ] **Dashboard endpoint** — `GET /api/v1/dashboard/mcp-stats`
- [ ] **Anthropic registry PR** — Submit to modelcontextprotocol/servers
- [ ] **X/Twitter announcement** — Post with real data screenshot
- [ ] **Alerting** — Error rate alert via Cloud Monitoring or report-technical

### Month 1 (2026-04-22 to 2026-05-10)
- [ ] **Per-client API keys** — Firestore `api_keys` collection, auth.py update
- [ ] **Per-client dashboard** — Usage grouped by key hash
- [ ] **v1.1 tools** — `lookup_by_domain` + content negotiation JSON-LD
- [ ] **Cloud Armor WAF** — DDoS protection on MCP endpoint

---

## Metrics That Matter

### Week 1 (baseline)
- Total tool calls (expect: single digits — only us testing)
- Uptime (should be 100%)
- Avg latency per tool

### Month 1 (after distribution)
- Tool calls from non-ENTIA API keys (= external clients)
- Unique API key hashes per day
- Most requested tool (signals product-market fit)
- Error rate trend

### Month 3 (product-market fit)
- Paying clients using MCP (Stripe plan with API key)
- Tool calls per client per day
- Which tools drive conversions (search → audit → subscribe)

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Nobody discovers the MCP Server | HIGH | HIGH | Smithery + Anthropic registry + X post |
| API key abuse / enumeration | MEDIUM | MEDIUM | Upstream rate limits + per-client keys in month 1 |
| Cloud Run cold starts (5-10s) | LOW | LOW | MCP clients handle latency. Consider min-instances=1 if traffic grows |
| Upstream ENTIA API down | LOW | HIGH | MCP Server returns clear errors. No silent failures. |
| Legal: exposing public registry data via MCP | LOW | LOW | Data is from public registries. GDPR-compliant (no PII beyond public records) |
