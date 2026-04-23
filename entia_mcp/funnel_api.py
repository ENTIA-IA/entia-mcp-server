"""FastAPI wrapper for FunnelService (one-command local runtime)."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from entia_mcp.funnel import FunnelService, FunnelStateError, FunnelValidationError

app = FastAPI(title="ENTIA Funnel API", version="0.1.0")
service = FunnelService()


class SubmitDomainRequest(BaseModel):
    domain: str
    email: str
    cif: str | None = None
    ip_address: str | None = None
    session_id: str | None = None


class PreAuditRequest(BaseModel):
    lead_type_preliminary: str
    revenue_band: str
    fit_segment: str
    priority_score: int = Field(ge=0, le=100)


class VerifyOtpRequest(BaseModel):
    submitted_code: str = Field(min_length=6, max_length=6)
    submitted_token: str


class CheckoutRequest(BaseModel):
    checkout_mode: str


class PaymentRequest(BaseModel):
    success: bool
    provider_ref: str


def _serialize_journey(journey: Any) -> dict[str, Any]:
    data = asdict(journey)
    if data.get("lead_status"):
        data["lead_status"] = journey.lead_status.value
    if data.get("journey_stage"):
        data["journey_stage"] = journey.journey_stage.value
    if data.get("route_to_home"):
        data["route_to_home"] = journey.route_to_home.value
    return data


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/funnel/leads")
def submit_domain(payload: SubmitDomainRequest) -> dict[str, Any]:
    try:
        journey = service.submit_domain(**payload.model_dump())
        return {"journey": _serialize_journey(journey)}
    except FunnelValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/funnel/{journey_id}/pre-audit")
def apply_pre_audit(journey_id: str, payload: PreAuditRequest) -> dict[str, Any]:
    try:
        journey = service.apply_pre_audit(journey_id, **payload.model_dump())
        return {"journey": _serialize_journey(journey)}
    except (FunnelStateError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/funnel/{journey_id}/otp/request")
def request_otp(journey_id: str) -> dict[str, Any]:
    try:
        journey, challenge = service.request_otp(journey_id)
        return {
            "journey": _serialize_journey(journey),
            "otp_challenge": {"code": challenge.code, "token": challenge.token},
        }
    except (FunnelStateError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/funnel/{journey_id}/otp/verify")
def verify_otp(journey_id: str, payload: VerifyOtpRequest) -> dict[str, Any]:
    try:
        journey = service.verify_otp(journey_id, **payload.model_dump())
        return {"journey": _serialize_journey(journey)}
    except (FunnelStateError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/funnel/{journey_id}/checkout")
def begin_checkout(journey_id: str, payload: CheckoutRequest) -> dict[str, Any]:
    try:
        journey = service.begin_checkout(journey_id, **payload.model_dump())
        return {"journey": _serialize_journey(journey)}
    except (FunnelStateError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/funnel/{journey_id}/payment")
def register_payment(journey_id: str, payload: PaymentRequest) -> dict[str, Any]:
    try:
        journey = service.register_payment(journey_id, **payload.model_dump())
        return {"journey": _serialize_journey(journey)}
    except (FunnelStateError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/funnel/{journey_id}/authorize-audit")
def authorize_audit(journey_id: str) -> dict[str, Any]:
    try:
        journey = service.authorize_audit(journey_id)
        return {"journey": _serialize_journey(journey)}
    except (FunnelStateError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/funnel/{journey_id}/events")
def journey_events(journey_id: str) -> dict[str, Any]:
    try:
        events = service.list_events(journey_id)
        return {
            "events": [
                {
                    "journey_id": e.journey_id,
                    "name": e.name,
                    "timestamp": e.timestamp.isoformat(),
                    "context": e.context,
                }
                for e in events
            ]
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
