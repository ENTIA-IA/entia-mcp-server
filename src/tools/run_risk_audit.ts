import { z } from 'zod';
import { entiaClient } from '../client.js';
import { config } from '../config.js';
import type { AuditResponse } from '../types/entity.js';

export const RunRiskAuditSchema = z.object({
  domain: z.string().min(3).max(253).regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i).describe('Domain to audit (e.g. "clinicadental.es", "example.com")'),
  sector_id: z.string().optional().describe(
    'Optional sector hint for more accurate scoring. ' +
    'Examples: dental, legal, talleres, estetica, inmobiliarias'
  ),
  name: z.string().optional().describe('Optional business name for context'),
});

export type RunRiskAuditArgs = z.infer<typeof RunRiskAuditSchema>;

/**
 * Run a comprehensive AI-readiness and digital risk audit on any domain.
 * Analyzes SSL, DNS health, structured data, and LLM visibility signals.
 * Returns risk score 0-100 (lower = better, >60 = action recommended).
 *
 * Requires API key. Rate limit: 5 req/min. Timeout: 30s (audit probes can be slow).
 */
export async function runRiskAudit(args: RunRiskAuditArgs): Promise<AuditResponse> {
  const body: Record<string, unknown> = {
    domain: args.domain,
  };
  if (args.sector_id) body.sector_id = args.sector_id;
  if (args.name) body.name = args.name;

  return entiaClient.post<AuditResponse>(
    '/api/v1/audit',
    body,
    { requireAuth: true, timeoutMs: config.AUDIT_TIMEOUT_MS },
  );
}
