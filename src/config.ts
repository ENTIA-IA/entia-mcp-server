export const config = {
  ENTIA_API_BASE: process.env.ENTIA_API_BASE ?? 'https://entia.systems',
  ENTIA_API_KEY: process.env.ENTIA_API_KEY ?? '',
  MCP_TRANSPORT: (process.env.MCP_TRANSPORT ?? 'stdio') as 'stdio' | 'http',
  MCP_PORT: parseInt(process.env.MCP_PORT ?? '3000', 10),
  REQUEST_TIMEOUT_MS: 30_000,  // 30s — /v1/search DuckDB cold start can take ~15s
  AUDIT_TIMEOUT_MS: 30_000, // run_risk_audit can be slow
};

if (!config.ENTIA_API_KEY) {
  console.warn('[ENTIA MCP] No ENTIA_API_KEY set — authenticated tools (search, audit) will fail');
}
