import { z } from 'zod';

export const LookupByDomainSchema = z.object({
  domain: z.string().describe(
    'Domain name to look up (e.g. "example.com" or "www.example.com"). ' +
    'The API normalizes the domain automatically.'
  ),
});

export type LookupByDomainArgs = z.infer<typeof LookupByDomainSchema>;

/**
 * Look up a business entity by its website domain.
 *
 * STATUS: Coming in v1.1 — the /v1/entity?domain= endpoint is not yet deployed.
 * Returns 501 Not Implemented with a clear message.
 *
 * Workaround for agents: use entity_lookup with the company name instead,
 * or search_entities with the domain as a keyword.
 */
export async function lookupByDomain(_args: LookupByDomainArgs): Promise<{
  error: string;
  status: number;
  workaround: string;
}> {
  return {
    error: 'lookup_by_domain is coming in ENTIA MCP Server v1.1. The /v1/entity?domain= API endpoint is not yet deployed.',
    status: 501,
    workaround: 'Use entity_lookup with the company name, or search_entities with the domain as a keyword.',
  };
}
