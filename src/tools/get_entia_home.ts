import { z } from 'zod';
import { entiaClient } from '../client.js';
import { config } from '../config.js';

export const GetEntiaHomeSchema = z.object({
  country: z.string().length(2).describe('ISO 3166-1 alpha-2 country code, lowercase (e.g. "es", "gb", "fr")'),
  sector: z.string().describe('Industry slug (e.g. "dental", "legal", "talleres", "estetica", "inmobiliarias")'),
  city: z.string().describe('City slug, lowercase with hyphens (e.g. "madrid", "barcelona", "london")'),
  slug: z.string().describe('URL-safe business name slug (e.g. "clinica-dental-sonrisa")'),
});

export type GetEntiaHomeArgs = z.infer<typeof GetEntiaHomeSchema>;

/**
 * Retrieve the full Schema.org JSON-LD @graph for a specific entity's Entia Home page.
 *
 * Returns 4 nodes:
 * 1. WebPage — canonical URL metadata
 * 2. Entity — identity, address, geo, identifiers, isBasedOn sources
 * 3. Verification Report — HMAC signature, confidence, per-source status
 * 4. Territorial Profile — socioeconomic context (INE/SEPE/Hacienda for Spain)
 *
 * Implementation: extracts the JSON-LD from the <script type="application/ld+json"> tag
 * in the HTML response. This is standard structured data extraction.
 */
export async function getEntiaHome(args: GetEntiaHomeArgs): Promise<{
  jsonld: Record<string, unknown> | null;
  url: string;
  note?: string;
}> {
  const path = `/v1/identity/${args.country}/${args.sector}/${args.city}/${args.slug}`;
  const url = `${config.ENTIA_API_BASE}${path}`;

  const jsonld = await entiaClient.getJsonLdFromHtml(path);

  if (!jsonld) {
    return {
      jsonld: null,
      url,
      note: 'Entity not found or no JSON-LD available. Try search_entities to find the correct path.',
    };
  }

  return { jsonld, url };
}
