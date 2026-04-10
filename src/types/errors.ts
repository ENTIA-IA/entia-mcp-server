/**
 * Custom error types for ENTIA MCP Server.
 */

export class EntiaApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'EntiaApiError';
  }
}

export class RateLimitError extends EntiaApiError {
  constructor(
    public retryAfterSeconds: number,
  ) {
    super(429, `Rate limited. Retry after ${retryAfterSeconds} seconds.`);
    this.name = 'RateLimitError';
  }
}

export class AuthError extends EntiaApiError {
  constructor() {
    super(401, 'ENTIA_API_KEY is missing or invalid. Set the ENTIA_API_KEY environment variable.');
    this.name = 'AuthError';
  }
}
