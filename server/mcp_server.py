"""ENTIA MCP Server — AWS edition (Fargate + DuckDB-on-S3).

First iteration after emergency migration from GCP (2026-04-24).
Reads data directly from S3 parquets via DuckDB httpfs.

6 tools exposed:
  entity_lookup    — verify company identity (CIF/NIF/VAT/LEI/name)
  search_entities  — find companies by sector+city+country
  borme_lookup     — BORME mercantile acts for a company
  verify_vat       — EU VIES validation (live API)
  zone_profile     — socioeconomic profile by Spanish postal code
  get_competitors  — nearby competitors by sector+city

Transport: Streamable HTTP at /mcp on MCP_PORT=3000 behind ALB TLS.
Auth: none in Phase 1 (read-only data), OAuth in Phase 2.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Annotated, Any, Optional

import duckdb
import httpx
from fastmcp import FastMCP
from pydantic import Field

log = logging.getLogger("entia-mcp")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

S3_BUCKET = os.environ.get("ENTIA_S3_BUCKET", "entia-data-parquet")
S3_REGION = os.environ.get("ENTIA_S3_REGION", "us-east-1")
# Which project tree to use as canonical: systems-ia-entia (default) or dev-entia
DATA_PROJECT = os.environ.get("ENTIA_DATA_PROJECT", "systems-ia-entia")

# ── Single DuckDB connection, lazy ────────────────────────────────────────
_con: Optional[duckdb.DuckDBPyConnection] = None


def _get_con() -> duckdb.DuckDBPyConnection:
    """Return a warm DuckDB connection with S3 access configured."""
    global _con
    if _con is not None:
        return _con
    c = duckdb.connect(":memory:")
    c.execute("INSTALL httpfs;")
    c.execute("LOAD httpfs;")
    # credential_chain reads env vars, IAM task role, ~/.aws, instance profile
    c.execute(
        f"CREATE SECRET s3_default (TYPE S3, PROVIDER credential_chain, REGION '{S3_REGION}')"
    )
    _con = c
    return c


def _s3(path: str) -> str:
    """Build s3://bucket/DATA_PROJECT/path helper for single-project tables."""
    return f"s3://{S3_BUCKET}/{DATA_PROJECT}/{path}"


def _s3_raw(project: str, path: str) -> str:
    """Build s3://bucket/{project}/path for explicit project tables."""
    return f"s3://{S3_BUCKET}/{project}/{path}"


# ── Server ────────────────────────────────────────────────────────────────
mcp = FastMCP("ENTIA")


# ── TOOL 1: entity_lookup ────────────────────────────────────────────────
@mcp.tool(
    annotations={
        "title": "Entity Lookup",
        "readOnlyHint": True,
        "idempotentHint": True,
    }
)
async def entity_lookup(
    q: Annotated[str, Field(
        description="Company name, CIF/NIF, EU VAT ID (e.g. ESB12345678), or LEI code. Auto-detected.",
        min_length=2,
    )],
) -> dict:
    """Verify a company's legal identity from official sources.

    Use when a user asks: "is this company real?", "check this CIF/VAT",
    "what do we know about X?". Returns legal name, country, sector, address,
    contact, trust score.

    Data source: 5.2M entities in S3 (post-GCP migration 2026-04-24).
    """
    t0 = time.time()
    q = (q or "").strip()
    if len(q) < 2:
        return {"found": False, "error": "query_too_short"}

    con = _get_con()
    src = _s3("entia_pipeline/entities_master.parquet")

    # Very simple heuristic: exact CIF/VAT, else name LIKE
    cif_pat = re.compile(r"^[A-HJ-NP-SUVW]\d{7}[A-J0-9]?$", re.I)
    vat_pat = re.compile(r"^[A-Z]{2}[A-Z0-9]{2,12}$", re.I)

    if cif_pat.match(q) or vat_pat.match(q):
        sql = f"""
            SELECT * FROM read_parquet('{src}')
            WHERE UPPER(vat_id) = UPPER(?) OR UPPER(entia_id) = UPPER(?)
            LIMIT 1
        """
        rows = con.execute(sql, [q, q]).fetchdf().to_dict("records")
    else:
        sql = f"""
            SELECT name, city, country_code, sector, phone, website, address,
                   postal_code, region, vat_id, rating, entia_id
            FROM read_parquet('{src}')
            WHERE UPPER(name) = UPPER(?)
               OR UPPER(name) LIKE CONCAT('%', UPPER(?), '%')
            ORDER BY CASE WHEN UPPER(name) = UPPER(?) THEN 0 ELSE 1 END,
                     CASE WHEN phone IS NOT NULL THEN 0 ELSE 1 END,
                     LENGTH(name)
            LIMIT 1
        """
        rows = con.execute(sql, [q, q, q]).fetchdf().to_dict("records")

    if not rows:
        return {"found": False, "query": q, "elapsed_ms": round((time.time() - t0) * 1000)}

    r = rows[0]
    return {
        "found": True,
        "query": q,
        "entity": {
            "name": r.get("name"),
            "legal_id": r.get("vat_id") or r.get("entia_id"),
            "country_code": r.get("country_code"),
            "sector": r.get("sector"),
            "city": r.get("city"),
            "address": r.get("address"),
            "postal_code": r.get("postal_code"),
            "region": r.get("region"),
            "phone": r.get("phone"),
            "website": r.get("website"),
        },
        "trust_score": {
            "score": 70 if r.get("vat_id") else 40,
            "badge": "VERIFIED" if r.get("vat_id") else "PARTIAL",
            "reason": "phase1_minimal_scoring_post_migration",
        },
        "source": f"s3://{S3_BUCKET}/entities_master.parquet",
        "elapsed_ms": round((time.time() - t0) * 1000),
    }


