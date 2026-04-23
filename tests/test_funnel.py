import unittest

from entia_mcp.funnel import (
    FunnelService,
    FunnelStateError,
    FunnelValidationError,
    LeadStatus,
    RouteToHome,
)


class FunnelServiceTest(unittest.TestCase):
    def test_happy_path_to_route(self) -> None:
        service = FunnelService()
        journey = service.submit_domain(domain="example.com", email="lead@example.com")
        service.apply_pre_audit(
            journey.journey_id,
            lead_type_preliminary="sme",
            revenue_band="lt_1m",
            fit_segment="sme",
            priority_score=42,
        )
        _, challenge = service.request_otp(journey.journey_id)
        service.verify_otp(
            journey.journey_id,
            submitted_code=challenge.code,
            submitted_token=challenge.token,
        )
        service.begin_checkout(journey.journey_id, checkout_mode="immediate")
        service.register_payment(journey.journey_id, success=True, provider_ref="pay_1")
        service.authorize_audit(journey.journey_id)
        final_journey = service.complete_audit(journey.journey_id, route_to_home=RouteToHome.pyme)

        self.assertEqual(final_journey.route_to_home, RouteToHome.pyme)
        self.assertTrue(any(e.name == "payment_success" for e in service.list_events(journey.journey_id)))

    def test_cannot_checkout_without_otp(self) -> None:
        service = FunnelService()
        journey = service.submit_domain(domain="example.com", email="lead@example.com")
        service.apply_pre_audit(
            journey.journey_id,
            lead_type_preliminary="advertiser",
            revenue_band="1m_10m",
            fit_segment="advertiser",
            priority_score=90,
        )
        with self.assertRaises(FunnelStateError):
            service.begin_checkout(journey.journey_id, checkout_mode="immediate")

    def test_blocks_disposable_email(self) -> None:
        service = FunnelService()
        with self.assertRaises(FunnelValidationError):
            service.submit_domain(domain="example.com", email="lead@mailinator.com")

    def test_otp_rate_limit(self) -> None:
        service = FunnelService(otp_max_requests_per_window=1)
        journey = service.submit_domain(
            domain="example.com",
            email="lead@example.com",
            ip_address="1.2.3.4",
            session_id="sess-1",
        )
        service.apply_pre_audit(
            journey.journey_id,
            lead_type_preliminary="sme",
            revenue_band="lt_1m",
            fit_segment="sme",
            priority_score=42,
        )
        service.request_otp(journey.journey_id)
        with self.assertRaises(FunnelStateError):
            service.request_otp(journey.journey_id)

    def test_b2b_deferred_can_authorize_without_payment_success(self) -> None:
        service = FunnelService()
        journey = service.submit_domain(domain="example.com", email="lead@example.com")
        service.apply_pre_audit(
            journey.journey_id,
            lead_type_preliminary="enterprise",
            revenue_band="gt_10m",
            fit_segment="enterprise",
            priority_score=99,
        )
        _, challenge = service.request_otp(journey.journey_id)
        service.verify_otp(
            journey.journey_id,
            submitted_code=challenge.code,
            submitted_token=challenge.token,
        )
        service.begin_checkout(journey.journey_id, checkout_mode="b2b_deferred")
        service.abandon_checkout(journey.journey_id, reason="sales_followup")
        service.authorize_audit(journey.journey_id, allow_b2b_deferred=True)

        self.assertEqual(service.get_journey(journey.journey_id).lead_status, LeadStatus.audit_authorized)


if __name__ == "__main__":
    unittest.main()
