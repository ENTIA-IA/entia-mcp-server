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
  - default 10-minute expiration
  - resend limits
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
- Checkout / payment:
  - `checkout_started`
  - `checkout_viewed`
  - `payment_attempted`
  - `payment_success`
  - `payment_failed`
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
