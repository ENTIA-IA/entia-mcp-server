# Smoke Test — Real MCP Client Validation
**Fecha:** 2026-05-10
**Endpoint bajo prueba:** `https://mcp-ts.entia.systems/mcp/`
**Stack:** TypeScript v1.0.4 (commit `322b199`) en ECS Fargate eu-west-1, ALB proxied via Cloudflare
**Owner ejecuta:** Fer (manual desde Claude Desktop / Cursor local)
**Pre-requisitos verificados:** ✅ ALB target healthy · ✅ ECS rollout COMPLETED · ✅ Secret `entia/mcp-ts/api-key` actualizado con `ENTIA_MCP_INTERNAL_KEY` real (55 chars, prefix `entia-intern...`) · ✅ DNS `mcp-ts.entia.systems` → CF proxy → ALB · ✅ Handshake `initialize` ya devolvió 200 con `protocolVersion: 2024-11-05`

---

## Test 1 — Conexión cliente MCP

| Campo | Valor |
|---|---|
| Cliente | <!-- Claude Desktop o Cursor --> |
| Versión cliente | <!-- e.g. Claude Desktop 0.7.x --> |
| OS | <!-- macOS 25.2 --> |
| Resultado handshake | <!-- ÉXITO / FALLO --> |
| Tiempo conexión observado | <!-- ms o "instant" --> |

**Config usada (literal):**

```json
<!-- pegar el bloque mcp.json o equivalente — e.g. para Claude Desktop:
{
  "mcpServers": {
    "entia-ts": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp-ts.entia.systems/mcp/"]
    }
  }
}
-->
```

**Logs del cliente (si hubo fallo o warnings):**

```
<!-- pegar literal de Claude Desktop logs o Cursor output -->
```

**Veredicto:** <!-- PASS / FAIL -->

---

## Test 2 — tools/list

**Comando o prompt usado:**

```
<!-- e.g. "@entia-ts what tools do you have?" o el listado automático que muestra el cliente -->
```

**Tools devueltos por el server:**

<!-- pegar lista literal -->

```
1. <!-- entity_lookup -->
2. <!-- search_entities -->
3. <!-- get_entia_home -->
4. <!-- run_risk_audit -->
5. <!-- lookup_by_domain -->
6. <!-- get_platform_stats -->
```

**Esperado:** los 6 tools de v1.0.4 — `entity_lookup`, `search_entities`, `get_entia_home`, `run_risk_audit`, `lookup_by_domain`, `get_platform_stats`.

**Veredicto:** <!-- PASS / FAIL --> · ¿coinciden los 6 nombres?

---

## Test 3 — tools/call `entity_lookup` (público, sin auth requerida)

**Prompt:**

```
Usa entia-ts para buscar Telefonica
```

**Respuesta del cliente (literal):**

```json
<!-- pegar respuesta JSON o texto que devuelva el LLM tras procesar el tool result -->
```

**Datos clave a verificar:**

| Campo | Valor recibido | Esperado |
|---|---|---|
| Trust Score | <!-- e.g. 84 --> | 70-95 (Telefónica está VERIFIED) |
| Trust badge | <!-- VERIFIED/PARTIAL/UNVERIFIED --> | VERIFIED |
| `entity.name` | <!-- e.g. "Telefónica, S.A." --> | match |
| `entity.country_code` | <!-- ES --> | ES |
| Latencia observada | <!-- ms aprox --> | <3s aceptable, <1s ideal |

**Veredicto:** <!-- PASS / FAIL -->

---

## Test 4 — tools/call `search_entities` (auth required, valida la API key inyectada)

**Prompt:**

```
Usa entia-ts search_entities con country=ES y q=BBVA
```

Este tool **requiere** que el server tenga `ENTIA_API_KEY` válida. Si la key inyectada desde `entia/mcp-ts/api-key` es correcta, el backend Python en `api.entia.systems` la valida contra DynamoDB `entia_mcp_auth` (tier `internal` o `pro`) y devuelve resultados. Si la key fuese inválida, el tool devolvería 401.

**Respuesta del cliente (literal):**

```json
<!-- pegar respuesta -->
```

**Datos clave:**

| Campo | Valor recibido | Esperado |
|---|---|---|
| Número de resultados | <!-- e.g. 5 --> | >0 (BBVA matchea varios registros) |
| Status HTTP backend | <!-- 200 esperado, 401 si key inválida --> | 200 |
| Mensaje error (si lo hay) | <!-- — --> | ninguno |
| Latencia | <!-- ms --> | <3s |

**Veredicto:** <!-- PASS / FAIL --> · La inyección de `ENTIA_MCP_INTERNAL_KEY` desde `entia/api-gateway/production` al placeholder `entia/mcp-ts/api-key-8TX3B3` es correcta si este test pasa.

---

## Logs server-side durante los 4 tests

**Comando usado:**

```bash
aws logs tail /ecs/entia-mcp-ts-staging --region eu-west-1 --since 30m
```

**Output literal (últimas 50 líneas relevantes):**

```
<!-- pegar log lines -->
```

**Errores detectados:** <!-- ninguno / lista -->
**Warnings detectados:** <!-- ninguno / lista -->
**Latencia interna observada en logs (si aparece):** <!-- ms -->

---

## Veredicto global

| Test | Estado |
|---|---|
| 1. Conexión + handshake | <!-- PASS/FAIL --> |
| 2. tools/list devuelve 6 | <!-- PASS/FAIL --> |
| 3. entity_lookup público | <!-- PASS/FAIL --> |
| 4. search_entities autenticado | <!-- PASS/FAIL --> |

**Resultado:** <!-- 4/4 PASS o N/4 PASS con detalle -->

### Decisión

- **Si 4/4 PASS** → autorización para preparar plan de switch DNS `mcp.entia.systems` → `mcp-ts` para mañana, con doc + rollback claro.
- **Si <4/4** → diagnóstico antes de switch:
  - Cruzar logs del cliente con logs ECS
  - Identificar punto exacto de fallo (transport / sesión / tool handler / backend call / auth)
  - No tocar producción Python (rev 140) hasta resolución

---

## Anexo — Bloqueantes operativos a tener en cuenta durante los tests

| Bloqueante | Detalle |
|---|---|
| **Cloudflare timeout 100s** | El proxy CF puede cortar SSE largos. Si `run_risk_audit` (30s timeout en código) parece colgarse, no es el server, es CF. |
| **TLS terminado en CF** | Cert ACM emitido para `mcp-ts.entia.systems` está dormido — CF usa su cert universal. No es problema, es by design del proxy mode. |
| **API key shared con producción** | El secret `entia/mcp-ts/api-key` ahora contiene la MISMA key que `ENTIA_MCP_INTERNAL_KEY` del API gateway. Si revocas esta key, también rompe llamadas internas del gateway. Considerar key dedicada antes del switch DNS. |
| **Session-based architecture** | El server espera que cada cliente abra sesión vía POST `/mcp` con `initialize`. GET sin sessionId devuelve 400. Esto es correcto pero si el cliente intenta GET primero (algunos lo hacen para health) verá 400 — no confundir con caída del server. |
