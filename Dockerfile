FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY pyproject.toml README.md ./
COPY entia_mcp/ ./entia_mcp/

# Install the package with all dependencies
RUN pip install --no-cache-dir .

# ENTIA API key — set at runtime via -e ENTIA_API_KEY=entia_live_...
ENV ENTIA_API_KEY=""
ENV ENTIA_API_BASE_URL="https://entia.systems"
ENV ENTIA_MCP_URL="https://mcp.entia.systems"
ENV ENTIA_TIMEOUT="25"

# Run the MCP server on stdio (standard transport for MCP clients)
CMD ["entia-mcp-server"]
