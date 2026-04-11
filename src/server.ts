import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { entityLookup, EntityLookupSchema } from './tools/entity_lookup.js';
import { getEntiaHome, GetEntiaHomeSchema } from './tools/get_entia_home.js';
import { searchEntities, SearchEntitiesSchema } from './tools/search_entities.js';
import { lookupByDomain, LookupByDomainSchema } from './tools/lookup_by_domain.js';
import { runRiskAudit, RunRiskAuditSchema } from './tools/run_risk_audit.js';
import { getPlatformStats } from './tools/get_platform_stats.js';
import { logToolCall } from './logger.js';
import { config } from './config.js';
import { getActiveClient } from './session_store.js';

/**
 * Wrap a tool handler with structured logging.
 * Logs tool name, auth status, latency, and error type to Cloud Logging.
 */
function withLogging(
  toolName: string,
  requiresAuth: boolean,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
): (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return async (args) => {
    const start = performance.now();
    try {
      const result = await handler(args);
      const latency = Math.round(performance.now() - start);
      const client = getActiveClient();
      logToolCall({
        tool: toolName,
        auth: requiresAuth && !!config.ENTIA_API_KEY,
        latency_ms: latency,
        status: 'ok',
        query_hint: truncateForLog(args),
        client,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const latency = Math.round(performance.now() - start);
      const errorMsg = (err as Error).message;
      const client = getActiveClient();
      logToolCall({
        tool: toolName,
        auth: requiresAuth && !!config.ENTIA_API_KEY,
        latency_ms: latency,
        status: 'error',
        error_type: extractErrorType(errorMsg),
        query_hint: truncateForLog(args),
        client,
      });
      return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
    }
  };
}

/** Extract first meaningful arg value, truncated to 50 chars for log context. */
function truncateForLog(args: Record<string, unknown>): string {
  const val = args.q ?? args.domain ?? args.slug ?? '';
  const str = String(val);
  return str.length > 50 ? str.substring(0, 50) + '...' : str;
}

/** Classify error for aggregation in dashboards. */
function extractErrorType(msg: string): string {
  if (msg.includes('429') || msg.includes('Rate limited')) return 'rate_limited';
  if (msg.includes('401') || msg.includes('API_KEY')) return 'auth_error';
  if (msg.includes('404')) return 'not_found';
  if (msg.includes('timeout') || msg.includes('AbortError')) return 'timeout';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return 'upstream_error';
  return 'unknown';
}

/**
 * Create and configure the ENTIA MCP Server with all 6 tools.
 * Every tool call is wrapped with structured logging.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'entia-mcp-server',
    version: '1.0.4',
    icons: [
      {
        src: 'https://entia.systems/favicon-192x192.png',
        mimeType: 'image/png',
        sizes: ['192x192'],
      },
      {
        src: 'https://entia.systems/favicon-48x48.png',
        mimeType: 'image/png',
        sizes: ['48x48'],
      },
    ],
  });

  // --- Tool 1: entity_lookup (public, 10 req/min) ---
  server.tool(
    'entity_lookup',
    'Look up any business entity by name, CIF/NIF, EU VAT ID, or LEI code. ' +
    'Returns identity data, trust score (VERIFIED/PARTIAL/UNVERIFIED), and ' +
    'cross-verification against BORME, VIES, GLEIF, and OFAC. ' +
    'Covers 5.5M+ registered entities across 34 countries. ' +
    'Enrichment depth varies: ES has full socioeconomic data, GB/FR have name+address only. ' +
    'Check the data_coverage field in the response to see exactly what is populated. ' +
    'No API key required.',
    EntityLookupSchema.shape,
    withLogging('entity_lookup', false, (args) =>
      entityLookup(args as { q: string })
    ),
  );

  // --- Tool 2: get_entia_home (public) ---
  server.tool(
    'get_entia_home',
    'Retrieve the full Schema.org JSON-LD @graph for a registered entity\'s Entia Home page. ' +
    'Returns up to 4 nodes: (1) WebPage canonical metadata, (2) Entity identity with address, geo, ' +
    'identifiers, and official sources, (3) Verification Report with HMAC signature and ' +
    'per-source confidence levels, (4) Territorial socioeconomic profile (ES only: INE/SEPE/Hacienda). ' +
    'Not all entities have an Entia Home — only ~500K published pages exist. ' +
    'Use search_entities first if you do not know the exact path. No API key required.',
    GetEntiaHomeSchema.shape,
    withLogging('get_entia_home', false, (args) =>
      getEntiaHome(args as { country: string; sector: string; city: string; slug: string })
    ),
  );

  // --- Tool 3: search_entities (API key required, 10 req/min) ---
  server.tool(
    'search_entities',
    'Search 5.5M+ registered entities across 34 countries by name, keyword, country, or sector. ' +
    'Coverage varies by country: ES ~900K enriched with full contact and socioeconomic data, ' +
    'GB/FR name+address only, GLEIF countries name+LEI only. ' +
    'Check data_coverage in results to understand what fields are populated. ' +
    'Use this to find entities before calling get_entia_home. API key required.',
    SearchEntitiesSchema.shape,
    withLogging('search_entities', true, (args) =>
      searchEntities(args as { q: string; country?: string; sector?: string; limit: number })
    ),
  );

  // --- Tool 4: lookup_by_domain (stub — v1.1) ---
  server.tool(
    'lookup_by_domain',
    'Identify the business entity associated with a website domain. ' +
    'STATUS: Coming in v1.1 — currently returns 501. ' +
    'Workaround: use entity_lookup with company name, or search_entities with the domain.',
    LookupByDomainSchema.shape,
    withLogging('lookup_by_domain', true, (args) =>
      lookupByDomain(args as { domain: string })
    ),
  );

  // --- Tool 5: run_risk_audit (API key required, 5 req/min) ---
  server.tool(
    'run_risk_audit',
    'Run an AI-readiness and digital risk audit on any domain. Checks SSL, DNS, ' +
    'structured data presence, and LLM visibility signals. Returns a risk score 0-100 ' +
    '(lower is better, >60 means action recommended) with specific gaps identified. ' +
    'Slow operation (up to 30s). API key required. Rate limit: 5/min.',
    RunRiskAuditSchema.shape,
    withLogging('run_risk_audit', true, (args) =>
      runRiskAudit(args as { domain: string; sector_id?: string; name?: string })
    ),
  );

  // --- Tool 6: get_platform_stats (public) ---
  server.tool(
    'get_platform_stats',
    'Get real-time ENTIA platform statistics: total registered entities, country coverage, ' +
    'active data sources, and published Entia Homes. ' +
    'Note: total_entities is the full registry; only ~79K pass the Quality Gate for full publication. ' +
    'Cached 1h server-side. No API key required.',
    {},
    withLogging('get_platform_stats', false, () =>
      getPlatformStats()
    ),
  );

  return server;
}
