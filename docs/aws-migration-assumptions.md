# AWS migration assumptions and root-cause notes

## Why assumptions were needed

During migration prep, this repository did **not** contain the standalone Node/TypeScript server runtime files (no `package.json`, no server source tree, no Dockerfile for the MCP server process). The visible code is a Python client package and integration helpers.

Because of that mismatch, infrastructure was prepared in a runtime-agnostic way with explicit variables and documented assumptions.

## Assumptions encoded in infrastructure

1. The runtime container listens on `MCP_PORT=3000`.
2. The runtime uses `MCP_TRANSPORT=http` behind ALB TLS termination.
3. The runtime serves health checks at `GET /health`.
4. Application secrets are injected from AWS Secrets Manager into env vars.
5. Container image is supplied externally as `var.container_image`.

## Risk notes

- If the actual standalone server listens on a different port, ECS target health will fail until `container_port` is updated.
- If `/health` differs, ALB target group will mark tasks unhealthy.
- If runtime needs additional IAM permissions (e.g., S3/SQS), task role policy must be extended explicitly.
- GitHub Actions workflow currently expects a buildable Docker context at repository root.

## Verification checklist before production cutover

1. Confirm the standalone MCP image starts with:
   - `MCP_TRANSPORT=http`
   - `MCP_PORT=3000`
2. Confirm `GET /health` returns HTTP 200 in-container and via ALB.
3. Confirm MCP endpoint is reachable through ALB hostname.
4. Confirm required secrets exist and are readable by ECS execution role.
5. Confirm CloudWatch logs contain successful startup and ready signal.
