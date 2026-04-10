import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { entityLookup, EntityLookupSchema } from './tools/entity_lookup.js';
import { getEntiaHome, GetEntiaHomeSchema } from './tools/get_entia_home.js';
import { searchEntities, SearchEntitiesSchema } from './tools/search_entities.js';
import { lookupByDomain, LookupByDomainSchema } from './tools/lookup_by_domain.js';
import { runRiskAudit, RunRiskAuditSchema } from './tools/run_risk_audit.js';
import { getPlatformStats } from './tools/get_platform_stats.js';

/**
 * Create and configure the ENTIA MCP Server with all 6 tools.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'entia-mcp-server',
    version: '1.0.0',
  });

  // --- Tool 1: entity_lookup (public, 10 req/min) ---
  server.tool(
    'entity_lookup',
    'Look up any business entity by name, CIF/NIF, EU VAT ID, or LEI code. ' +
    'Returns verified identity, trust score (VERIFIED/PARTIAL/UNVERIFIED), and ' +
    'cross-verification against BORME, VIES, GLEIF, and OFAC. ' +
    'Covers 5.5M+ entities across 34 countries. No API key required.',
    EntityLookupSchema.shape,
    async (args) => {
      try {
        const result = await entityLookup(args as { q: string });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- Tool 2: get_entia_home (public) ---
  server.tool(
    'get_entia_home',
    'Retrieve the full Schema.org JSON-LD @graph for a verified entity. ' +
    'Returns 4 nodes: (1) WebPage canonical metadata, (2) Entity identity with address, geo, ' +
    'identifiers, and official sources, (3) Verification Report with HMAC signature and ' +
    'per-source confidence levels, (4) Territorial socioeconomic profile. ' +
    'Use search_entities first if you do not know the exact path. No API key required.',
    GetEntiaHomeSchema.shape,
    async (args) => {
      try {
        const result = await getEntiaHome(args as { country: string; sector: string; city: string; slug: string });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- Tool 3: search_entities (API key required, 10 req/min) ---
  server.tool(
    'search_entities',
    'Search 5.5M+ verified entities across 34 countries by name, keyword, country, or sector. ' +
    'Returns matching entities with trust badges and Entia Home URLs. ' +
    'Use this to find entities before calling get_entia_home. API key required.',
    SearchEntitiesSchema.shape,
    async (args) => {
      try {
        const result = await searchEntities(args as { q: string; country?: string; sector?: string; limit: number });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- Tool 4: lookup_by_domain (stub — v1.1) ---
  server.tool(
    'lookup_by_domain',
    'Identify the business entity associated with a website domain. ' +
    'STATUS: Coming in v1.1 — currently returns 501. ' +
    'Workaround: use entity_lookup with company name, or search_entities with the domain.',
    LookupByDomainSchema.shape,
    async (args) => {
      const result = await lookupByDomain(args as { domain: string });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: true };
    }
  );

  // --- Tool 5: run_risk_audit (API key required, 5 req/min) ---
  server.tool(
    'run_risk_audit',
    'Run an AI-readiness and digital risk audit on any domain. Checks SSL, DNS, ' +
    'structured data presence, and LLM visibility signals. Returns a risk score 0-100 ' +
    '(lower is better, >60 means action recommended) with specific gaps identified. ' +
    'Slow operation (up to 30s). API key required. Rate limit: 5/min.',
    RunRiskAuditSchema.shape,
    async (args) => {
      try {
        const result = await runRiskAudit(args as { domain: string; sector_id?: string; name?: string });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- Tool 6: get_platform_stats (public) ---
  server.tool(
    'get_platform_stats',
    'Get real-time ENTIA platform statistics: total verified entities, country coverage, ' +
    'active data sources, and published Entia Homes. Cached 1h server-side. No API key required.',
    {},
    async () => {
      try {
        const result = await getPlatformStats();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}
