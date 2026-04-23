import unittest

from entia_mcp.funnel import FunnelService, FunnelStateError, RouteToHome


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
        _, otp = service.request_otp(journey.journey_id)
        service.verify_otp(journey.journey_id, otp)
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


if __name__ == "__main__":
    unittest.main()
