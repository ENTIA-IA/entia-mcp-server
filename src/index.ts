import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { config } from './config.js';

// --- Security limits ---
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes idle
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const CLEANUP_INTERVAL_MS = 60 * 1000; // sweep every 60s

interface SessionEntry {
  transport: unknown; // typed dynamically after import
  lastActivity: number;
}

async function main() {
  const server = createServer();

  if (config.MCP_TRANSPORT === 'http') {
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const http = await import('node:http');

    type TransportType = InstanceType<typeof StreamableHTTPServerTransport>;
    const sessions = new Map<string, { transport: TransportType; lastActivity: number }>();

    // --- S1 FIX: Periodic session cleanup (idle > 30 min) ---
    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sid, entry] of sessions) {
        if (now - entry.lastActivity > SESSION_TTL_MS) {
          entry.transport.close().catch(() => {});
          sessions.delete(sid);
          console.error(`[ENTIA MCP] Session ${sid.substring(0, 8)}... expired (idle ${Math.round((now - entry.lastActivity) / 1000)}s)`);
        }
      }
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref(); // don't prevent process exit

    const httpServer = http.createServer(async (req, res) => {
      const url = req.url ?? '/';

      // Health check — no session count exposed (S5 fix)
      if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          server: 'entia-mcp',
          version: '1.0.4',
          transport: 'http',
        }));
        return;
      }

      // Only handle /mcp path
      if (url !== '/mcp' && !url.startsWith('/mcp?')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. MCP endpoint is at /mcp' }));
        return;
      }

      // POST — initialize or tool call
      if (req.method === 'POST') {
        // --- S2 FIX: Body size limit ---
        let body = '';
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length ?? (chunk as string).length;
          if (size > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large. Max 1MB.' }));
            return;
          }
          body += chunk;
        }

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        const isInit = Array.isArray(parsedBody)
          ? (parsedBody as Array<{ method?: string }>).some(m => m.method === 'initialize')
          : (parsedBody as { method?: string })?.method === 'initialize';

        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (isInit) {
          // --- S1 FIX: Session cap ---
          if (sessions.size >= MAX_SESSIONS) {
            // Evict oldest idle session
            let oldestSid: string | null = null;
            let oldestTime = Infinity;
            for (const [sid, entry] of sessions) {
              if (entry.lastActivity < oldestTime) {
                oldestTime = entry.lastActivity;
                oldestSid = sid;
              }
            }
            if (oldestSid) {
              const entry = sessions.get(oldestSid);
              if (entry) entry.transport.close().catch(() => {});
              sessions.delete(oldestSid);
            }
          }

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) sessions.delete(sid);
          };

          const sessionServer = createServer();
          await sessionServer.connect(transport);
          await transport.handleRequest(req, res, parsedBody);

          const sid = transport.sessionId;
          if (sid) sessions.set(sid, { transport, lastActivity: Date.now() });
        } else if (sessionId && sessions.has(sessionId)) {
          const entry = sessions.get(sessionId)!;
          entry.lastActivity = Date.now(); // touch
          await entry.transport.handleRequest(req, res, parsedBody);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session. Send an initialize request first.' },
            id: null,
          }));
        }
        return;
      }

      // GET — SSE stream
      if (req.method === 'GET') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
          const entry = sessions.get(sessionId)!;
          entry.lastActivity = Date.now();
          await entry.transport.handleRequest(req, res);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session for GET.' },
            id: null,
          }));
        }
        return;
      }

      // DELETE — close session
      if (req.method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
          const entry = sessions.get(sessionId)!;
          await entry.transport.close();
          sessions.delete(sessionId);
          res.writeHead(200);
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      res.writeHead(405);
      res.end();
    });

    // --- B4 FIX: Graceful shutdown ---
    const shutdown = async () => {
      console.error('[ENTIA MCP] Shutting down gracefully...');
      clearInterval(cleanupTimer);
      httpServer.close();
      for (const [sid, entry] of sessions) {
        await entry.transport.close().catch(() => {});
        sessions.delete(sid);
      }
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    httpServer.listen(config.MCP_PORT, () => {
      console.log(`[ENTIA MCP] HTTP transport listening on port ${config.MCP_PORT}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[ENTIA MCP] stdio transport ready');
  }
}

main().catch((err) => {
  console.error('[ENTIA MCP] Fatal error:', err);
  process.exit(1);
});
