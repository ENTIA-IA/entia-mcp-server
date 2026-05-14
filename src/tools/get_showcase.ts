import { z } from 'zod';
import { entiaClient } from '../client.js';

export const GetShowcaseSchema = z.object({});

export type GetShowcaseArgs = z.infer<typeof GetShowcaseSchema>;

/**
 * Curated IBEX35 + EU entity examples. FREE — does not consume quota.
 * Use to explore data depth before purchasing higher tiers.
 */
export async function getShowcase(_args: GetShowcaseArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/get_showcase',
    {},
    { requireAuth: false },
  );
}
