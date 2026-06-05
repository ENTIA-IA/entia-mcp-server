# P0 Blockers — Verificación Pre-Fase 3
**Fecha:** 2026-05-10  
**Agente:** Claude Sonnet 4.6

---

## 1. VPC

```json
[["vpc-0350b6d3a3874cea6", "172.31.0.0/16", null]]
```

VPC única (default VPC). Sin Name tag. **Usable.**

---

## 2. Subnets

```json
[
  ["subnet-0945b90607c01dd79", "eu-west-1c", true,  "172.31.0.0/20"],
  ["subnet-0d7bb629a8b1291c8", "eu-west-1a", true,  "172.31.16.0/20"],
  ["subnet-01a9a85f5f580033a", "eu-west-1b", true,  "172.31.32.0/20"]
]
```

**⚠️ ISSUE 1: Solo subnets públicas (MapPublicIpOnLaunch=true en las 3).**  
El módulo Terraform original tiene `private_subnet_ids` para ECS tasks y `public_subnet_ids` para ALB.  
No hay subnets privadas en esta cuenta.

**Fix aplicado en Terraform (ver sección 6):** usar las mismas subnets públicas para ALB y ECS, con `assign_public_ip = true` en la ECS service. Válido para staging — los security groups limitan acceso ECS a solo el ALB.

Subnets a usar:
- ALB (public): `subnet-0d7bb629a8b1291c8` (1a), `subnet-0945b90607c01dd79` (1c), `subnet-01a9a85f5f580033a` (1b)
- ECS tasks (mismas): mismas 3

---

## 3. ACM Certificates

```json
[
  ["arn:aws:acm:eu-west-1:267673636179:certificate/71a5805a-cd24-45b2-8d63-879594059902", "api.entia.systems"],
  ["arn:aws:acm:eu-west-1:267673636179:certificate/9a87143b-9d95-40cf-8397-be17a9c1146e", "mcp.entia.systems"],
  ["arn:aws:acm:eu-west-1:267673636179:certificate/3ab943ae-3b0f-4e72-a0e6-df8a7f04f256", "api-mc.entia.systems"],
  ["arn:aws:acm:eu-west-1:267673636179:certificate/a66a197a-46b3-4acd-b3d7-ff3548e41e60", "mc-tools.entia.systems"],
  ["arn:aws:acm:eu-west-1:267673636179:certificate/8468bb06-3911-46cb-82e4-8312ebea9cd7", "mc-tools.entia.systems"]
]
```

**⚠️ ISSUE 2: No existe cert para `mcp-ts.entia.systems`.**  
No hay wildcard `*.entia.systems` en esta región.

**Fix aplicado:** Se solicita nuevo cert ACM para `mcp-ts.entia.systems` con DNS validation.  
Validación vía CNAME en Cloudflare (mismo patrón que los certs existentes).

Cert nuevo ARN: pendiente emisión — ver sección 6.

**Cert usado en Terraform:**  
`arn:aws:acm:eu-west-1:267673636179:certificate/<nuevo-mcp-ts>` (creado en este step)

---

## 4. Secrets Manager existentes

```json
[
  "entia/api-gateway/production",
  "Bright_Data",
  "entia/cloudflare/api-token",
  "events!connection/entia-email-queue-auth/a82afc03-9c59-420c-9fc8-a38bd4d4075f",
  "entia/mission-control",
  "entia/kh-webhook-signing-secret"
]
```

`entia/mcp-ts/api-key` **NO existe** — a crear en step 3b.

---

## 5. Resumen de blockers

| # | Issue | Severidad | Fix |
|---|---|---|---|
| 1 | Solo subnets públicas, no hay privadas | MINOR | Usar públicas para ECS + `assign_public_ip=true` |
| 2 | No cert para `mcp-ts.entia.systems` | BLOCKER | Solicitar nuevo ACM cert (DNS validation CF) |
| 3 | Secret `entia/mcp-ts/api-key` no existe | EXPECTED | Crear en step 3b |

Ningún blocker impide `terraform plan`. El cert ARN se obtiene en step 3a-previo.

---

## 6. Valores Terraform confirmados

```hcl
aws_region          = "eu-west-1"
vpc_id              = "vpc-0350b6d3a3874cea6"
public_subnet_ids   = ["subnet-0d7bb629a8b1291c8", "subnet-0945b90607c01dd79", "subnet-01a9a85f5f580033a"]
private_subnet_ids  = ["subnet-0d7bb629a8b1291c8", "subnet-0945b90607c01dd79", "subnet-01a9a85f5f580033a"]
                     # mismas públicas — adaptación por ausencia de subnets privadas
certificate_arn     = "<ARN del cert mcp-ts.entia.systems — pendiente emisión>"
container_image     = "267673636179.dkr.ecr.eu-west-1.amazonaws.com/entia-mcp-ts:v1.0.4"
desired_count       = 1
health_check_path   = "/health"
create_dns_record   = false
additional_environment = {
  ENTIA_API_BASE = "https://api.entia.systems"
  NODE_ENV       = "production"
}
secret_arns = {
  ENTIA_API_KEY = "arn:aws:secretsmanager:eu-west-1:267673636179:secret:entia/mcp-ts/api-key-<suffix>"
}
```
