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
import { checkRateLimit } from './rate_limiter.js';

/**
 * Wrap a tool handler with rate limiting + structured logging.
 * Rate limit checked BEFORE calling upstream — saves cost.
 */
function withLogging(
  toolName: string,
  requiresAuth: boolean,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
): (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return async (args) => {
    const client = getActiveClient();
    const clientName = client?.name || 'anonymous';

    // --- Rate limit check (per client, per tool) ---
    const rl = checkRateLimit(clientName, toolName);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.resetMs / 1000);
      logToolCall({
        tool: toolName,
        auth: requiresAuth && !!config.ENTIA_API_KEY,
        latency_ms: 0,
        status: 'error',
        error_type: 'rate_limited',
        query_hint: truncateForLog(args),
        client,
      });
      return {
        content: [{
          type: 'text' as const,
          text: `Rate limited: ${toolName} allows ${rl.limit} calls/min per client. Retry in ${retryAfterSec}s.`,
        }],
        isError: true,
      };
    }

    const start = performance.now();
    try {
      // 1+2+3+4+5: si la tool es cacheable, usamos withEdgeCache para servir desde KV edge a coste marginal ~0
      const execute = isEdgeCacheable(toolName)
        ? () => withEdgeCache(toolName, args, () => handler(args), 300)  // TTL default 5min; se puede overridear por tool
        : () => handler(args);

      const result = await execute();
      const latency = Math.round(performance.now() - start);
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
 * Edge KV cache general para tools (coste marginal ~0 vía binding nativo CF).
 * 
 * Respuesta a: "¿Es posible cachear TODO lo que se consulta de cualquier tool desde el edge?"
 * 
 * SÍ, en gran medida (60-85%+ del tráfico típico de verificación de entidades):
 * - Binding KV nativo en el Worker = hit en <10-50ms, coste marginal muy bajo (CF cobra poco por KV reads,
 *   y Workers para hits livianos son baratos/gratis en volumen).
 * - Solo pagas origen (Python/Hetzner/DuckDB/resolver) en MISS o revalidación.
 * - Ya lo hacemos para entity_lookup (bindings + mcp_entity_responses).
 * - Generalizado aquí + en Python vía mcp_tool_cache soberano.
 * 
 * Herramientas altamente cacheables: get_mcp_catalog, get_platform_stats, get_showcase,
 * entity_lookup (hot), zone_profile (CPs populares), ai_ready_profile (hot), verify_vat frecuente.
 * 
 * No todo: risk_audit (compute + fetches), borme full history (tamaño + updates), searches amplios.
 * 
 * Estrategia: TTL por tool + stale-while-revalidate + warmer para top queries.
 * Key = tool + sha1(args canónicos normalizados).
 * 
 * En producción: bind MCP_TOOL_CACHE (del namespace entia-mcp-tool-cache) en el worker TS.
 * (Ver setup_sovereign_kv_namespaces.sh y .env para crear y exportar el ID).

// Lista de tools que se cachean agresivamente en edge (1+2+3+4+5).
// Para estas, el wrapper withEdgeCache se usa para servir desde KV binding a coste marginal ~0.
const EDGE_CACHEABLE_TOOLS = new Set([
  'get_mcp_catalog',
  'get_platform_stats',
  'get_showcase',
  'entity_lookup',           // ya tenía lógica especial, pero se puede unificar
  'get_entia_home',          // para entidades hot/publicadas
  'search_entities',         // hot names/sector
  // zone_profile y ai_ready se cachean vía Python helpers + warmer
]);

function isEdgeCacheable(toolName: string): boolean {
  return EDGE_CACHEABLE_TOOLS.has(toolName);
}
 */
async function withEdgeCache<T>(
  toolName: string,
  args: Record<string, unknown>,
  handler: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  try {
    const env = (globalThis as any).env || {};
    const kv = env.MCP_TOOL_CACHE || (globalThis as any).MCP_TOOL_CACHE;

    // Genera args_key estable (simple sha1 de json sorted)
    const argsStr = JSON.stringify(args, Object.keys(args).sort() as any);
    const encoder = new TextEncoder();
    const data = encoder.encode(argsStr);
    // Simple hash para key (en prod usar crypto.subtle si disponible)
    let hash = 0;
    for (let i = 0; i < data.length; i++) hash = (hash * 31 + data[i]) >>> 0;
    const argsKey = `${toolName}:${hash.toString(16).slice(0,16)}`;

    if (kv) {
      const cached = await kv.get(`mcp_tool_cache::${argsKey}`, { type: 'json' });
      if (cached && typeof cached === 'object') {
        (cached as any)._meta = (cached as any)._meta || {};
        (cached as any)._meta.cache_status = 'edge_kv_hit';
        (cached as any)._meta.fast_path_used = true;
        (cached as any)._meta.via = 'mcp_tool_cache_edge';
        return cached as T;
      }
    }

    const result = await handler();

    // Populate (best effort)
    if (kv && result) {
      const toStore = { ...(result as any), _via: 'mcp_tool_cache_edge' };
      kv.put(`mcp_tool_cache::${argsKey}`, JSON.stringify(toStore), { expirationTtl: ttlSeconds }).catch(() => {});
    }

    return result;
  } catch (e) {
    // Degrade a handler normal
    return handler();
  }
}

/**
 * Create and configure the ENTIA MCP Server with all 6 tools.
 * Every tool call is wrapped with structured logging.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'entia-mcp-server',
    version: '1.0.5',
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
    // Support aliases query/name for client compatibility; use inner shape for registration (ZodEffects safe access)
    (EntityLookupSchema as any).shape || ((EntityLookupSchema as any)._def?.schema?.shape || {}),
    withLogging('entity_lookup', false, (args) =>
      isEdgeCacheable('entity_lookup')
        ? withEdgeCache('entity_lookup', args || {}, () => entityLookup(args as { q: string }), 300)
        : entityLookup(args as { q: string })
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
      isEdgeCacheable('get_entia_home')
        ? withEdgeCache('get_entia_home', args || {}, () => getEntiaHome(args as { country: string; sector: string; city: string; slug: string }), 1800)
        : getEntiaHome(args as { country: string; sector: string; city: string; slug: string })
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
    withLogging('get_platform_stats', false, (args) =>
      withEdgeCache('get_platform_stats', args || {}, () => getPlatformStats(), 600)
    ),
  );

  return server;
}
