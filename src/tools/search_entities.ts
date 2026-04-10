import { z } from 'zod';
import { entiaClient } from '../client.js';
import type { SearchResponse } from '../types/entity.js';

export const SearchEntitiesSchema = z.object({
  q: z.string().min(2).describe('Search query — company name or keywords'),
  country: z.string().length(2).optional().describe('ISO country code filter (e.g. "es", "gb", "fr")'),
  sector: z.string().optional().describe(
    'Sector filter. Examples: dental, legal, talleres, estetica, inmobiliarias, ' +
    'hosteleria, reformas, veterinarios, asesorias, gimnasios, psicologia, and 24+ more'
  ),
  limit: z.number().int().min(1).max(50).default(10).describe('Max results (default 10, max 50)'),
});

export type SearchEntitiesArgs = z.infer<typeof SearchEntitiesSchema>;

/**
 * Search 5.5M+ verified entities across 34 countries by name, keyword, country, or sector.
 * Requires API key. Rate limit: 10 req/min.
 */
export async function searchEntities(args: SearchEntitiesArgs): Promise<SearchResponse> {
  const params: Record<string, string> = {
    q: args.q,
    per_page: String(args.limit),
  };
  if (args.country) params.country = args.country;
  if (args.sector) params.sector = args.sector;

  return entiaClient.get<SearchResponse>(
    '/v1/search',
    params,
    { requireAuth: true },
  );
}
