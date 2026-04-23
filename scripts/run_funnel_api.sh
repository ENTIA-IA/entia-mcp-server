#!/usr/bin/env bash
set -euo pipefail

python -m uvicorn entia_mcp.funnel_api:app --host 0.0.0.0 --port 3000
