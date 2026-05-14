import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { entityLookup, EntityLookupSchema } from './tools/entity_lookup.js';
import { getEntiaHome, GetEntiaHomeSchema } from './tools/get_entia_home.js';
import { searchEntities, SearchEntitiesSchema } from './tools/search_entities.js';
import { lookupByDomain, LookupByDomainSchema } from './tools/lookup_by_domain.js';
import { runRiskAudit, RunRiskAuditSchema } from './tools/run_risk_audit.js';
import { getPlatformStats } from './tools/get_platform_stats.js';
// v1.0.6 — 7 tools added (Python ALB → REST /api/v1/v3/* → MCP TS thin proxy)
import { verifyVat, VerifyVatSchema } from './tools/verify_vat.js';
import { zoneProfile, ZoneProfileSchema } from './tools/zone_profile.js';
import { aiReadyProfile, AiReadyProfileSchema } from './tools/ai_ready_profile.js';
import { getCompetitors, GetCompetitorsSchema } from './tools/get_competitors.js';
import { bormeLookup, BormeLookupSchema } from './tools/borme_lookup.js';
import { getShowcase, GetShowcaseSchema } from './tools/get_showcase.js';
import { professionalLookup, ProfessionalLookupSchema } from './tools/professional_lookup.js';
// v1.0.7 — aggregator tool: 4 sources in parallel, 90+ fields in single response
import { getFullDossier, FullDossierSchema } from './tools/full_dossier.js';
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
      const result = await handler(args);
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
 * Create and configure the ENTIA MCP Server with all 6 tools.
 * Every tool call is wrapped with structured logging.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'entia-mcp-server',
    version: '1.0.6',
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

  // ═════════════════════════════════════════════════════════════════════
  // v1.0.6 — 7 new tools (proxies to api.entia.systems/api/v1/v3/*)
  // ═════════════════════════════════════════════════════════════════════

  // --- Tool 7: verify_vat (API key required) ---
  server.tool(
    'verify_vat',
    'Real-time EU VAT validation via VIES (27 countries). Accepts VAT number ' +
    'with country prefix (ESA28015865) or bare (A28015865). Returns {valid, ' +
    'name, address, country}. API key required.',
    VerifyVatSchema.shape,
    withLogging('verify_vat', true, (args) =>
      verifyVat(args as { q: string })
    ),
  );

  // --- Tool 8: zone_profile (API key required) ---
  server.tool(
    'zone_profile',
    'Socioeconomic profile of a Spanish postal code. Returns ~17 blocks: income ' +
    '(AEAT — Hacienda), employment (SEPE), demographics (INE Padrón), business ' +
    'census (DIRCE), real estate (€/m²), digital infrastructure (FTTH coverage), ' +
    'poverty/inequality (Gini, S80/S20), tourism demand (EOAC/EOAP). ' +
    'Spain only — UK/FR/etc. return empty. API key required.',
    ZoneProfileSchema.shape,
    withLogging('zone_profile', true, (args) =>
      zoneProfile(args as { postal_code: string })
    ),
  );

  // --- Tool 9: ai_ready_profile (API key required) ---
  server.tool(
    'ai_ready_profile',
    'Full AI-ready JSON-LD profile for any entity. 4-node @graph (Organization, ' +
    'Place, LocalBusiness, PostalAddress) with verification flags and territorial ' +
    'data. Designed for direct citation by AI agents. API key required.',
    AiReadyProfileSchema.shape,
    withLogging('ai_ready_profile', true, (args) =>
      aiReadyProfile(args as { query: string })
    ),
  );

  // --- Tool 10: get_competitors (API key required) ---
  server.tool(
    'get_competitors',
    'Find real competitors in the same sector and geography from the 5.2M ENTIA ' +
    'verified corpus. Returns ranked entities with identity, location, and sector ' +
    'matching. Use entia-competitive-analysis skill for workflow guidance. ' +
    'API key required.',
    GetCompetitorsSchema.shape,
    withLogging('get_competitors', true, (args) =>
      getCompetitors(args as { sector: string; city: string; limit: number })
    ),
  );

  // --- Tool 11: borme_lookup (API key required) ---
  server.tool(
    'borme_lookup',
    'Full BORME corporate history (Boletín Oficial del Registro Mercantil de ' +
    'España). Returns mercantile acts (constituciones, officer changes, capital ' +
    'changes, concursal proceedings), officers, capital, CNAE, objeto social. ' +
    'Coverage: 40,345,410 acts since 2009. Spain only. API key required.',
    BormeLookupSchema.shape,
    withLogging('borme_lookup', true, (args) =>
      bormeLookup(args as { company: string })
    ),
  );

  // --- Tool 12: get_showcase (public) ---
  server.tool(
    'get_showcase',
    'Curated IBEX35 + EU entity examples. FREE — does not consume quota. Use to ' +
    'explore data depth before purchasing higher tiers. No API key required.',
    {},
    withLogging('get_showcase', false, (args) =>
      getShowcase(args as Record<string, never>)
    ),
  );

  // --- Tool 13: professional_lookup (API key required) ---
  server.tool(
    'professional_lookup',
    'Verify professional registrations across 24 Spanish health/legal/psychology ' +
    'verticals: REPS healthcare, CGAE abogados, COP psicólogos, CGCFE ' +
    'fisioterapeutas, CGCL logopedas, CGCODN dietistas, CGCOP podólogos, ' +
    'CGCOO ópticos, OCV veterinarios, terapeutas ocupacionales (17 CCAA), ' +
    'guía dentistas. Returns colegiado number, college, specialty, status. ' +
    'API key required.',
    ProfessionalLookupSchema.shape,
    withLogging('professional_lookup', true, (args) =>
      professionalLookup(args as { query: string })
    ),
  );

  // --- Tool 14: get_full_dossier (API key required) — KILLER aggregator ---
  server.tool(
    'get_full_dossier',
    'Return a complete dossier on any company — 90+ fields aggregated from 4 ' +
    'ENTIA sources in parallel: entity_lookup (identity + trust score + GLEIF + ' +
    'Wikidata + BORME basic), zone_profile (30+ socioeconomic fields, ES only), ' +
    'borme_lookup (full BORME mercantile acts, ES only), verify_vat (VIES live, ' +
    'EU only). Use this for due diligence, KYB, or when the user asks for ' +
    '"everything about" a company. Single call replaces 4 separate tool calls. ' +
    'Typical latency 1-3s. API key required.',
    FullDossierSchema.shape,
    withLogging('get_full_dossier', true, (args) =>
      getFullDossier(args as { query: string })
    ),
  );

  return server;
}
