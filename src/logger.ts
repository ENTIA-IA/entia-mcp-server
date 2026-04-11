import { createHash } from 'node:crypto';
import { config } from './config.js';

/**
 * Structured logger for ENTIA MCP Server.
 *
 * Outputs JSON to stderr (Cloud Run captures stderr as structured logs).
 * Each log entry is a single JSON object that Cloud Logging can parse,
 * filter, and aggregate natively.
 */

export interface ClientIdentity {
  name: string;       // e.g. "claude-ai", "custom-agent", "curl-test"
  version: string;    // e.g. "1.0", "2024.11"
  sessionId: string;  // MCP session UUID (first 8 chars for privacy)
}

export interface ToolCallLog {
  tool: string;
  auth: boolean;
  latency_ms: number;
  status: 'ok' | 'error';
  error_type?: string;
  upstream_status?: number;
  upstream_latency_ms?: number;
  query_hint?: string;
  client?: ClientIdentity;
}

export interface UpstreamCallLog {
  method: 'GET' | 'POST';
  path: string;
  status: number;
  latency_ms: number;
  auth: boolean;
  rate_limited: boolean;
}

/**
 * Hash an API key for logging — never log keys in cleartext.
 * Returns first 8 chars of SHA-256 hash.
 */
export function hashKey(key: string): string {
  if (!key) return 'none';
  return createHash('sha256').update(key).digest('hex').substring(0, 8);
}

/**
 * Log a new MCP session (on initialize).
 */
export function logSessionStart(client: ClientIdentity): void {
  const log = {
    severity: 'INFO',
    message: `MCP session: ${client.name}/${client.version} → ${client.sessionId}`,
    'logging.googleapis.com/labels': {
      service: 'entia-mcp-server',
      component: 'session',
    },
    event: 'session_start',
    client_name: client.name,
    client_version: client.version,
    session_id: client.sessionId,
    timestamp: new Date().toISOString(),
  };
  console.error(JSON.stringify(log));
}

/**
 * Log a tool call with structured JSON + client identity.
 */
export function logToolCall(entry: ToolCallLog): void {
  const log = {
    severity: entry.status === 'error' ? 'WARNING' : 'INFO',
    message: `MCP tool:${entry.tool} ${entry.status} ${entry.latency_ms}ms${entry.client ? ` [${entry.client.name}]` : ''}`,
    'logging.googleapis.com/labels': {
      service: 'entia-mcp-server',
      component: 'tool',
    },
    tool: entry.tool,
    auth: entry.auth,
    latency_ms: entry.latency_ms,
    status: entry.status,
    ...(entry.error_type ? { error_type: entry.error_type } : {}),
    ...(entry.upstream_status ? { upstream_status: entry.upstream_status } : {}),
    ...(entry.upstream_latency_ms ? { upstream_latency_ms: entry.upstream_latency_ms } : {}),
    ...(entry.query_hint ? { query_hint: entry.query_hint } : {}),
    // Client identity
    ...(entry.client ? {
      client_name: entry.client.name,
      client_version: entry.client.version,
      session_id: entry.client.sessionId,
    } : {}),
    api_key_hash: hashKey(config.ENTIA_API_KEY),
    timestamp: new Date().toISOString(),
  };
  console.error(JSON.stringify(log));
}

/**
 * Log an upstream ENTIA API call.
 */
export function logUpstreamCall(entry: UpstreamCallLog): void {
  const log = {
    severity: entry.rate_limited ? 'WARNING' : (entry.status >= 400 ? 'WARNING' : 'DEBUG'),
    message: `Upstream ${entry.method} ${entry.path} → ${entry.status} ${entry.latency_ms}ms`,
    'logging.googleapis.com/labels': {
      service: 'entia-mcp-server',
      component: 'upstream',
    },
    method: entry.method,
    path: entry.path,
    status: entry.status,
    latency_ms: entry.latency_ms,
    auth: entry.auth,
    rate_limited: entry.rate_limited,
    timestamp: new Date().toISOString(),
  };
  console.error(JSON.stringify(log));
}
