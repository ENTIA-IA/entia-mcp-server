import { z } from 'zod';
import { entiaClient } from '../client.js';

export const VerifyVatSchema = z.object({
  q: z.string().min(4).max(20).describe(
    'EU VAT number to validate against VIES. Accepts country prefix or bare number ' +
    '(e.g. ESA28015865, A28015865, IE6388047V).'
  ),
});

export type VerifyVatArgs = z.infer<typeof VerifyVatSchema>;

/**
 * Real-time EU VAT validation via VIES (27 countries).
 * Returns {valid, name, address, vat_number, country}.
 */
export async function verifyVat(args: VerifyVatArgs): Promise<unknown> {
  return entiaClient.get(
    '/api/v1/v3/verify_vat',
    { q: args.q },
    { requireAuth: true },
  );
}
