"""Basic ENTIA client usage — search, profile, VAT verification."""

from entia_mcp import EntiaClient

client = EntiaClient()  # reads ENTIA_API_KEY from env

# 1. Search for dental clinics in Madrid
print("=== Search ===")
results = client.search("clinica dental", country="ES", city="Madrid", limit=3)
for entity in results.get("entities", []):
    print(f"  {entity['name']} — {entity.get('city')} — {entity.get('phone', 'N/A')}")

# 2. Get full profile for Telefonica
print("\n=== Profile ===")
profile = client.profile("Telefonica", country="ES")
ts = profile.get("trust_score", {})
print(f"  Trust Score: {ts.get('score')}/100 ({ts.get('badge')})")
print(f"  BORME acts: {profile.get('borme', {}).get('acts_count', 0)}")
print(f"  GLEIF: {profile.get('gleif', {}).get('legal_name', 'N/A')}")

# 3. Verify EU VAT
print("\n=== VAT Verification ===")
vat = client.verify_vat("ESA28015865")
print(f"  Valid: {vat.get('valid')}")
print(f"  Source: {vat.get('source')}")

# 4. Platform stats
print("\n=== Stats ===")
stats = client.stats()
print(f"  Entities: {stats.get('entities')}")
print(f"  Countries: {stats.get('countries')}")
