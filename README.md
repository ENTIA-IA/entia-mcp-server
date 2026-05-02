# ENTIA MCP Server

**Structured business intelligence for AI agents.**

ENTIA provides verified entity data across 34 countries — accessible via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) or REST API.

| Metric | Value |
|---|---|
| Verified entities | 5.5M+ |
| Countries | 34 |
| BORME mercantile acts | 40.3M |
| Healthcare professionals | 570K+ |
| MCP tools | 6 |
| REST endpoints | 4 |

## Quick Start (< 2 minutes)

### Option 1: Remote MCP Server (recommended)

No installation needed. Connect your MCP client directly:

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "entia": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.entia.systems/mcp"]
    }
  }
}
```

**Cursor IDE** — add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "entia": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.entia.systems/mcp"]
    }
  }
}
```

Then try:
```
Look up Telefonica in Spain
```

### Option 2: REST API

```bash
# Search entities
curl "https://entia.systems/v1/search?q=telefonica&country=ES&limit=5" \
  -H "X-ENTIA-Key: YOUR_API_KEY"

# Full entity profile (BORME + GLEIF + VIES + Wikidata)
curl "https://entia.systems/v1/profile/Telefonica?country=ES"

# EU VAT verification
curl "https://entia.systems/v1/verify/vat/ESA28015865"

# Platform stats
curl "https://entia.systems/v1/stats"
```

### Option 3: Python SDK (coming soon)

A Python client (`entia-mcp` on PyPI) and LangChain integration are on the
roadmap. Not yet published. Until then, use Option 1 (MCP) or Option 2 (REST).

## 6 MCP Tools

| Tool | What it does |
|---|---|
| `entity_lookup` | Verify identity of any business across 34 countries (5.5M entities) |
| `search_entities` | Browse registry by name, sector, city, country |
| `borme_lookup` | Spanish mercantile acts (40.3M, 2009-2026) |
| `verify_vat` | EU VAT via VIES (27 member states) |
| `zone_profile` | Spanish socioeconomic data by postal code (INE/SEPE/AEAT) |
| `get_competitors` | Competitors in same sector and city |

## Pricing

| Tier | Price | Requests | Overage |
|---|---|---|---|
| TRACE | Free | 5/day | Hard block |
| SIGNAL | EUR 7.99/month | 500/month | Hard block |
| BUILD | EUR 39/month | 2,500/month | Hard block |
| INTEGRATE | EUR 149/month | 10,000/month | EUR 0.15/req |
| OPERATE | EUR 799/month | 100,000/month | EUR 0.10/req |
| SCALE | EUR 2,500/month | 500,000/month | EUR 0.05/req |
| ENTERPRISE | Custom | Unlimited | — |

