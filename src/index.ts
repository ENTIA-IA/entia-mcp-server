import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { config } from './config.js';

async function main() {
  const server = createServer();

  if (config.MCP_TRANSPORT === 'http') {
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const http = await import('node:http');

    // Per-session transports map (stateful mode)
    const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

    const httpServer = http.createServer(async (req, res) => {
      const url = req.url ?? '/';

      // Health check — Cloud Run + monitoring
      if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          server: 'entia-mcp',
          version: '1.0.2',
          transport: 'http',
          sessions: sessions.size,
        }));
        return;
      }

      // Only handle /mcp path for MCP protocol
      if (url !== '/mcp' && !url.startsWith('/mcp?')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. MCP endpoint is at /mcp' }));
        return;
      }

      // Parse request body for POST
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
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

        // Check if this is an initialization request (new session)
        const isInit = Array.isArray(parsedBody)
          ? (parsedBody as Array<{ method?: string }>).some(m => m.method === 'initialize')
          : (parsedBody as { method?: string }).method === 'initialize';

        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (isInit) {
          // Create new transport for this session
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) sessions.delete(sid);
          };

          // Connect the MCP server to this transport
          const sessionServer = createServer();
          await sessionServer.connect(transport);

          // Handle the init request
          await transport.handleRequest(req, res, parsedBody);

          // Store the transport by session ID
          const sid = transport.sessionId;
          if (sid) sessions.set(sid, transport);
        } else if (sessionId && sessions.has(sessionId)) {
          // Existing session — route to its transport
          const transport = sessions.get(sessionId)!;
          await transport.handleRequest(req, res, parsedBody);
        } else {
          // No session or unknown session
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session. Send an initialize request first.' },
            id: null,
          }));
        }
        return;
      }

      // GET — SSE stream for existing session
      if (req.method === 'GET') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
          const transport = sessions.get(sessionId)!;
          await transport.handleRequest(req, res);
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
          const transport = sessions.get(sessionId)!;
          await transport.close();
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
