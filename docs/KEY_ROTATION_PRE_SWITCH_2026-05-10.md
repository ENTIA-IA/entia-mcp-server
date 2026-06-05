# Key Rotation — Pre-Switch DNS Runbook
**Fecha:** 2026-05-10
**Bloqueante para:** switch DNS `mcp.entia.systems` → `mcp-ts.entia.systems`
**Estado:** RUNBOOK PREPARADO, NO EJECUTADO. Espera 4/4 PASS en `SMOKE_REAL_CLIENT_2026-05-10.md` antes de ejecutar — rotar mid-smoke invalida la task.

---

## 1. Problema (deuda técnica detectada por owner)

El secret `entia/mcp-ts/api-key-8TX3B3` actualmente contiene la **misma string** que `ENTIA_MCP_INTERNAL_KEY` del secret `entia/api-gateway/production`. La copiamos así porque era la key conocida que valida contra el backend, pero esto crea un acoplamiento no deseado:

- Rotar la key del MCP TS rompe el API gateway production.
- Rotar la key del API gateway rompe el MCP TS.
- Auditoría / revocación / reset por incidente: imposible aislar el blast radius.

**Inviolable antes del switch DNS:** desacoplar las 2 superficies.

---

## 2. Hallazgos durante la preparación del runbook

### 2.1 Tabla DDB real

CLAUDE.md (sección 15C) referencia `entia_mcp_auth` como la fuente de validación. **Esa tabla no existe en eu-west-1**. La tabla real es `entia_mcp_api_keys`.

```bash
aws dynamodb describe-table --table-name entia_mcp_api_keys --region eu-west-1
# Items: 3, key: id (HASH, S, SHA-256 hash de la raw key)
```

3 entries actuales, todas con tiers comerciales (signal/build/integrate), ninguna marcada `internal` o `pro`:

| id (hash, prefix) | tier | active |
|---|---|---|
| `ea6c7961...` | signal | true |
| `f99bd78e...` | build | true |
| `0fda99c7...` | integrate | true |

### 2.2 La key compartida actual NO está en esa tabla

`ENTIA_MCP_INTERNAL_KEY` empieza con `entia-intern...`. Las keys comerciales empiezan con `entia_live_*`. La key compartida es un **bypass interno** del API gateway — su lógica de validación está en código del gateway (probablemente en `core/mcp_auth.py` o `core/mcp_gate_middleware.py`), no en DDB.

**Implicación crítica:** si añadimos una key tier `integrate` a DDB y la usamos para el MCP TS, esa key:

- Pasará por **rate limiting** (10K req/mes en tier integrate)
- Generará **billing Stripe** (€149/mes en tier integrate)
- Estará sujeta a **quota enforcement** y se bloqueará al consumirse

Eso es CORRECTO para un cliente externo, pero **incorrecto** para llamadas server-to-server del TS MCP al backend Python (es infra interna, no debería sangrar billing ni quota).

### 2.3 Consecuencia: hay 2 caminos posibles

| Camino | Qué hace | Pros | Contras |
|---|---|---|---|
| **A — Internal bypass dedicado** | Crear segunda key `entia-internal-mcp-ts-{hash}` con la misma lógica de bypass del gateway. Sin DDB. Sin billing. Sin quota. | Coherente con el patrón actual. Cero coste. Cero quota concerns. | Requiere tocar `core/mcp_auth.py` (Sacred Group A — necesita orden explícita). Hay que ver cómo el gateway resuelve el bypass hoy: ¿hardcoded?, ¿Secrets Manager?, ¿lista en config? |
| **B — Tier comercial dedicado** | Generar key `entia_live_*` tier `internal`/`pro` (si esos tiers existen en `core/mcp/plans.py`) y guardarla en DDB con `owner=entia-mcp-ts-server`. | No toca código del gateway. Aprovecha infra existente. | Si el tier `internal` no está en el ladder actual de Stripe (revisión 2026-04-28: trace/signal/build/integrate/operate/scale/enterprise), genera billing real. |

**Owner decide qué camino antes de ejecutar el runbook.**

---

## 3. Pregunta a resolver antes de ejecutar

¿Cómo valida hoy `api.entia.systems` la key `entia-intern...` que estamos compartiendo? Sin esa respuesta, no se puede crear una "dedicated internal key" sin riesgo de generar una key que no funcione.

Comandos para responder (owner ejecuta o autoriza al agente):

```bash
# 1. Buscar literal de bypass en el código del gateway
cd "/Users/fernandovilches/Desktop/ENTIA Lanzamiento"
grep -rn "ENTIA_MCP_INTERNAL_KEY\|entia-intern\|internal_bypass\|is_internal_key" core/ api_gateway.py

# 2. Confirmar dónde se carga
grep -rn "ENTIA_MCP_INTERNAL_KEY" core/ api_gateway.py

# 3. Ver si hay un patrón de "lista de keys internas válidas" o "comparación contra single value"
```

Output esperado: 1 archivo (probablemente `core/mcp_auth.py`) con o bien:
- (a) Comparación literal contra `os.environ["ENTIA_MCP_INTERNAL_KEY"]` → entonces internal-bypass es **single key, no extensible** sin código nuevo.
- (b) Validación contra una lista en config / Secret Manager → entonces se puede añadir una segunda.
- (c) Validación por prefix `entia-internal-*` o regex → entonces se puede generar otra key con ese formato sin tocar código.

---

## 4. Runbook ejecutable (BLOQUEADO hasta resolución de §3)

