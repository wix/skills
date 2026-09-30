// Site-level settings a seed applies before it creates content. Same ctx as every seed:
// { token, siteId }, the site token minted by the seed itself.
const API = "https://www.wixapis.com";

// The site currency, set BEFORE any priced content exists. A product's, service's, ticket tier's
// or plan's price is stored in the site currency at create time, and an event's ticket tiers
// cannot be repriced afterwards. A new site starts in the currency of the account that created
// it, not the business's. Reads can report the old currency for a few seconds after this returns;
// that lag is expected and self-resolves.
// docs: https://dev.wix.com/docs/rest/business-management/site-properties/properties/update-site-properties
export async function setSiteCurrency(ctx, currency) {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`currency must be a 3-letter ISO code, got "${currency}"`);
  const res = await fetch(`${API}/site-properties/v4/properties`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ctx.token}`, "wix-site-id": ctx.siteId, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { paymentCurrency: currency }, fields: { paths: ["paymentCurrency"] } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PATCH /site-properties/v4/properties -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return currency;
}
