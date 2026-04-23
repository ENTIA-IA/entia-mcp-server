"""Deterministic lead journey orchestration for ENTIA funnel workflows."""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from hashlib import sha256
from secrets import randbelow
from typing import Any
from uuid import uuid4


class LeadStatus(str, Enum):
    initiated = "initiated"
    pre_audited = "pre_audited"
    otp_pending = "otp_pending"
    otp_verified = "otp_verified"
    checkout_started = "checkout_started"
    payment_success = "payment_success"
    payment_failed = "payment_failed"
    payment_abandoned = "payment_abandoned"
    audit_authorized = "audit_authorized"
    routed = "routed"
    abandoned = "abandoned"


class JourneyStage(str, Enum):
    domain_submitted = "domain_submitted"
    pre_audit_completed = "pre_audit_completed"
    otp_requested = "otp_requested"
    otp_verified = "otp_verified"
    checkout_viewed = "checkout_viewed"
    payment_completed = "payment_completed"
    audit_completed = "audit_completed"
    route_decided = "route_decided"
    dropped = "dropped"


class RouteToHome(str, Enum):
    pyme = "pyme"
    advertiser = "advertiser"
    enterprise = "enterprise"
    unknown_review = "unknown_review"


@dataclass(frozen=True)
class FunnelEvent:
    journey_id: str
    name: str
    timestamp: datetime
    context: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OTPChallenge:
    code: str
    token: str


@dataclass
class OTPState:
    code_hash: str
    token: str
    expires_at: datetime
    attempts: int = 0
    resend_count: int = 0
    verified: bool = False


@dataclass
class LeadJourney:
    journey_id: str
    domain: str
    email: str
    cif: str | None
    ip_address: str | None
    session_id: str | None
    lead_status: LeadStatus
    journey_stage: JourneyStage
    lead_type_preliminary: str | None = None
    revenue_band: str | None = None
    fit_segment: str | None = None
    priority_score: int | None = None
    route_to_home: RouteToHome | None = None
    checkout_mode: str | None = None
    payment_status: str | None = None
    otp: OTPState | None = None


class FunnelStateError(ValueError):
    """Raised when a transition violates deterministic funnel state rules."""


class FunnelValidationError(ValueError):
    """Raised when input payload is malformed or disallowed."""


