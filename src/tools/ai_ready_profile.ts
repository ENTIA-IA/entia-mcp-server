import { z } from 'zod';
import { entiaClient } from '../client.js';

export const AiReadyProfileSchema = z.object({
  query: z.string().min(2).max(500).describe(
    'Company name or domain. Returns the full AI-ready JSON-LD @graph ' +
    '(4 nodes: Organization, Place, LocalBusiness, PostalAddress).'
  ),
});

export type AiReadyProfileArgs = z.infer<typeof AiReadyProfileSchema>;

/**
 * Full AI-ready JSON-LD profile for any entity. 4-node @graph with
 * verification flags and territorial data. Designed for direct
 * citation by AI agents.
 */
export async function aiReadyProfile(args: AiReadyProfileArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/ai_ready_profile',
    { query: args.query },
    { requireAuth: true },
  );
}
