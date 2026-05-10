# AWS Adaptation Plan — TypeScript MCP Server v1.0.4
**Fecha:** 2026-05-10  
**Agente:** Claude Sonnet 4.6  
**Branch:** `restore-typescript-v1.0.6` (commit `322b199`)  
**Propósito:** Documentar cada diferencia entre el deploy Cloud Run original y el deploy ECS Fargate destino. Referencia para Fase 3.

---

## 1. Env vars — mapa completo

### src/config.ts (fuente de verdad)

```typescript
ENTIA_API_BASE: process.env.ENTIA_API_BASE ?? 'https://entia.systems'
ENTIA_API_KEY:  process.env.ENTIA_API_KEY  ?? ''
MCP_TRANSPORT:  process.env.MCP_TRANSPORT  ?? 'stdio'  // 'stdio' | 'http'
MCP_PORT:       process.env.MCP_PORT       ?? '3000'
REQUEST_TIMEOUT_MS: 15_000  // hardcoded, no env var
AUDIT_TIMEOUT_MS:   30_000  // hardcoded, no env var
```

### Tabla de adaptación Cloud Run → ECS

| Var | Cloud Run original | ECS Fargate destino | Fuente |
|---|---|---|---|
| `ENTIA_API_BASE` | `https://entia.systems` (default) | **`https://api.entia.systems`** — bypass CF Worker, directo al ALB→ECS | ECS task env plain |
| `ENTIA_API_KEY` | Secret Manager GCP | **AWS Secrets Manager** → `entia/mcp-ts/api-key` | ECS task secret |
| `MCP_TRANSPORT` | `http` (vía env en Cloud Run) | `http` — ya baked en Dockerfile ✅ | Dockerfile `ENV` |
| `MCP_PORT` | `3000` | `3000` — ya baked en Dockerfile ✅ | Dockerfile `ENV` |
| `NODE_ENV` | no estaba | `production` | ECS task env plain |

**Nota `ENTIA_API_BASE`:** El default `https://entia.systems` funciona técnicamente (el CF Worker pasa `/v1/*` y `/api/v1/*` a ECS). Pero añade un hop CF innecesario para llamadas server-to-server. En ECS la latencia del hop CF puede acumularse. Recomendado: `https://api.entia.systems` que va directo al ALB.

**Cero env vars GCP que eliminar.** No había `GOOGLE_*`, `BIGQUERY_*`, `CLOUD_RUN_*`, ni `GOOGLE_APPLICATION_CREDENTIALS` en el código. La migración env vars es solo añadir `ENTIA_API_KEY` via Secrets Manager AWS.

---

## 2. Endpoints que el TypeScript llama al backend

Extraído de `src/tools/*.ts`:

| Tool | Método | Path | Auth requerida | Verificada live |
|---|---|---|---|---|
| `entity_lookup` | GET | `/api/v1/demo/lookup?q=...` | No (x-entia-api-key opcional) | 200 ✅ |
| `get_entia_home` | GET | `/v1/identity/{country}/{sector}/{city}/{slug}` | No | (HTML page, devuelve 200) |
| `get_platform_stats` | GET | `/api/v1/stats/live` | No | (part of /v1/stats → 200) |
| `run_risk_audit` | POST | `/api/v1/audit` | Sí | 401 → existe ✅ |
| `search_entities` | GET | `/v1/search?q=&country=` | Sí | 401 → existe ✅ |
| `lookup_by_domain` | — | stub (501) | — | No llama al backend |

**Conclusión:** Los 5 endpoints activos existen en el backend Python actual (rev 140). Sin cambios de schema necesarios en Fase 3.

---

## 3. Dockerfile — análisis completo

