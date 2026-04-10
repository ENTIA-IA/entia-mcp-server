import { z } from 'zod';
import { entiaClient } from '../client.js';
import type { EntityLookupResponse } from '../types/entity.js';

export const EntityLookupSchema = z.object({
  q: z.string().min(2).describe(
    'Company name, CIF/NIF (e.g. B82846825), EU VAT ID (e.g. ESB82846825), or LEI code (20 chars). ' +
    'The API auto-detects the input type.'
  ),
});

export type EntityLookupArgs = z.infer<typeof EntityLookupSchema>;

/**
 * Look up any business entity in the ENTIA verified registry.
 * Public endpoint — no API key required. Rate limit: 10 req/min.
 */
export async function entityLookup(args: EntityLookupArgs): Promise<EntityLookupResponse> {
  return entiaClient.get<EntityLookupResponse>(
    '/api/v1/demo/lookup',
    { q: args.q },
  );
}