Get your API key: [entia.systems/mcp-setup](https://entia.systems/mcp-setup)

## Data Sources

All data comes from official public registries:

- **BORME** -- Spanish Mercantile Registry (BOE)
- **VIES** -- EU VAT validation (European Commission)
- **GLEIF** -- Legal Entity Identifiers (Global LEI Foundation)
- **Wikidata** -- Knowledge Graph (Wikimedia Foundation)
- **REPS** -- Spanish Healthcare Professionals Registry
- **INE** -- Spanish National Statistics Institute
- **SEPE** -- Spanish Employment Service
- **AEAT** -- Spanish Tax Authority
- **Companies House** -- UK company registry
- **Sirene/INSEE** -- French company registry

## Links

- [API Documentation](https://entia.systems/mcp-docs)
- [Get API Key](https://entia.systems/mcp-setup)
- [Setup Guide](https://entia.systems/mcp-setup)
- [Client Dashboard](https://entia.systems/mcp-dashboard)
- [Official MCP Registry](https://registry.modelcontextprotocol.io)

## About

Built by [PrecisionAI Marketing OU](https://entia.systems) (Estonia, EU).

- VAT: EE102780516
- DUNS: 565868914
- e-Residency certified
- eIDAS compliant

## License

Proprietary. See [Terms of Service](https://entia.systems/legal/terms).

## AWS deployment (emergency migration runbook)

This repository now includes a minimal AWS bootstrap for running the standalone MCP server on **ECR + ECS Fargate + ALB + Route 53 + ACM + Secrets Manager + CloudWatch Logs** under `infra/aws/`.

### What is deployed

- ECR repository for container images.
- ECS cluster, task definition, and Fargate service.
- ALB with:
  - port 80 redirect to 443
  - port 443 HTTPS listener (ACM certificate)
  - target group health check on `/health`
- Security groups (ALB public ingress, ECS ingress from ALB only).
- Route53 alias record (optional) for `mcp.entia.systems`.
- CloudWatch Logs group for ECS logs.
- IAM roles with least-privilege baseline, plus optional Secrets Manager access.

### Runtime assumptions preserved

- `MCP_TRANSPORT=http`
- `MCP_PORT=3000`
- Health endpoint path: `/health`

### Required AWS environment variables (GitHub Actions repository variables)

- `AWS_REGION`
- `ECR_REPOSITORY` (example: `123456789012.dkr.ecr.us-east-1.amazonaws.com/entia-mcp-prod-mcp`)
- `ECS_CLUSTER`
- `ECS_SERVICE`
- `DOCKERFILE_PATH` (optional, defaults to `Dockerfile`)

### Required GitHub Actions secrets

- `AWS_GITHUB_ACTIONS_ROLE_ARN` (OIDC role ARN with Terraform/ECR/ECS permissions)
- `TF_VARS_JSON_B64` (base64-encoded JSON tfvars for required Terraform inputs except `container_image`)

### Required runtime secrets (AWS Secrets Manager)

Configure as `secret_arns` map in Terraform (`ENV_VAR_NAME => secret ARN`), for example:

- `ENTIA_API_KEY`
- Any upstream API credentials used by the standalone MCP server
- SMTP or provider tokens if used by the runtime

> Keep all credentials in Secrets Manager. Do not hardcode secrets in workflow files or Terraform variables.

### Deploy steps

1. Copy `infra/aws/terraform.tfvars.example` to `infra/aws/terraform.tfvars`.
2. Fill network/DNS/certificate/image values.
3. Run:
   - `terraform -chdir=infra/aws init`
   - `terraform -chdir=infra/aws plan`
   - `terraform -chdir=infra/aws apply`
4. For CI deploys, provide `TF_VARS_JSON_B64` secret (base64 of tfvars JSON) and trigger workflow `AWS MCP Deploy`.
5. Push to `main` or trigger GitHub Actions workflow `AWS MCP Deploy`.
6. Validate smoke checks:
   - `GET https://mcp.entia.systems/health` returns 200
   - MCP endpoint is reachable via ALB
   - ECS service has healthy targets

### Rollout steps (production-safe)

1. Deploy infra and ECS service without changing DNS (`create_dns_record=false`) and test on ALB DNS name.
2. Run smoke checks on ALB hostname.
3. Enable DNS alias (`create_dns_record=true`) once healthy.
4. Monitor CloudWatch Logs + ALB target health for at least one full business cycle.

### Rollback steps

1. Revert DNS alias to previous serving endpoint (`mcp.entia.systems`).
2. Re-deploy previous stable image tag **or** previous task definition revision in ECS:
   - `aws ecs update-service --cluster <cluster> --service <service> --task-definition <family:revision> --force-new-deployment`
3. If needed, roll back Terraform to previous commit and apply.
4. Confirm `/health` and MCP endpoint recovery.

### DNS cutover steps for `mcp.entia.systems`

1. Ensure ACM cert is issued for `mcp.entia.systems` in the deployment region.
2. Apply Terraform with `create_dns_record=true`, `hosted_zone_id`, and `domain_name="mcp.entia.systems"`.
3. Verify Route53 alias points to ALB and target group is healthy.
4. Execute post-cutover checks:
   - TLS certificate chain valid
   - `/health` = 200
   - MCP request/response path works end-to-end

For additional safety/rollback details, see `AGENTS.md` and `docs/aws-migration-assumptions.md`.
