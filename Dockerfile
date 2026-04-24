# ENTIA MCP Server — Fargate container
# Python 3.12 slim + DuckDB httpfs for direct S3 parquet reads.

FROM python:3.12-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3000 \
    MCP_TRANSPORT=http

# System deps for DuckDB httpfs (curl, ca-certs)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

COPY server/ /app/server/

EXPOSE 3000

# Healthcheck hits /health which runs SELECT 1 via DuckDB
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${MCP_PORT}/health || exit 1

CMD ["uvicorn", "server.mcp_server:app", "--host", "0.0.0.0", "--port", "3000", "--log-level", "info"]
