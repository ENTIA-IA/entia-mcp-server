import { z } from 'zod';
import { entiaClient } from '../client.js';
import type { EntityLookupResponse } from '../types/entity.js';

export const EntityLookupSchema = z.object({
  q: z.string().min(2).max(500).optional().describe(
    'Company name, CIF/NIF (e.g. B82846825), EU VAT ID (e.g. ESB82846825), or LEI code (20 chars). ' +
    'The API auto-detects the input type.'
  ),
  query: z.string().min(2).max(500).optional().describe('Alias for q — accepted for client compatibility (e.g. from MCP clients sending "query").'),
  name: z.string().min(2).max(500).optional().describe('Alias for q — company name.'),
}).transform((data) => ({
  q: data.q || data.query || data.name || '',
}));

export type EntityLookupArgs = z.infer<typeof EntityLookupSchema>;

/**
 * P0 + Caching multi-layer: Fast sovereign KV path + full MCP response cache.
 *
 * In CF Worker deployment (mcp.entia.systems), bind KV namespaces (via wrangler.toml or dashboard):
 *   ENTITIES_BY_CIF = { binding = "ENTITIES_BY_CIF" }
 *   ENTITIES_HOT = { binding = "ENTITIES_HOT" }
 *   MCP_ENTITY_RESPONSES = { binding = "MCP_ENTITY_RESPONSES" }   # NEW for complete shaped responses, TTL 300s
 *
 * CF primero: Workers dan parallelism gratis (cada request es instancia aislada, scale horizontal
 * sin coste extra). R2 en colo lógico eu (bucket entia-*-eu) para baja latencia con Hetzner EU.
 * Añade R2 binding aquí si el worker TS necesita acceso directo a parquet/homes (actualmente proxy a Python).
 *
 * This gives <100ms p95 for hot (CIF/name) + full entity_lookup shaped responses (kv_edge_hit).
 * Enables express tier (cheaper / SLA) vs full depth.
 */
export async function entityLookup(args: EntityLookupArgs): Promise<EntityLookupResponse> {
  const q = args.q || (args as any).query || (args as any).name || '';
  if (!q) throw new Error("q (or query/name) required");

  // === Multi-layer KV edge: full MCP-shaped response cache for hot entities (short TTL 300s + reval) ===
  // This is the true edge fast path (<100ms p95 for hot). Binding name recommended: MCP_ENTITY_RESPONSES
  // Keys match sovereign: mcp_entity_responses::cif:XXX or mcp_entity_responses::name:XX:NAME
  // On hit: return shaped response with _meta.cache_status=kv_edge_hit + fast_path_used.
  // Enables "express" tier pricing (cheaper than full depth resolver).
  try {
    const env = (globalThis as any).env || process.env || {};
    const kvMcp = env.MCP_ENTITY_RESPONSES || (globalThis as any).MCP_ENTITY_RESPONSES || env.ENTITIES_MCP_RESPONSES;
    if (kvMcp) {
      const normCif = q.replace(/^ES/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      let ckey = '';
      if (/^[A-Z0-9]{8,12}$/.test(normCif)) {
        ckey = `mcp_entity_responses::cif:${normCif}`;
      } else {
        const nname = q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64);
        ckey = `mcp_entity_responses::name:XX:${nname}`;
      }
      const val = await kvMcp.get(ckey, { type: 'json' });
      if (val && typeof val === 'object' && 'found' in (val as any)) {
        const v: any = val;
        v._via = v._via || 'kv_binding_mcp_entity_response';
        v._meta = v._meta || {};
        v._meta.cache_status = 'kv_edge_hit';
        v._meta.fast_path_used = true;
        v._meta.via = v._via;
        if (!v._meta.phase_timings) v._meta.phase_timings = { total_ms: 5, cached: true };
        return v as EntityLookupResponse;
      }
    }
  } catch (e) {
    // degrade
  }

  // === P0: Try native KV binding first (if deployed as CF Worker with bindings) ===
  try {
    const env = (globalThis as any).env || process.env || {};
    const kvByCif = env.ENTITIES_BY_CIF || (globalThis as any).ENTITIES_BY_CIF;
    const kvHot = env.ENTITIES_HOT || (globalThis as any).ENTITIES_HOT;

    const normCif = q.replace(/^ES/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (kvByCif && /^[A-Z0-9]{8,12}$/.test(normCif)) {
      const val = await kvByCif.get(`entities_by_cif::${normCif}`, { type: 'json' });
      if (val) {
        (val as any)._via = 'kv_binding_entities_by_cif';
        return val as EntityLookupResponse;
      }
    }

    // Hot name cache
    if (kvHot && q.length > 3) {
      const key = `XX::${q.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
      const val = await kvHot.get(`entities_hot::${key}`, { type: 'json' });
      if (val) {
        (val as any)._via = 'kv_binding_entities_hot';
        return val as EntityLookupResponse;
      }
    }
  } catch (e) {
    // KV binding not available or error — fall through to backend
  }

  // === Fallback: Python fast endpoint first (KV sovereign, no full DuckDB/BORME/VIES) ===
  // Then full /lookup only if miss. This avoids heavy backend for hot basic verification.
  try {
    const fast = await entiaClient.get<any>('/api/v1/demo/entity/fast', { q });
    if (fast && !fast.detail) {
      fast._via = fast._via || 'python_kv_fast';
      return fast as EntityLookupResponse;
    }
  } catch (e) {
    // 404 or error → fall to full
  }

  // === Full: Python backend (resolver + DuckDB + BORME/VIES etc) ===
  const fullResp = await entiaClient.get<EntityLookupResponse>(
    '/api/v1/demo/lookup',
    { q },
  );

  // Best-effort: populate the full MCP response cache binding from edge (write-through).
  // Next request for same hot q will hit KV binding with zero hop to origin.
  // (Python side also populates via sovereign REST on its path.)
  try {
    const env = (globalThis as any).env || process.env || {};
    const kvMcp = env.MCP_ENTITY_RESPONSES || (globalThis as any).MCP_ENTITY_RESPONSES || env.ENTITIES_MCP_RESPONSES;
    if (kvMcp && fullResp && (fullResp as any).found) {
      const normCif = q.replace(/^ES/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      let ckey = '';
      if (/^[A-Z0-9]{8,12}$/.test(normCif)) {
        ckey = `mcp_entity_responses::cif:${normCif}`;
      } else {
        const nname = q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64);
        ckey = `mcp_entity_responses::name:XX:${nname}`;
      }
      // Put with short ttl (CF KV binding .put supports options)
      await kvMcp.put(ckey, JSON.stringify(fullResp), { expirationTtl: 300 }).catch(() => {});
    }
  } catch (e) {
    // non blocking
  }

  return fullResp;
}
