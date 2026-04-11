import type { ClientIdentity } from './logger.js';

/**
 * In-memory store mapping MCP session IDs to client identity.
 * Populated on initialize, read on every tool call.
 *
 * The server.ts withLogging() wrapper reads from this store
 * to tag every log entry with who called the tool.
 */

const clients = new Map<string, ClientIdentity>();

/** Current session ID for the active request (set by index.ts before routing) */
let _activeSessionId: string | undefined;

export function setClient(sessionId: string, client: ClientIdentity): void {
  clients.set(sessionId, client);
}

export function getClient(sessionId: string): ClientIdentity | undefined {
  return clients.get(sessionId);
}

export function removeClient(sessionId: string): void {
  clients.delete(sessionId);
}

export function setActiveSession(sessionId: string | undefined): void {
  _activeSessionId = sessionId;
}

export function getActiveClient(): ClientIdentity | undefined {
  if (!_activeSessionId) return undefined;
  return clients.get(_activeSessionId);
}
