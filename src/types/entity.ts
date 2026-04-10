/**
 * Shared types for ENTIA MCP Server responses.
 * These mirror the ENTIA API response shapes.
 */

export interface EntityLookupResponse {
  found: boolean;
  query: string;
  entity?: {
    name: string;
    id: string;
    lei?: string;
    country_code: string;
    city?: string;
    address?: string;
    company_status?: string;
  };
  trust_score?: {
    score: number;
    badge: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED';
    dimensions: Array<{ name: string; score: number; weight: number }>;
  };
  verification?: Record<string, string>;
  sources?: Record<string, unknown>;
  _live?: boolean;
}

export interface SearchResponse {
  results: Array<{
    name: string;
    country_code: string;
    city: string;
    sector: string;
    identity_url?: string;
    trust_badge?: string;
  }>;
  total: number;
  returned: number;
}

export interface AuditResponse {
  status: 'SUCCESS' | 'ERROR';
  job_id: string;
  domain: string;
  risk_score: number;
  risk_level: string;
  audit?: {
    current_status: {
      risk_score: number;
      risk_level: string;
      gaps: string[];
    };
    predictive_oracle?: unknown;
    autonomic_intervention?: unknown;
  };
}

export interface PlatformStats {
  entities_total: number;
  countries: number;
  sources: number;
  homes_published: number;
  last_updated?: string;
}
