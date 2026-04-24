# ENTIA MCP Server — AWS edition

Post-migration (2026-04-24) Python MCP server that reads data directly from S3
parquet files via DuckDB's `httpfs` extension. Runs as a single Fargate task
behind an ALB with ACM TLS termination.

## Architecture

```
Claude Desktop / Cursor / Windsurf / …
         │  https://mcp.entia.systems/mcp  (Streamable HTTP)
         ▼
   CloudFront / Cloudflare edge (optional)
         ▼
   AWS ALB  (us-east-1, ACM TLS)
         ▼
   ECS Fargate  task
     └─ uvicorn  :3000
        └─ FastMCP  /mcp
           └─ DuckDB (in-memory)
              └─ read_parquet('s3://entia-data-parquet/...')
```

## 6 tools

| Tool               | Purpose                                                   |
|--------------------|-----------------------------------------------------------|
| `entity_lookup`    | Verify a company (CIF/NIF/VAT/LEI/name)                   |
| `search_entities`  | Search by sector + city + country                         |
| `borme_lookup`     | BORME mercantile acts (40.3M rows) for a company          |
| `verify_vat`       | Live VIES check for any EU VAT number                     |
| `zone_profile`     | Socioeconomic profile of a Spanish postal code            |
| `get_competitors`  | Local competitors by sector + city                        |

## Env vars

| Name                    | Default             | Notes                                         |
|-------------------------|---------------------|-----------------------------------------------|
| `ENTIA_S3_BUCKET`       | `entia-data-parquet`| S3 bucket with `{project}/{dataset}/{table}.parquet` |
| `ENTIA_S3_REGION`       | `us-east-1`         | Bucket region                                 |
| `ENTIA_DATA_PROJECT`    | `systems-ia-entia`  | Which project folder inside the bucket to use |
| `MCP_HOST`              | `0.0.0.0`           | Bind host                                     |
| `MCP_PORT`              | `3000`              | Bind port (ALB target group points here)      |
| `LOG_LEVEL`             | `info`              |                                               |

AWS credentials come from the ECS task IAM role (S3 read-only on the bucket).
Local dev uses `~/.aws/credentials` via DuckDB `credential_chain`.

## Local smoke test

```bash
cd server
pip install -r requirements.txt
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
python mcp_server.py
# or: uvicorn server.mcp_server:app --host 0.0.0.0 --port 3000
```

Then from another shell:

```bash
curl http://localhost:3000/health
# {"status": "ok", "s3_bucket": "entia-data-parquet", "region": "us-east-1"}
```

## Deploy to AWS (GitHub Actions)

1. Push this branch to origin.
2. Trigger the `AWS MCP Deploy` workflow manually (`workflow_dispatch`).
3. Workflow builds the image, pushes to ECR, and runs `terraform apply`.
4. ALB DNS emerges on workflow output (or in Route 53 if `create_dns_record`).

Prerequisites in the AWS account:
- VPC, 2 public + 2 private subnets (already in `tfvars.json`)
- ACM cert for the serving hostname (already exists for `mcp.entia.systems`)
- GitHub OIDC role `AWS_GITHUB_ACTIONS_ROLE_ARN` with ECR + ECS + TF permissions
- Task IAM role with `s3:GetObject` on `arn:aws:s3:::entia-data-parquet/*`

## Known gaps (Phase 1 post-migration)

- Trust score: stub (70 if VAT set else 40). Full multi-signal scoring Phase 2.
- No Firestore — session state is not persisted. Fine for read-only MCP.
- VIES is live (no cache). Consider adding a Redis/DuckDB local cache in Phase 2.
- `zone_profile` reads the ES-only table; non-ES postal codes return `found: false`.
- 17 MCP tools from the old GCP server NOT ported here (only the 6 critical ones).
  The others live in `core/mcp_server.py` of the main `ENTIA_DAHE` repo and need
  per-tool migration. Not on the critical path.