```dockerfile
# Stage 1: Build (node:20-alpine)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci                      # lockfile install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc                     # compila TypeScript → dist/

# Stage 2: Production (node:20-alpine)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev           # solo dependencias runtime
COPY --from=builder /app/dist/ ./dist/

ENV MCP_TRANSPORT=http          # ya configurado para ECS ✅
ENV MCP_PORT=3000               # ya configurado ✅

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q -O- http://localhost:3000/health || exit 1   # endpoint /health existe en index.ts ✅

CMD ["node", "dist/index.js"]   # entry point correcto ✅
```

### Diferencias Cloud Run → ECS Fargate

| Aspecto | Cloud Run original | ECS Fargate destino | Cambio requerido |
|---|---|---|---|
| Base image | `node:20-alpine` | `node:20-alpine` | Ninguno |
| Port | 3000 | 3000 | Ninguno — ALB target group apunta a 3000 |
| Health check | `GET /health` HTTP 200 | `GET /health` HTTP 200 | Ninguno — mismo path |
| Secrets inyección | GCP Secret Manager (automático en Cloud Run) | ECS `secrets` block → AWS Secrets Manager | Solo cambio en task definition, no en código |
| Logging | stdout → Cloud Logging | stdout → CloudWatch Logs `/ecs/entia-mcp-ts` | Ninguno en código — CloudWatch captura stdout automáticamente |
| CPU/RAM | Cloud Run auto-scaling | `512 CPU / 1024 MB` (Terraform default) | Aceptable para MCP server |
| Cold start | Muy rápido (serverless) | `min 1 task` recomendado | Config ECS `desiredCount=1` para staging, `=2` para prod |
| GCP auth | Implícita vía SA | N/A — no usa GCP | Ninguno |

**El Dockerfile es compatible con ECS sin ninguna modificación.** Listo para `docker build` → ECR push.

---

## 4. ECR — repositorio necesario

El deploy requiere imagen en ECR. No existe repositorio ECR para este servicio todavía.

```bash
# Crear (una vez, en Fase 3):
aws ecr create-repository \
  --repository-name entia-mcp-ts \
  --region eu-west-1 \
  --image-scanning-configuration scanOnPush=true \
  --tags Key=Project,Value=entia Key=ManagedBy,Value=manual

# URI resultante: 267673636179.dkr.ecr.eu-west-1.amazonaws.com/entia-mcp-ts
```

---

## 5. AWS Secrets Manager — secret a crear

```bash
# Secret a crear antes del deploy (Fase 3):
aws secretsmanager create-secret \
  --name entia/mcp-ts/api-key \
  --description "ENTIA MCP TypeScript server — internal API key para llamadas a api.entia.systems" \
  --region eu-west-1
  # valor: clave válida en entia_mcp_auth DynamoDB (tier internal o pro)
```

La tarea ECS lee este secret y lo inyecta como `ENTIA_API_KEY` en el contenedor. Cero hardcoding.

---

## 6. Terraform — decisión pendiente (Fase 3)

Ver `docs/P0_BLOCKERS_FASE_1.md` sección 4 para detalle completo.

Módulo existente: `~/Desktop/entia-mcp-server-ts/infra/aws/`

**Opción A — Service paralelo en cluster `entia-api-prod` existente**

```hcl
# Solo añadir al cluster existente:
# - aws_ecs_task_definition.entia_mcp_ts
# - aws_ecs_service.entia_mcp_ts  (cluster = entia-api-prod)
# - aws_lb_target_group.entia_mcp_ts
# - aws_lb_listener_rule (en el ALB existente, host-header = mcp-ts.entia.systems)
# Sin nuevo ALB. Sin nuevo cluster.
```

**Opción B — Stack standalone (lo que el módulo ya tiene)**

```hcl
# Nuevo cluster + nuevo ALB + nuevo everything.
# Costo extra ~$16/mes.
# DNS Cloudflare CNAME mcp-ts.entia.systems → nuevo ALB DNS name.
# create_dns_record = false (Cloudflare, no Route53).
```

**Inputs requeridos para cualquier opción:**

