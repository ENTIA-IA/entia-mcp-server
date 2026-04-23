# Funnel web orchestration (ENTIA)

This repository now includes a deterministic backend orchestration module for the funnel described in the implementation memo.

## Module

- `entia_mcp/funnel.py`

## What it provides

- Lead creation with unique `journey_id` and initial state:
  - `lead_status=initiated`
  - `journey_stage=domain_submitted`
- Pre-audit classification fields:
  - `lead_type_preliminary`
  - `revenue_band`
  - `fit_segment`
  - `priority_score`
- OTP workflow with:
  - 6-digit codes
  - signed OTP token (HMAC)
  - default 10-minute expiration
  - resend limits
  - rate limiting by IP + email + session window
  - stateful verification gate before checkout/audit
- Payment and audit authorization transitions.
- Deterministic final route:
  - `pyme`
  - `advertiser`
  - `enterprise`
  - `unknown_review`
- Idempotent journey event tracking for observability dashboards.

## Event taxonomy currently emitted

- Domain / pre-audit:
  - `domain_submitted`
  - `pre_audit_completed`
- OTP:
  - `otp_requested`
  - `otp_sent`
  - `otp_resent`
  - `otp_verified`
  - `otp_failed`
  - `otp_expired`
  - `otp_abandoned`
- Checkout / payment:
  - `checkout_started`
  - `checkout_viewed`
  - `payment_attempted`
  - `payment_success`
  - `payment_failed`
  - `payment_abandoned`
- Audit / routing:
  - `audit_authorized`
  - `audit_completed`
  - `route_to_home`
- Journey telemetry:
  - `chatbot_interaction`
  - `journey_dropoff`

## Integration notes

This module is provider-agnostic by design. In production, wire it to:

- persistent storage (PostgreSQL, DynamoDB, etc.)
- OTP delivery service (SES, SMTP provider)
- payment gateway webhook processor
- audit workers
- internal dashboard sink

No secrets are handled in frontend code; OTP/payment/audit orchestration is intended for backend execution only.


## Input validation and safety guardrails

- Domain format is validated before journey creation.
- Email format is validated before journey creation.
- Disposable email domains are blocked by default (configurable).
- OTP and payment operations are guarded by deterministic state transitions to prevent invalid flow jumps.

## HTTP API wrapper (for rapid deployment / Codespaces)

A minimal FastAPI adapter is available at `entia_mcp/funnel_api.py`.

Run locally:

```bash
make setup
make run-funnel-api
```

Core endpoints:

- `POST /funnel/leads`
- `POST /funnel/{journey_id}/pre-audit`
- `POST /funnel/{journey_id}/otp/request`
- `POST /funnel/{journey_id}/otp/verify`
- `POST /funnel/{journey_id}/checkout`
- `POST /funnel/{journey_id}/payment`
- `POST /funnel/{journey_id}/authorize-audit`
- `GET /funnel/{journey_id}/events`
- `GET /health`
