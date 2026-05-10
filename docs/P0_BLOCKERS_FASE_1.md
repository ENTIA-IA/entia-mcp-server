# P0 Blockers — Verificación Fase 1
**Fecha:** 2026-05-10  
**Agente:** Claude Sonnet 4.6  
**Branch verificada:** `restore-typescript-v1.0.6` (commit `322b199`)  
**Repo:** `github.com/ENTIA-IA/entia-mcp-server` → `~/Desktop/entia-mcp-server-restored/`

---

## 1. Acceso al repo

```
gh repo clone ENTIA-IA/entia-mcp-server ~/Desktop/entia-mcp-server-restored
git checkout restore-typescript-v1.0.6

Output:
  Clonando en '/Users/fernandovilches/Desktop/entia-mcp-server-restored'...
  Cambiado a nueva rama 'restore-typescript-v1.0.6'
  rama 'restore-typescript-v1.0.6' configurada para rastrear 'origin/restore-typescript-v1.0.6'

git log --oneline -5:
  322b199 docs: final session state — v1.0.6 security + governance + session log
  05af5ba feat: per-client rate limiting — protects upstream API + controls cost
  9955ce6 feat: client identity tracking — who calls us, from where
  7b54d43 docs: session log + governance update to v1.0.4
  1b7ee33 security: fix 1 CRITICAL + 2 HIGH + 3 MEDIUM + add ENTIA icon
```

**VEREDICTO: ✅ GREEN** — Repo clonado, branch correcta, commit `322b199` confirmado.

---

## 2. Endpoints backend

Comandos ejecutados (GET, no HEAD):

```bash
curl -s -o /dev/null -w "%{http_code}" https://api.entia.systems/v1/stats
curl -s -o /dev/null -w "%{http_code}" "https://api.entia.systems/v1/search?q=test&country=ES"
curl -s -o /dev/null -w "%{http_code}" https://api.entia.systems/v1/verify/vat/ESB12345678
curl -s -o /dev/null -w "%{http_code}" https://api.entia.systems/v1/profile/test
```

Output literal:
```
200   ← /v1/stats       (no auth requerida — stats públicas)
401   ← /v1/search      (endpoint vivo, auth requerida)
401   ← /v1/verify/vat  (endpoint vivo, auth requerida)
401   ← /v1/profile     (endpoint vivo, auth requerida)
```

Criterio del brief: 200 o 401 = OK. 404 = endpoint cambió (STOP).

**VEREDICTO: ✅ GREEN** — Los 4 endpoints existen y responden. Ningún 404. El TypeScript los podrá llamar en cuanto tenga `ENTIA_API_KEY` válida.

---

## 3. Auth: DynamoDB vs pass-through

Comandos ejecutados:

```bash
grep -ri -E "dynamo|aws-sdk|@aws-sdk" src/
grep -ri "api.entia" src/
```

Output literal:
```
# DynamoDB/aws-sdk:
NO DYNAMODB REFS

# api.entia / backend refs:
src/logger.ts:    api_key_hash: hashKey(config.ENTIA_API_KEY),
src/client.ts:    this.baseUrl = config.ENTIA_API_BASE;
src/client.ts:    this.apiKey = config.ENTIA_API_KEY;
src/client.ts:      throw new Error('ENTIA_API_KEY required...');
src/server.ts:        auth: requiresAuth && !!config.ENTIA_API_KEY,
src/config.ts:  ENTIA_API_BASE: process.env.ENTIA_API_BASE ?? 'https://entia.systems',
src/config.ts:  ENTIA_API_KEY: process.env.ENTIA_API_KEY ?? '',
src/tools/get_entia_home.ts:  const url = `${config.ENTIA_API_BASE}${path}`;
```

**Conclusión:** El TypeScript hace puro header pass-through. Lee `ENTIA_API_KEY` del env var y lo manda como `x-entia-api-key` al backend Python (`api.entia.systems`). El backend valida contra DynamoDB `entia_mcp_auth`. El ECS task del TypeScript **NO necesita IAM a DynamoDB**. La task role del Terraform solo necesita S3 read (para DuckDB httpfs si se usa) y Secrets Manager (para leer el API key).

