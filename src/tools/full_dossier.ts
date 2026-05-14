import { z } from 'zod';
import { entiaClient } from '../client.js';

export const FullDossierSchema = z.object({
  query: z.string().min(2).max(200).describe(
    'Company name, CIF/NIF (e.g. A28015865), EU VAT (e.g. ESA28015865), or LEI code. ' +
    'The API auto-detects the input type and aggregates 4 ENTIA sources in parallel.'
  ),
});

export type FullDossierArgs = z.infer<typeof FullDossierSchema>;

/**
 * Aggregator tool — returns 90+ fields about an entity in a single call.
 *
 * Combines 4 ENTIA sources in parallel (asyncio.gather, target <3s):
 *   1. entity_lookup   → identity, trust score, GLEIF, Wikidata, BORME basic
 *   2. zone_profile    → 30+ socioeconomic fields (ES only, if postal_code present)
 *   3. borme_lookup    → full BORME acts (ES only, if CIF present)
 *   4. verify_vat      → VIES live validation (EU only, if VAT present)
 *
 * Designed for due diligence, KYB, AI-ready entity profiles. The single
 * killer tool: customer says "tell me everything about Inditex" and gets
 * a complete dossier in one response.
 *
 * Auth: API key required. Rate limit: 10/min.
 * Latency: typically 1-3s. Hard timeout 12s per source — partial dossier
 * returned if a source fails (see _meta.sources_failed).
 */
export async function getFullDossier(args: FullDossierArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/full_dossier',
    { query: args.query },
    { requireAuth: true, timeoutMs: 30000 },
  );
}
