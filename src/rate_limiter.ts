/**
 * In-memory rate limiter per client.
 *
 * Sliding window counter: tracks call counts per client_name + tool
 * in 1-minute windows. No Redis needed at current scale.
 *
 * When a client exceeds the limit, the MCP Server rejects the call
 * BEFORE forwarding to the upstream ENTIA API — saving cost and
 * protecting the shared upstream IP.
 */

export interface RateLimitConfig {
  /** Max calls per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
}

/** Per-tool rate limits */
export const TOOL_LIMITS: Record<string, RateLimitConfig> = {
  entity_lookup:     { max: 10, windowMs: 60_000 },
  get_entia_home:    { max: 10, windowMs: 60_000 },
  search_entities:   { max: 10, windowMs: 60_000 },
  run_risk_audit:    { max: 3,  windowMs: 60_000 },
  get_platform_stats:{ max: 20, windowMs: 60_000 },
  lookup_by_domain:  { max: 10, windowMs: 60_000 },
};

/** Default limit for unknown tools */
const DEFAULT_LIMIT: RateLimitConfig = { max: 10, windowMs: 60_000 };

interface WindowEntry {
  timestamps: number[];
}

// Map: "client_name:tool" → timestamps of recent calls
const windows = new Map<string, WindowEntry>();

/**
 * Check if a call is allowed. Returns { allowed, remaining, resetMs }.
 * If not allowed, the caller should reject the request without forwarding upstream.
 */
export function checkRateLimit(clientName: string, tool: string): {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetMs: number;
} {
  const config = TOOL_LIMITS[tool] || DEFAULT_LIMIT;
  const key = `${clientName}:${tool}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = windows.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(key, entry);
  }

  // Prune expired timestamps
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= config.max) {
    // Over limit
    const oldestInWindow = entry.timestamps[0] || now;
    const resetMs = (oldestInWindow + config.windowMs) - now;
    return {
      allowed: false,
      remaining: 0,
      limit: config.max,
      resetMs: Math.max(0, resetMs),
    };
  }

  // Allowed — record this call
  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.max - entry.timestamps.length,
    limit: config.max,
    resetMs: config.windowMs,
  };
}

/**
 * Periodic cleanup of expired windows to prevent memory growth.
 * Call every ~5 minutes.
 */
export function cleanupExpiredWindows(): void {
  const now = Date.now();
  for (const [key, entry] of windows) {
    // Find the max windowMs for this tool
    const tool = key.split(':')[1] || '';
    const config = TOOL_LIMITS[tool] || DEFAULT_LIMIT;
    entry.timestamps = entry.timestamps.filter(t => t > now - config.windowMs);
    if (entry.timestamps.length === 0) {
      windows.delete(key);
    }
  }
}