**VEREDICTO: ✅ GREEN** — No IAM a DynamoDB requerido. Auth es pass-through vía env var.

### Config env vars completo (src/config.ts)

| Env var | Default | Notas |
|---|---|---|
| `ENTIA_API_BASE` | `https://entia.systems` | CF Worker ruta `/v1/*` a ECS. OK así, o cambiar a `https://api.entia.systems` para bypass Worker. Recomiendo `api.entia.systems` en prod para eliminar hop extra. |
| `ENTIA_API_KEY` | `''` | Clave MCP válida en `entia_mcp_auth` DynamoDB. Requerida — sin ella tools autenticadas fallan. |
| `MCP_TRANSPORT` | `stdio` | **Cambiar a `http` en ECS.** stdio es para Claude Code local. HTTP es para clientes remotos (Claude Desktop, Cursor). |
| `MCP_PORT` | `3000` | Puerto HTTP. ECS Fargate + ALB target group deben apuntar aquí. |

No hay referencias a variables GCP (`GOOGLE_*`, `BIGQUERY_*`, `CLOUD_RUN_*`). **Cero adaptación de env vars GCP necesaria.**

---

## 4. Terraform

Comando ejecutado:
```bash
find ~/Desktop -name "*.tf" -path "*entia*" 2>/dev/null
ls ~/Desktop/entia-mcp-server-restored/infra/
```

Output literal:
```
/Users/fernandovilches/Desktop/entia-mcp-server-ts/infra/aws/outputs.tf
/Users/fernandovilches/Desktop/entia-mcp-server-ts/infra/aws/main.tf
/Users/fernandovilches/Desktop/entia-mcp-server-ts/infra/aws/versions.tf
/Users/fernandovilches/Desktop/entia-mcp-server-ts/infra/aws/variables.tf

NO infra/ dir   ← en entia-mcp-server-restored
```

Módulo Terraform encontrado en `~/Desktop/entia-mcp-server-ts/infra/aws/`.

### ⚠️ DECISION PENDIENTE OWNER — Cluster strategy

El módulo crea **su propio `aws_ecs_cluster`** (nuevo, independiente). El brief dice *"cluster `entia-api-prod` ya existente, NO recrear — service nuevo `entia-mcp-ts` paralelo"*.

Hay 2 opciones:

| Opción | Pros | Contras |
|---|---|---|
| **A — Usar `entia-api-prod` existente** (solo task_definition + service + target_group) | Sin nuevo ALB, sin nuevo cluster, coste mínimo. Service vive junto a `entia-api-gateway` | Hay que extraer solo las partes ECS del módulo, no usarlo completo. Más trabajo Terraform. |
| **B — Stack standalone** (lo que el módulo ya hace: nuevo cluster + ALB) | Módulo completo listo, isolado, fácil de destruir si no funciona | Nuevo ALB = costo extra ~$16/mes. DNS apunta al nuevo ALB, no al existente. |

El módulo existente tiene `create_dns_record = false` por defecto (bien — DNS está en Cloudflare, no Route53).

**Sin decisión owner no avanzo a Fase 3 (Terraform).** Fase 1 y Fase 2 no la necesitan.

---

## Resumen ejecutivo

| Check | Estado | Bloqueante Fase 1 |
|---|---|---|
| Repo clonado, branch correcta | ✅ GREEN | No |
| 4 endpoints backend vivos (200/401) | ✅ GREEN | No |
| Auth: pure pass-through, 0 IAM DynamoDB | ✅ GREEN | No |
| Env vars: 0 vars GCP, 4 vars simples | ✅ GREEN | No |
| Terraform: módulo existe, cluster strategy pendiente | ⚠️ DECISION | **No para Fase 1 ni 2. Sí para Fase 3.** |

**Fase 1 autorizada para arrancar.** Los 3 checks requeridos están limpios. Blocker de Terraform es Fase 3, no ahora.
