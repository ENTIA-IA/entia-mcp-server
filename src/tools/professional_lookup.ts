import { z } from 'zod';
import { entiaClient } from '../client.js';

export const ProfessionalLookupSchema = z.object({
  query: z.string().min(2).max(500).describe(
    'Professional name, colegiado number, or REPS identifier. ' +
    'Covers healthcare professionals (REPS), abogados (CGAE), ' +
    'psicólogos (COP), médicos, enfermería, dentistas, fisioterapeutas, ' +
    'logopedas, dietistas, podólogos, ópticos, veterinarios, ' +
    'terapeutas ocupacionales (17 CCAA).'
  ),
});

export type ProfessionalLookupArgs = z.infer<typeof ProfessionalLookupSchema>;

/**
 * Verify professional registrations across 24 Spanish health/legal/
 * psychology verticals. Returns colegiado number, college, specialty,
 * registration status.
 */
export async function professionalLookup(args: ProfessionalLookupArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/professional_lookup',
    { query: args.query },
    { requireAuth: true },
  );
}