class FunnelService:
    """In-memory deterministic journey manager with idempotent event registry."""

    _DOMAIN_RE = re.compile(r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[A-Za-z]{2,}$")
    _EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    def __init__(
        self,
        *,
        otp_ttl_minutes: int = 10,
        otp_max_resends: int = 3,
        otp_rate_limit_window_minutes: int = 10,
        otp_max_requests_per_window: int = 5,
        otp_signing_secret: str = "entia-dev-secret",
        blocked_email_domains: set[str] | None = None,
    ) -> None:
        self.otp_ttl_minutes = otp_ttl_minutes
        self.otp_max_resends = otp_max_resends
        self.otp_rate_limit_window_minutes = otp_rate_limit_window_minutes
        self.otp_max_requests_per_window = otp_max_requests_per_window
        self.otp_signing_secret = otp_signing_secret
        self.blocked_email_domains = blocked_email_domains or {
            "mailinator.com",
            "guerrillamail.com",
            "10minutemail.com",
        }
        self._journeys: dict[str, LeadJourney] = {}
        self._event_fingerprints: set[str] = set()
        self._events: list[FunnelEvent] = []
        self._otp_request_counters: dict[str, list[datetime]] = {}

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _hash(value: str) -> str:
        return sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _route_from_pre_audit(priority_score: int, fit_segment: str) -> RouteToHome:
        if fit_segment in {"enterprise", "unknown_review"}:
            return RouteToHome.enterprise if fit_segment == "enterprise" else RouteToHome.unknown_review
        if fit_segment in {"advertiser", "agency"} or priority_score >= 75:
            return RouteToHome.advertiser
        return RouteToHome.pyme

    def _sign_otp_token(self, *, journey_id: str, email: str, code_hash: str, expires_at: datetime) -> str:
        payload = f"{journey_id}:{email}:{code_hash}:{int(expires_at.timestamp())}"
        return hmac.new(self.otp_signing_secret.encode("utf-8"), payload.encode("utf-8"), sha256).hexdigest()

    def _validate_domain_and_email(self, domain: str, email: str) -> tuple[str, str]:
        domain_norm = domain.lower().strip()
        email_norm = email.lower().strip()
        if not self._DOMAIN_RE.match(domain_norm):
            raise FunnelValidationError("Invalid domain format")
        if not self._EMAIL_RE.match(email_norm):
            raise FunnelValidationError("Invalid email format")
        email_domain = email_norm.split("@", 1)[1]
        if email_domain in self.blocked_email_domains:
            raise FunnelValidationError("Disposable email domains are blocked")
        return domain_norm, email_norm

    def _record_event(self, journey_id: str, event_name: str, context: dict[str, Any] | None = None) -> None:
        payload = context or {}
        fingerprint = self._hash(f"{journey_id}:{event_name}:{sorted(payload.items())}")
        if fingerprint in self._event_fingerprints:
            return
        self._event_fingerprints.add(fingerprint)
        self._events.append(
            FunnelEvent(journey_id=journey_id, name=event_name, timestamp=self._now(), context=payload)
        )

    def _rate_limit_key(self, journey: LeadJourney) -> str:
        return f"{journey.ip_address or 'ip:unknown'}|{journey.email}|{journey.session_id or 'session:unknown'}"

    def _enforce_otp_rate_limit(self, journey: LeadJourney) -> None:
        key = self._rate_limit_key(journey)
        now = self._now()
        window_start = now - timedelta(minutes=self.otp_rate_limit_window_minutes)
        timestamps = [ts for ts in self._otp_request_counters.get(key, []) if ts >= window_start]
        if len(timestamps) >= self.otp_max_requests_per_window:
            raise FunnelStateError("OTP rate limit exceeded")
        timestamps.append(now)
        self._otp_request_counters[key] = timestamps

    def get_journey(self, journey_id: str) -> LeadJourney:
        if journey_id not in self._journeys:
            raise KeyError(f"Unknown journey_id={journey_id}")
        return self._journeys[journey_id]

    def list_events(self, journey_id: str | None = None) -> list[FunnelEvent]:
        if journey_id is None:
            return list(self._events)
        return [event for event in self._events if event.journey_id == journey_id]

    def submit_domain(
        self,
        *,
        domain: str,
        email: str,
        cif: str | None = None,
        ip_address: str | None = None,
        session_id: str | None = None,
    ) -> LeadJourney:
        domain_norm, email_norm = self._validate_domain_and_email(domain, email)
        journey_id = str(uuid4())
        journey = LeadJourney(
            journey_id=journey_id,
            domain=domain_norm,
            email=email_norm,
            cif=cif,
            ip_address=ip_address,
            session_id=session_id,
            lead_status=LeadStatus.initiated,
            journey_stage=JourneyStage.domain_submitted,
        )
        self._journeys[journey_id] = journey
        self._record_event(journey_id, "domain_submitted", {"domain": journey.domain})
        return journey

    def apply_pre_audit(
        self,
        journey_id: str,
        *,
        lead_type_preliminary: str,
        revenue_band: str,
        fit_segment: str,
        priority_score: int,
    ) -> LeadJourney:
        journey = self.get_journey(journey_id)
        journey.lead_type_preliminary = lead_type_preliminary
        journey.revenue_band = revenue_band
        journey.fit_segment = fit_segment
        journey.priority_score = priority_score
        journey.lead_status = LeadStatus.pre_audited
        journey.journey_stage = JourneyStage.pre_audit_completed
        journey.route_to_home = self._route_from_pre_audit(priority_score, fit_segment)
        self._record_event(
            journey_id,
            "pre_audit_completed",
            {
                "lead_type_preliminary": lead_type_preliminary,
                "revenue_band": revenue_band,
                "fit_segment": fit_segment,
                "priority_score": priority_score,
                "route_to_home_preliminary": journey.route_to_home.value,
            },
        )
        return journey

    def request_otp(self, journey_id: str) -> tuple[LeadJourney, OTPChallenge]:
        journey = self.get_journey(journey_id)
        if journey.lead_status not in {LeadStatus.pre_audited, LeadStatus.otp_pending}:
            raise FunnelStateError("OTP can only be requested after pre-audit")
        if journey.otp and journey.otp.resend_count >= self.otp_max_resends:
            raise FunnelStateError("Maximum OTP resends exceeded")

        self._enforce_otp_rate_limit(journey)

        otp_value = f"{randbelow(1_000_000):06d}"
        now = self._now()
        expires_at = now + timedelta(minutes=self.otp_ttl_minutes)
        code_hash = self._hash(otp_value)
        token = self._sign_otp_token(
            journey_id=journey.journey_id,
            email=journey.email,
            code_hash=code_hash,
            expires_at=expires_at,
        )
        resend_count = journey.otp.resend_count + 1 if journey.otp else 0

        journey.otp = OTPState(
            code_hash=code_hash,
            token=token,
            expires_at=expires_at,
            resend_count=resend_count,
        )
        journey.lead_status = LeadStatus.otp_pending
        journey.journey_stage = JourneyStage.otp_requested

        self._record_event(journey_id, "otp_requested", {})
        self._record_event(journey_id, "otp_sent", {"resend_count": resend_count})
        if resend_count:
            self._record_event(journey_id, "otp_resent", {"resend_count": resend_count})

        return journey, OTPChallenge(code=otp_value, token=token)

    def verify_otp(self, journey_id: str, *, submitted_code: str, submitted_token: str) -> LeadJourney:
        journey = self.get_journey(journey_id)
        otp_state = journey.otp
        if not otp_state:
            raise FunnelStateError("No OTP requested")
        if otp_state.verified:
            return journey
        if self._now() > otp_state.expires_at:
            self._record_event(journey_id, "otp_expired", {})
            raise FunnelStateError("OTP expired")

        otp_state.attempts += 1
        if submitted_token != otp_state.token or self._hash(submitted_code) != otp_state.code_hash:
            self._record_event(journey_id, "otp_failed", {"attempt": otp_state.attempts})
            raise FunnelStateError("Invalid OTP")

        otp_state.verified = True
        journey.lead_status = LeadStatus.otp_verified
        journey.journey_stage = JourneyStage.otp_verified
        self._record_event(journey_id, "otp_verified", {})
        return journey

    def begin_checkout(self, journey_id: str, *, checkout_mode: str) -> LeadJourney:
        journey = self.get_journey(journey_id)
        if journey.lead_status != LeadStatus.otp_verified:
            raise FunnelStateError("Checkout requires OTP verification")
        journey.checkout_mode = checkout_mode
        journey.lead_status = LeadStatus.checkout_started
        journey.journey_stage = JourneyStage.checkout_viewed
        self._record_event(journey_id, "checkout_started", {"checkout_mode": checkout_mode})
        self._record_event(journey_id, "checkout_viewed", {"checkout_mode": checkout_mode})
        return journey

    def register_payment(self, journey_id: str, *, success: bool, provider_ref: str) -> LeadJourney:
        journey = self.get_journey(journey_id)
        if journey.lead_status != LeadStatus.checkout_started:
            raise FunnelStateError("Payment requires checkout_started state")

        self._record_event(journey_id, "payment_attempted", {"provider_ref": provider_ref})
        if success:
            journey.payment_status = "paid"
            journey.lead_status = LeadStatus.payment_success
            journey.journey_stage = JourneyStage.payment_completed
            self._record_event(journey_id, "payment_success", {"provider_ref": provider_ref})
        else:
            journey.payment_status = "failed"
            journey.lead_status = LeadStatus.payment_failed
            self._record_event(journey_id, "payment_failed", {"provider_ref": provider_ref})
        return journey

    def abandon_checkout(self, journey_id: str, *, reason: str) -> LeadJourney:
        journey = self.get_journey(journey_id)
        if journey.lead_status != LeadStatus.checkout_started:
            raise FunnelStateError("Checkout can only be abandoned from checkout_started")
        journey.payment_status = "abandoned"
        journey.lead_status = LeadStatus.payment_abandoned
        self._record_event(journey_id, "payment_abandoned", {"reason": reason})
        return journey

    def authorize_audit(self, journey_id: str, *, internal_override: bool = False, allow_b2b_deferred: bool = True) -> LeadJourney:
        journey = self.get_journey(journey_id)
        allowed = journey.lead_status == LeadStatus.payment_success
        if allow_b2b_deferred and journey.checkout_mode == "b2b_deferred" and journey.lead_status in {
            LeadStatus.checkout_started,
            LeadStatus.payment_abandoned,
        }:
            allowed = True
        if internal_override:
            allowed = True

        if not allowed:
            raise FunnelStateError("Audit requires payment success, approved B2B deferred mode, or internal override")

        journey.lead_status = LeadStatus.audit_authorized
        self._record_event(
            journey_id,
            "audit_authorized",
            {
                "internal_override": internal_override,
                "allow_b2b_deferred": allow_b2b_deferred,
                "checkout_mode": journey.checkout_mode,
            },
        )
        return journey

    def complete_audit(self, journey_id: str, *, route_to_home: RouteToHome) -> LeadJourney:
        journey = self.get_journey(journey_id)
        if journey.lead_status != LeadStatus.audit_authorized:
            raise FunnelStateError("complete_audit requires audit_authorized")
        journey.lead_status = LeadStatus.routed
        journey.journey_stage = JourneyStage.route_decided
        journey.route_to_home = route_to_home
        self._record_event(journey_id, "audit_completed", {"route_to_home": route_to_home.value})
        self._record_event(journey_id, "route_to_home", {"route_to_home": route_to_home.value})
        return journey

    def mark_otp_abandoned(self, journey_id: str, *, reason: str) -> LeadJourney:
        journey = self.get_journey(journey_id)
        if journey.lead_status != LeadStatus.otp_pending:
            raise FunnelStateError("OTP abandonment requires otp_pending")
        self._record_event(journey_id, "otp_abandoned", {"reason": reason})
        journey.lead_status = LeadStatus.abandoned
        journey.journey_stage = JourneyStage.dropped
        return journey

    def mark_dropoff(self, journey_id: str, *, reason: str) -> LeadJourney:
        journey = self.get_journey(journey_id)
        journey.lead_status = LeadStatus.abandoned
        journey.journey_stage = JourneyStage.dropped
        self._record_event(journey_id, "journey_dropoff", {"reason": reason})
        return journey

    def record_chatbot_interaction(self, journey_id: str, *, intent: str, resolution: str) -> None:
        self.get_journey(journey_id)
        self._record_event(journey_id, "chatbot_interaction", {"intent": intent, "resolution": resolution})