### Pre-condiciones

- [ ] `SMOKE_REAL_CLIENT_2026-05-10.md` con 4/4 PASS firmado por owner.
- [ ] Owner confirma camino: A (internal bypass) o B (tier comercial).
- [ ] §3 resuelto — sabemos cómo el gateway valida la key compartida.

### Camino A — Internal bypass dedicado (preferido si es viable)

```bash
# A.1 — Generar nueva key
NEW_KEY="entia-internal-mcp-ts-$(openssl rand -hex 20)"
echo "$NEW_KEY" | wc -c   # debe ser 56 (= 14 prefix + 40 hex + 1 newline)

# A.2 — Añadir a la fuente de validación
#       (depende de §3 — instrucción exacta a confirmar):
#       (a) Si single-value: NO VIABLE en camino A — saltar a B.
#       (b) Si lista en Secret Manager:
#           - Recuperar secret actual, añadir entry, update.
#       (c) Si por prefix: simplemente almacenarla en entia/mcp-ts/api-key
#           — el gateway la aceptará por matchear el prefix.

# A.3 — Update secret con la nueva key
aws secretsmanager update-secret \
  --secret-id entia/mcp-ts/api-key \
  --secret-string "$NEW_KEY" \
  --region eu-west-1

# A.4 — Force redeploy
aws ecs update-service \
  --cluster entia-mcp-ts-staging-cluster \
  --service entia-mcp-ts-staging-service \
  --force-new-deployment \
  --region eu-west-1

# A.5 — Esperar rollout COMPLETED + target healthy
until aws ecs describe-services --cluster entia-mcp-ts-staging-cluster \
  --services entia-mcp-ts-staging-service --region eu-west-1 \
  --query 'services[0].deployments[?status==`PRIMARY`]|[0].rolloutState' \
  --output text | grep -q COMPLETED; do sleep 10; done

# A.6 — Smoke test breve (entity_lookup público + search_entities autenticado)
#       Reusa el procedimiento del Test 3 y Test 4 de SMOKE_REAL_CLIENT_2026-05-10.md.
#       Si search_entities devuelve resultados → key dedicada valida → PASS.

unset NEW_KEY
```

### Camino B — Tier comercial dedicado (fallback)

```bash
# B.1 — Verificar que existe un tier interno/sin coste en el ladder
cd "/Users/fernandovilches/Desktop/ENTIA Lanzamiento"
grep -A 3 "TIER_LADDER\|class Plan\b\|tier=" core/mcp/plans.py | head -60
# Buscar "internal" o "infra" sin Stripe price ID.
# Si NO existe → owner decide: añadir uno (toca core/mcp/plans.py — Sacred Group A) o asumir billing.

# B.2 — Generar key con script existente
python3 scripts/create_mcp_api_key.py \
  --tier <internal-o-equivalente> \
  --email entia-mcp-ts-server@entia.systems \
  --label "entia-mcp-ts-staging-server-to-server"
# Output: raw key (entia_live_*), guardar en variable RAW_KEY.
# Script computa SHA-256 y escribe a entia_mcp_api_keys.

# B.3 — Update secret
aws secretsmanager update-secret \
  --secret-id entia/mcp-ts/api-key \
  --secret-string "$RAW_KEY" \
  --region eu-west-1

# B.4 — B.6 idéntico a A.4 — A.6.

unset RAW_KEY
```

### Post-condiciones (ambos caminos)

- [ ] Secret `entia/mcp-ts/api-key` contiene una key DISTINTA a `ENTIA_MCP_INTERNAL_KEY` del API gateway.
- [ ] ECS service rollout COMPLETED, 1/1 healthy.
- [ ] Smoke breve (entity_lookup + search_entities) PASS con la nueva key.
- [ ] Documentar: en `entia_mcp_api_keys` (camino B) la nueva entry tiene `owner = entia-mcp-ts-server` y `description` clara. En camino A: anotar en doc dónde vive la lista de internal-bypass keys.
- [ ] Atomic commit: `chore(security): rotate mcp-ts key — decoupled from gateway internal key`.

---

## 5. Update CLAUDE.md (deuda colateral)

Sección 15C de CLAUDE.md menciona `entia_mcp_auth` como tabla DDB. **Eso es legado GCP y nunca migró literalmente al post-AWS.** La tabla real en eu-west-1 es `entia_mcp_api_keys`. Update propuesto:

```diff
- DynamoDB `entia_mcp_auth` (tier internal o pro)
+ DynamoDB `entia_mcp_api_keys` (tiers actuales: trace/signal/build/integrate/operate/scale/enterprise — ver core/mcp/plans.py).
+ Adicionalmente, hay una key especial `ENTIA_MCP_INTERNAL_KEY` para llamadas internas (bypass de quota/billing).
```

Esto se hace en commit separado, fuera del scope de este runbook, una vez se confirme cuál es el patrón real del internal bypass.

---

## 6. Por qué no se ejecuta ahora

1. Owner está corriendo smoke test contra la key compartida actual. Rotarla mid-smoke invalida la task ECS y rompe los tests.
2. §3 está sin resolver — generar una key sin saber cómo se valida es probabilidad alta de servir 401 al MCP server.
3. La elección camino A vs B requiere decisión de owner (impacta billing, código, blast radius).

**Espera secuencial:** smoke 4/4 PASS → resolver §3 → owner elige A o B → ejecutar runbook → verificar → atomic commit → autorizar plan switch DNS.