# ── TOOL 2: search_entities ──────────────────────────────────────────────
@mcp.tool(
    annotations={"title": "Search Entities", "readOnlyHint": True, "idempotentHint": True}
)
async def search_entities(
    q: Annotated[str, Field(description="Partial name or keyword", min_length=2)],
    sector: Annotated[Optional[str], Field(description="dental, legal, estetica, talleres, etc.")] = None,
    city: Annotated[Optional[str], Field(description="City name")] = None,
    country: Annotated[str, Field(description="ISO 3166-1 alpha-2", min_length=2, max_length=2)] = "ES",
    limit: Annotated[int, Field(ge=1, le=50)] = 10,
) -> dict:
    """Search the 5.2M verified entity registry by keyword, sector, city, country.

    Returns up to 50 real businesses with name, address, phone, website, sector.
    Data refreshed from BORME + Companies House + Sirene + 31 other registries.
    """
    t0 = time.time()
    con = _get_con()
    src = _s3("entia_pipeline/entities_master.parquet")

    conds = ["name IS NOT NULL", "TRIM(name) != ''"]
    params: list[Any] = []
    conds.append("UPPER(name) LIKE CONCAT('%', UPPER(?), '%')")
    params.append(q.strip())
    if country:
        conds.append("UPPER(country_code) = UPPER(?)")
        params.append(country.strip())
    if sector:
        conds.append("LOWER(sector) = LOWER(?)")
        params.append(sector.strip())
    if city and len(city) >= 2:
        conds.append("UPPER(city) LIKE CONCAT('%', UPPER(?), '%')")
        params.append(city.strip())

    sql = f"""
        SELECT name, city, country_code, sector, phone, website, address,
               postal_code, region, vat_id, rating
        FROM read_parquet('{src}')
        WHERE {' AND '.join(conds)}
        ORDER BY CASE WHEN phone IS NOT NULL THEN 0 ELSE 1 END, name
        LIMIT ?
    """
    params.append(min(limit, 50))
    rows = con.execute(sql, params).fetchdf().to_dict("records")

    return {
        "count": len(rows),
        "query": {"q": q, "sector": sector, "city": city, "country": country},
        "entities": rows,
        "elapsed_ms": round((time.time() - t0) * 1000),
    }


# ── TOOL 3: borme_lookup ─────────────────────────────────────────────────
@mcp.tool(annotations={"title": "BORME Lookup", "readOnlyHint": True, "idempotentHint": True})
async def borme_lookup(
    name_or_cif: Annotated[str, Field(description="Company legal name OR CIF", min_length=2)],
    limit: Annotated[int, Field(ge=1, le=100)] = 20,
) -> dict:
    """Return BORME (Spanish Official Mercantile Gazette) acts for a company.

    Includes incorporations, director changes, capital amendments, dissolutions,
    from 2009 to present. 40.3M total acts indexed.

    Use when a user asks: "when was X incorporated?", "who are the directors?",
    "has X changed ownership?".
    """
    t0 = time.time()
    con = _get_con()
    src = _s3("borme_historico/actos_mercantiles.parquet")

    q = name_or_cif.strip()
    # Strip ES prefix from CIF
    if q.upper().startswith("ES") and len(q) > 2:
        q_no_es = q[2:]
    else:
        q_no_es = q

    sql = f"""
        SELECT borme_date, cnae_code, tipo_acto, nombre_empresa, cif, texto_acto
        FROM read_parquet('{src}')
        WHERE UPPER(cif) = UPPER(?)
           OR UPPER(cif) = UPPER(?)
           OR UPPER(nombre_empresa) LIKE CONCAT('%', UPPER(?), '%')
        ORDER BY borme_date DESC
        LIMIT ?
    """
    rows = con.execute(sql, [q, q_no_es, q, limit]).fetchdf().to_dict("records")

    return {
        "count": len(rows),
        "query": name_or_cif,
        "acts": rows,
        "elapsed_ms": round((time.time() - t0) * 1000),
    }


