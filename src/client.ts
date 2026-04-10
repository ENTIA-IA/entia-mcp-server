import { config } from './config.js';
import { logUpstreamCall } from './logger.js';

/**
 * HTTP client wrapper for ENTIA API.
 * All tools delegate to this client — single point for auth, timeouts, and error handling.
 */
export class EntiaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.ENTIA_API_BASE;
    this.apiKey = config.ENTIA_API_KEY;
  }

  /**
   * GET request returning JSON.
   */
  async get<T = unknown>(
    path: string,
    params?: Record<string, string>,
    options?: { requireAuth?: boolean; timeoutMs?: number }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') {
          url.searchParams.set(k, v);
        }
      }
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'ENTIA-MCP-Server/1.0',
    };

    if (this.apiKey) {
      headers['x-entia-api-key'] = this.apiKey;
    } else if (options?.requireAuth) {
      throw new Error('ENTIA_API_KEY required for this tool. Set the ENTIA_API_KEY env var.');
    }

    const timeout = options?.timeoutMs ?? config.REQUEST_TIMEOUT_MS;
    const start = performance.now();
    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(timeout),
    });
    const latency = Math.round(performance.now() - start);

    logUpstreamCall({
      method: 'GET',
      path,
      status: res.status,
      latency_ms: latency,
      auth: !!this.apiKey,
      rate_limited: res.status === 429,
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') ?? '60';
      throw new Error(`Rate limited by ENTIA API. Retry after ${retryAfter}s.`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`ENTIA API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * GET an Entia Home page and extract the JSON-LD from the HTML.
   * The /v1/identity/ endpoint returns HTML with an embedded <script type="application/ld+json">.
   * We parse that out — this is standard structured data extraction, not a hack.
   */
  async getJsonLdFromHtml(path: string): Promise<Record<string, unknown> | null> {
    const url = new URL(path, this.baseUrl);
    const start = performance.now();
    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'ENTIA-MCP-Server/1.0',
        ...(this.apiKey ? { 'x-entia-api-key': this.apiKey } : {}),
      },
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });
    const latency = Math.round(performance.now() - start);

    logUpstreamCall({
      method: 'GET',
      path,
      status: res.status,
      latency_ms: latency,
      auth: !!this.apiKey,
      rate_limited: res.status === 429,
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`ENTIA API error ${res.status} fetching ${path}`);
    }

    const html = await res.text();

    // Extract JSON-LD from <script type="application/ld+json">
    const match = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!match || !match[1]) {
      return null;
    }

    try {
      return JSON.parse(match[1]) as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON-LD in Entia Home at ${path}`);
    }
  }

  /**
   * POST request returning JSON.
   */
  async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
    options?: { requireAuth?: boolean; timeoutMs?: number }
  ): Promise<T> {
    if (options?.requireAuth !== false && !this.apiKey) {
      throw new Error('ENTIA_API_KEY required for this tool. Set the ENTIA_API_KEY env var.');
    }

    const timeout = options?.timeoutMs ?? config.REQUEST_TIMEOUT_MS;
    const start = performance.now();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'ENTIA-MCP-Server/1.0',
        ...(this.apiKey ? { 'x-entia-api-key': this.apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const latency = Math.round(performance.now() - start);

    logUpstreamCall({
      method: 'POST',
      path,
      status: res.status,
      latency_ms: latency,
      auth: !!this.apiKey,
      rate_limited: res.status === 429,
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') ?? '60';
      throw new Error(`Rate limited by ENTIA API. Retry after ${retryAfter}s.`);
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '(no body)');
      throw new Error(`ENTIA API error ${res.status}: ${err}`);
    }

    return res.json() as Promise<T>;
  }
}

export const entiaClient = new EntiaClient();
