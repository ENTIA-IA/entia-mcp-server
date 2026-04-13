"""ENTIA API Client — sync and async HTTP client for ENTIA REST API v1."""

from __future__ import annotations

from typing import Any, Optional

import httpx

from entia_mcp.config import settings


class EntiaAPIError(RuntimeError):
    """Raised when the ENTIA API returns an error."""


class EntiaClient:
    """Synchronous ENTIA API client.

    Usage:
        client = EntiaClient(api_key="entia_live_...")
        results = client.search("dental clinic", country="ES")
        profile = client.profile("Telefonica", country="ES")
        vat = client.verify_vat("ESA28015865")
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[int] = None,
    ) -> None:
        self.base_url = (base_url or settings.entia_api_base_url).rstrip("/")
        self.api_key = api_key or settings.entia_api_key
        self.timeout = timeout or settings.entia_timeout_seconds

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["X-ENTIA-Key"] = self.api_key
        return headers

    def _request(self, method: str, path: str, params: Optional[dict] = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.request(method, url, headers=self._headers(), params=params)
        except httpx.HTTPError as exc:
            raise EntiaAPIError(f"Network error: {exc}") from exc

        if response.status_code >= 400:
            raise EntiaAPIError(f"ENTIA API error {response.status_code}: {response.text}")

        try:
            return response.json()
        except ValueError as exc:
            raise EntiaAPIError("Non-JSON response from ENTIA") from exc

    def search(
        self,
        query: str,
        country: str = "ES",
        sector: Optional[str] = None,
        city: Optional[str] = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        """Search entities by name, sector, city.

        Returns: {"status": "ok", "count": N, "entities": [...]}
        """
        params: dict[str, Any] = {"q": query, "country": country, "limit": limit}
        if sector:
            params["sector"] = sector
        if city:
            params["city"] = city
        return self._request("GET", "/v1/search", params)

    def profile(self, query: str, country: Optional[str] = None) -> dict[str, Any]:
        """Get full entity profile with trust score, BORME, GLEIF, VIES, Wikidata.

        Args:
            query: CIF (B80988678), EU VAT (ESB80988678), LEI, or company name.
            country: Optional ISO country code hint.

        Returns: {"found": bool, "entity": {...}, "trust_score": {...}, "borme": {...}, ...}
        """
        params = {}
        if country:
            params["country"] = country
        return self._request("GET", f"/v1/profile/{query}", params)

    def verify_vat(self, vat_id: str) -> dict[str, Any]:
        """Verify EU VAT number via VIES (27 member states).

        Args:
            vat_id: Full VAT ID with country prefix (e.g. ESA28015865, FR12345678901).

        Returns: {"valid": bool, "name": str, "address": str, ...}
        """
        return self._request("GET", f"/v1/verify/vat/{vat_id}")

    def stats(self) -> dict[str, Any]:
        """Get platform statistics: entities, countries, data sources."""
        return self._request("GET", "/v1/stats")

    def health(self) -> dict[str, Any]:
        """Check connectivity to ENTIA API."""
        return {
            "status": "ok",
            "api_base_url": self.base_url,
            "has_api_key": bool(self.api_key),
        }


class AsyncEntiaClient:
    """Asynchronous ENTIA API client.

    Usage:
        client = AsyncEntiaClient(api_key="entia_live_...")
        results = await client.search("dental clinic", country="ES")
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[int] = None,
    ) -> None:
        self.base_url = (base_url or settings.entia_api_base_url).rstrip("/")
        self.api_key = api_key or settings.entia_api_key
        self.timeout = timeout or settings.entia_timeout_seconds

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["X-ENTIA-Key"] = self.api_key
        return headers

    async def _request(self, method: str, path: str, params: Optional[dict] = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(method, url, headers=self._headers(), params=params)
        except httpx.HTTPError as exc:
            raise EntiaAPIError(f"Network error: {exc}") from exc

        if response.status_code >= 400:
            raise EntiaAPIError(f"ENTIA API error {response.status_code}: {response.text}")

        return response.json()

    async def search(self, query: str, country: str = "ES", limit: int = 10, **kwargs) -> dict:
        params = {"q": query, "country": country, "limit": limit, **kwargs}
        return await self._request("GET", "/v1/search", params)

    async def profile(self, query: str, country: Optional[str] = None) -> dict:
        params = {"country": country} if country else {}
        return await self._request("GET", f"/v1/profile/{query}", params)

    async def verify_vat(self, vat_id: str) -> dict:
        return await self._request("GET", f"/v1/verify/vat/{vat_id}")

    async def stats(self) -> dict:
        return await self._request("GET", "/v1/stats")
