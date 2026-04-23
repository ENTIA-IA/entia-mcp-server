# AGENTS.md — AWS MCP Migration Runbook

## Scope
This file applies to the entire repository.

## Mission
Deploy the standalone MCP server to AWS as an independent runtime (ECR + ECS Fargate + ALB + Route 53 + ACM + Secrets Manager + CloudWatch Logs) with minimal, reversible changes.

## Non-negotiables
- Keep MCP transport on HTTP (`MCP_TRANSPORT=http`) behind ALB TLS termination.
- Keep container/app port `MCP_PORT=3000` unless runtime evidence proves otherwise.
- Keep health check endpoint as `GET /health`.
- Do not redesign product logic during emergency migration.
- Keep changes rollback-friendly.

## Deploy prerequisites
1. Existing VPC with at least 2 public + 2 private subnets.
2. ACM certificate in target region for `mcp.entia.systems`.
3. Route53 hosted zone for `entia.systems`.
4. GitHub OIDC role (`AWS_GITHUB_ACTIONS_ROLE_ARN`) with ECR/ECS/Terraform permissions.
5. Application secrets created in AWS Secrets Manager.

## Deploy steps (Terraform + GitHub Actions)
1. Copy `infra/aws/terraform.tfvars.example` to `infra/aws/terraform.tfvars` and fill values.
2. Run `terraform init && terraform plan` in `infra/aws/`.
3. Apply with `terraform apply`.
4. Trigger `.github/workflows/aws-ecs-deploy.yml` (or push to `main`).
5. Validate smoke checks:
   - `GET /health` returns `200`.
   - MCP HTTP endpoint responds through ALB/Route53.
   - ECS service reaches steady state with healthy targets.

## Safety checks
- Confirm the task definition still injects `MCP_TRANSPORT=http` and `MCP_PORT=3000`.
- Confirm target group health check path remains `/health`.
- Confirm only expected Secrets Manager ARNs are granted to execution role.
- Confirm deployment circuit breaker is enabled on ECS service.

## Rollback steps
1. Route53 rollback:
   - Repoint `mcp.entia.systems` alias back to previous known-good target.
2. ECS rollback:
   - `aws ecs update-service --force-new-deployment` with previous task definition revision or previous image tag.
3. Terraform rollback:
   - Re-apply previous git commit containing known-good infra definitions.
4. Verify:
   - `/health` status 200.
   - Target group healthy.
   - Error rate recovered.

## Incident note template
- **What changed:** image tag, task def revision, terraform commit SHA.
- **Impact window:** UTC timestamps.
- **Blast radius:** percentage traffic affected.
- **Recovery action:** DNS rollback / ECS rollback / both.
