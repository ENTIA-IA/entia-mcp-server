import { z } from 'zod';
import { entiaClient } from '../client.js';

export const ZoneProfileSchema = z.object({
  postal_code: z.string().regex(/^\d{5}$/).describe(
    'Spanish 5-digit postal code (e.g. 28013 for Madrid Gran Vía). ' +
    'Spain only — UK/FR/etc. return empty.'
  ),
});

export type ZoneProfileArgs = z.infer<typeof ZoneProfileSchema>;

/**
 * Socioeconomic profile of a Spanish postal code. Returns ~17 blocks:
 * income (AEAT), employment (SEPE), demographics (INE), business census
 * (DIRCE), real estate (€/m²), digital infrastructure (FTTH coverage),
 * poverty/inequality (Gini, S80/S20), tourism demand (EOAC/EOAP).
 */
export async function zoneProfile(args: ZoneProfileArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/zone_profile',
    { postal_code: args.postal_code },
    { requireAuth: true },
  );
}