# ── TOOL 4: verify_vat ────────────────────────────────────────────────────
@mcp.tool(annotations={"title": "Verify EU VAT", "readOnlyHint": True, "idempotentHint": True})
async def verify_vat(
    vat_id: Annotated[str, Field(description="EU VAT number, e.g. ESB12345678, FR12345678901", min_length=4)],
) -> dict:
    """Validate an EU VAT number against VIES (Spain included).

    Returns valid/invalid + company name + registered address if available.
    27 EU member states covered.
    """
    t0 = time.time()
    v = re.sub(r"[^A-Z0-9]", "", vat_id.upper())
    if len(v) < 4:
        return {"valid": False, "error": "too_short"}
    country, number = v[:2], v[2:]

    url = f"https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number"
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(url, json={"countryCode": country, "vatNumber": number})
            r.raise_for_status()
            data = r.json()
        return {
            "valid": bool(data.get("valid")),
            "country_code": country,
            "vat_number": number,
            "name": data.get("name"),
            "address": data.get("address"),
            "request_date": data.get("requestDate"),
            "elapsed_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        log.error("verify_vat error: %s", e)
        return {"valid": False, "error": "vies_unavailable", "detail": str(e)[:200]}


# ── TOOL 5: zone_profile ─────────────────────────────────────────────────
@mcp.tool(annotations={"title": "Zone Profile (Spain)", "readOnlyHint": True, "idempotentHint": True})
async def zone_profile(
    postal_code: Annotated[str, Field(description="Spanish postal code, 5 digits", min_length=5, max_length=5)],
) -> dict:
    """Socioeconomic profile of a Spanish zone by postal code.

    Combines AEAT (income), SEPE (unemployment), INE (demographics) data.
    Phase 1 post-migration: limited fields until full pipeline restored.
    """
    t0 = time.time()
    con = _get_con()
    src = _s3("entia_datos_esp/perfil_economico_cp.parquet")
    sql = f"SELECT * FROM read_parquet('{src}') WHERE codigo_postal = ? LIMIT 1"
    try:
        rows = con.execute(sql, [postal_code]).fetchdf().to_dict("records")
    except Exception as e:
        return {"found": False, "error": "data_unavailable", "detail": str(e)[:200]}
    if not rows:
        return {"found": False, "postal_code": postal_code}
    return {
        "found": True,
        "postal_code": postal_code,
        "profile": rows[0],
        "elapsed_ms": round((time.time() - t0) * 1000),
    }


# ── TOOL 6: get_competitors ──────────────────────────────────────────────
@mcp.tool(annotations={"title": "Get Competitors", "readOnlyHint": True, "idempotentHint": True})
async def get_competitors(
    sector: Annotated[str, Field(description="Business sector (dental, legal, talleres, etc.)", min_length=2)],
    city: Annotated[str, Field(description="City name", min_length=2)],
    country: Annotated[str, Field(description="ISO 3166-1 alpha-2", min_length=2, max_length=2)] = "ES",
    limit: Annotated[int, Field(ge=1, le=20)] = 10,
) -> dict:
    """Return local competitors for a given sector in a given city."""
    t0 = time.time()
    con = _get_con()
    src = _s3("entia_pipeline/entities_master.parquet")
    sql = f"""
        SELECT name, address, phone, website, postal_code, rating
        FROM read_parquet('{src}')
        WHERE LOWER(sector) = LOWER(?)
          AND UPPER(country_code) = UPPER(?)
          AND UPPER(city) LIKE CONCAT('%', UPPER(?), '%')
          AND name IS NOT NULL
        ORDER BY CASE WHEN phone IS NOT NULL THEN 0 ELSE 1 END, name
        LIMIT ?
    """
    rows = con.execute(sql, [sector, country, city, limit]).fetchdf().to_dict("records")
    return {
        "count": len(rows),
        "competitors": rows,
        "elapsed_ms": round((time.time() - t0) * 1000),
    }


# ── Health endpoint ──────────────────────────────────────────────────────
from starlette.applications import Starlette  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402


async def health(_req):
    try:
        con = _get_con()
        con.execute("SELECT 1").fetchone()
        return JSONResponse({"status": "ok", "s3_bucket": S3_BUCKET, "region": S3_REGION})
    except Exception as e:
        return JSONResponse({"status": "degraded", "error": str(e)[:200]}, status_code=503)


def create_app():
    """Build Starlette app with MCP mounted at /mcp and health at /health."""
    app = mcp.streamable_http_app()
    app.routes.append(Route("/health", health, methods=["GET"]))
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.environ.get("MCP_HOST", "0.0.0.0"),
        port=int(os.environ.get("MCP_PORT", "3000")),
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )
