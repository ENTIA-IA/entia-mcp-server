# AWS bootstrap for standalone ENTIA MCP server

This Terraform stack creates a minimal, reversible AWS runtime for the standalone MCP service:

- ECR (container registry)
- ECS Fargate (runtime)
- ALB + ACM (TLS at load balancer)
- Route53 alias (optional cutover)
- Secrets Manager env injection
- CloudWatch logs

## Runtime invariants

- `MCP_TRANSPORT=http`
- `MCP_PORT=3000`
- `/health` health check path

## Required Terraform inputs

Required either in `terraform.tfvars`, `*.auto.tfvars`, or CI-provided JSON:

- `aws_region`
- `vpc_id`
- `public_subnet_ids`
- `private_subnet_ids`
- `certificate_arn`
- `container_image`

Optional:

- `create_dns_record` (`false` by default)
- `hosted_zone_id` + `domain_name` (required when `create_dns_record=true`)
- `secret_arns` map of env var name -> Secrets Manager ARN

## CI secret contract

GitHub Actions expects:

- Secret: `AWS_GITHUB_ACTIONS_ROLE_ARN`
- Secret: `TF_VARS_JSON_B64` (base64 of JSON tfvars excluding `container_image`)
- Variables: `AWS_REGION`, `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE`
- Optional variable: `DOCKERFILE_PATH` (default `Dockerfile`)

Example to generate `TF_VARS_JSON_B64` locally:

```bash
base64 -w0 infra/aws/ci.tfvars.json
```

Where `ci.tfvars.json` contains network/cert/DNS/secrets settings for the target environment.

## Rollout

1. Apply with `create_dns_record=false` first.
2. Validate ALB health + MCP traffic.
3. Enable Route53 alias in a second apply.

## Rollback

1. Repoint DNS to last known-good endpoint (Route53 alias rollback):

```bash
aws route53 change-resource-record-sets --hosted-zone-id <ZONE_ID> --change-batch file://rollback-dns.json
```

2. Roll back ECS to previous task definition revision:

```bash
aws ecs update-service   --cluster <CLUSTER_NAME>   --service <SERVICE_NAME>   --task-definition <TASK_FAMILY:PREVIOUS_REVISION>   --force-new-deployment
```

3. If rolling back by image tag instead of revision, re-run deploy with previous image tag in `container_image`.
4. Re-apply prior Terraform commit if infra rollback is required.
5. Validate rollback:
   - `GET /health` returns 200
   - target group healthy
   - MCP endpoint reachable
