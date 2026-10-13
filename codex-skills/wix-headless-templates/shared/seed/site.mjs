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

// The Wix Site Search app. Installing it is what indexes a site's products, services, posts and
// events for the site-search capability (templates/shared/capabilities/site-search); without it every
// search answers 200 with zero documents, silently. The install back-fills existing content — results
// appear about half a minute later (products in ~26 s, services in ~14 s, observed) — so run it AFTER
// the content seed. Opt-in: nothing calls this unless plan.capabilities.siteSearch.install is true
// (the capability's seed/install.mjs does). Idempotent: an installed app is reported, not re-installed.
// docs: https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps
// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export const SITE_SEARCH_APP_ID = "1484cb44-49cd-5b39-9681-75188ab429de";

export async function installSiteSearch(ctx) {
  const headers = { Authorization: `Bearer ${ctx.token}`, "wix-site-id": ctx.siteId, "Content-Type": "application/json" };
  const listed = await fetch(`${API}/apps-installer-service/v1/app-instances`, { headers });
  const list = await listed.json().catch(() => ({}));
  if (!listed.ok) throw new Error(`GET /apps-installer-service/v1/app-instances -> ${listed.status}: ${JSON.stringify(list).slice(0, 300)}`);
  const already = (list.appInstances ?? []).some((a) => a.appDefId === SITE_SEARCH_APP_ID || a.appId === SITE_SEARCH_APP_ID);
  if (already) return { appId: SITE_SEARCH_APP_ID, installed: "already" };
  const res = await fetch(`${API}/apps-installer-service/v1/app-instance/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tenant: { tenantType: "SITE", id: ctx.siteId }, appInstance: { appDefId: SITE_SEARCH_APP_ID, enabled: true } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST /apps-installer-service/v1/app-instance/install -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return { appId: SITE_SEARCH_APP_ID, installed: "now" };
}