| Variable | Valor |
|---|---|
| `aws_region` | `eu-west-1` |
| `container_image` | `267673636179.dkr.ecr.eu-west-1.amazonaws.com/entia-mcp-ts:v1.0.4` |
| `vpc_id` | Obtener: `aws ec2 describe-vpcs --region eu-west-1` |
| `public_subnet_ids` | Obtener: `aws ec2 describe-subnets --region eu-west-1` |
| `private_subnet_ids` | Idem |
| `certificate_arn` | ACM cert `*.entia.systems` en `eu-west-1` |
| `secret_arns` | `{"ENTIA_API_KEY": "arn:aws:secretsmanager:eu-west-1:267673636179:secret:entia/mcp-ts/api-key"}` |
| `additional_environment` | `{"ENTIA_API_BASE": "https://api.entia.systems", "NODE_ENV": "production"}` |
| `create_dns_record` | `false` (DNS en Cloudflare, no Route53) |
| `health_check_path` | `/health` |
| `desired_count` | `1` (staging) / `2` (prod) |

---

## 7. DNS — Cloudflare

DNS en Cloudflare, no Route53. Terraform con `create_dns_record = false`.

Registro a crear manualmente en Cloudflare (Fase 4, tras ALB en pie):

```
Type:  CNAME
Name:  mcp-ts
Value: <ALB DNS name>.eu-west-1.elb.amazonaws.com
TTL:   Auto
Proxy: Proxied (naranja) — para protección CF + SSL termination
```

El CF Worker `entia-proxy` NO necesita cambios para `mcp-ts.entia.systems` — es subdominio nuevo, el Worker solo actúa en `entia.systems` (sin subdominio) y `mcp.entia.systems`. Confirmar que el Worker no capture `mcp-ts.*`.

---

## 8. Secuencia de comandos Fase 3 (referencia)

```bash
# 1. Crear ECR repo
aws ecr create-repository --repository-name entia-mcp-ts --region eu-west-1

# 2. Crear secret
aws secretsmanager create-secret --name entia/mcp-ts/api-key --region eu-west-1

# 3. Build + push imagen
cd ~/Desktop/entia-mcp-server-restored
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin 267673636179.dkr.ecr.eu-west-1.amazonaws.com
docker build -t entia-mcp-ts:v1.0.4 .
docker tag entia-mcp-ts:v1.0.4 267673636179.dkr.ecr.eu-west-1.amazonaws.com/entia-mcp-ts:v1.0.4
docker push 267673636179.dkr.ecr.eu-west-1.amazonaws.com/entia-mcp-ts:v1.0.4

# 4. Terraform apply (Opción A o B según decisión owner)
cd infra/terraform/entia-mcp-ts/
terraform init
terraform plan
terraform apply

# 5. DNS Cloudflare — CNAME mcp-ts → ALB
# (manual en CF dashboard o via CF API)

# 6. Smoke test
curl -s https://mcp-ts.entia.systems/health
# esperado: {"status":"ok","server":"entia-mcp","version":"1.0.4","transport":"http"}
```

---

## 9. Resumen de cambios necesarios

| Área | Cambios requeridos | Cambios NO requeridos |
|---|---|---|
| **Código TypeScript** | Ninguno | — |
| **Dockerfile** | Ninguno | — |
| **Env vars** | Crear secret `ENTIA_API_KEY` en AWS SM | Eliminar vars GCP (no existían) |
| **Env vars** | Añadir `ENTIA_API_BASE=https://api.entia.systems` en task definition | — |
| **ECR** | Crear repo `entia-mcp-ts` | — |
| **ECS** | Crear task definition + service (Terraform) | Modificar cluster existente `entia-api-prod` |
| **ALB** | Nuevo target group (Opción A: en ALB existente / Opción B: nuevo ALB) | — |
| **DNS** | CNAME `mcp-ts.entia.systems` → ALB en Cloudflare | Route53 (no usamos) |
| **CF Worker** | Ninguno — `mcp-ts.*` no capturado por Worker | — |

**Adaptación GCP → AWS: cero cambios en código. Solo infraestructura.**
