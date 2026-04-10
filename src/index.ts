import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { config } from './config.js';

async function main() {
  const server = createServer();

  if (config.MCP_TRANSPORT === 'http') {
    // HTTP transport for Cloud Run / remote agents
    // Dynamic import to avoid loading http modules in stdio mode
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const http = await import('node:http');

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const httpServer = http.createServer(async (req, res) => {
      // Health check endpoint for Cloud Run
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          server: 'entia-mcp',
          version: '1.0.0',
          transport: 'http',
        }));
        return;
      }

      // MCP protocol handler
      await transport.handleRequest(req, res);
    });

    await server.connect(transport);

    httpServer.listen(config.MCP_PORT, () => {
      console.log(`[ENTIA MCP] HTTP transport listening on port ${config.MCP_PORT}`);
      console.log(`[ENTIA MCP] Health: http://localhost:${config.MCP_PORT}/health`);
    });
  } else {
    // stdio transport for Claude Code local
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Use stderr so it doesn't interfere with JSON-RPC on stdout
    console.error('[ENTIA MCP] stdio transport ready');
  }
}

main().catch((err) => {
  console.error('[ENTIA MCP] Fatal error:', err);
  process.exit(1);
});
