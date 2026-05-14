import { z } from 'zod';
import { entiaClient } from '../client.js';

export const BormeLookupSchema = z.object({
  company: z.string().min(2).max(500).describe(
    'Company name or CIF to look up in BORME (Boletín Oficial del ' +
    'Registro Mercantil de España). Coverage: 40,345,410 mercantile ' +
    'acts since 2009.'
  ),
});

export type BormeLookupArgs = z.infer<typeof BormeLookupSchema>;

/**
 * Full BORME corporate history: acts (constituciones, officer changes,
 * capital changes, concursal proceedings), officers, capital, CNAE,
 * objeto social. Spain only.
 */
export async function bormeLookup(args: BormeLookupArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/borme_lookup',
    { company: args.company },
    { requireAuth: true },
  );
}
