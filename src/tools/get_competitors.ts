import { z } from 'zod';
import { entiaClient } from '../client.js';

export const GetCompetitorsSchema = z.object({
  sector: z.string().min(2).max(50).describe(
    'ENTIA sector slug (e.g. estetica, dental, psicologia, legal, ' +
    'inmobiliaria, restaurantes, gimnasios, salud).'
  ),
  city: z.string().min(2).max(100).describe(
    'City name in the target country (e.g. Madrid, Barcelona, ' +
    'London, Paris).'
  ),
  limit: z.number().int().min(1).max(50).default(10).describe(
    'Maximum competitors to return (1-50, default 10).'
  ),
});

export type GetCompetitorsArgs = z.infer<typeof GetCompetitorsSchema>;

/**
 * Find real competitors in the same sector and geography. Returns ranked
 * entities with identity + location + sector matching score.
 */
export async function getCompetitors(args: GetCompetitorsArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/get_competitors',
    {
      sector: args.sector,
      city: args.city,
      limit: String(args.limit),
    },
    { requireAuth: true },
  );
}
