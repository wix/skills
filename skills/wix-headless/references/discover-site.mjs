#!/usr/bin/env node
/**
 * discover-site.mjs — read what an existing Wix site already is: which Wix
 * business apps are installed on it, plus basic site properties.
 *
 * Use it when a run targets an EXISTING site and the words alone don't say
 * what to build — an ambiguous brief ("build a frontend for my business"), a
 * connect/iterate pass over a site that may already be set up. The site is
 * the ground truth of what the business is; read it instead of guessing.
 *
 * Usage:
 *   WIX_TOKEN=<elevated credential> node discover-site.mjs <metaSiteId>
 *
 * WIX_TOKEN is an elevated credential from the run's authentication mechanism
 * (see <TYPE_DIR>/AUTHENTICATION.md) — a CLI-minted token, a platform
 * Wix-connector access token, or a Wix API key. The public client id and
 * visitor tokens are rejected by these APIs.
 *
 * Output — one JSON object of plain data (interpretation stays with the
 * caller and the flow docs):
 *   site           — id, displayName, url, namespace ("HEADLESS" = headless
 *                    project), editorType, published, premium, veloEnabled,
 *                    createdDate/updatedDate, language, currency, timeZone
 *   installedApps  — the known Wix business apps installed on the site:
 *                    { name, appId, ...extras }, resolved against KNOWN_APPS
 *                    below. Any extra field the API reports on an app (e.g.
 *                    stores' catalogVersion) rides along untouched. Note that
 *                    ecom is installed alongside ANY selling app (bookings,
 *                    events, …), not only stores.
 *   cmsCollections — native CMS collections (id + non-system field keys).
 *                    Wix Data is core, so there is no app to detect — a
 *                    non-empty list is the signal that CMS is in use.
 */

const WIX_API_BASE = "https://www.wixapis.com";

// appDefId → app name, for the apps this skill can build on. Keep in sync
// with SETUP.md §2 (the install table) — these are the same appDefId
// constants. The full "Apps Created by Wix" appDefId list lives in the docs:
// https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
const KNOWN_APPS = {
  "215238eb-22a5-4c36-9e7b-e7c08025e04e": "stores",
  "14bcded7-0066-7c35-14d7-466cb3f09103": "blog",
  "225dd912-7dea-4738-8688-4b8c6955ffc2": "forms",
  "140603ad-af8d-84a5-2c80-a0f60cb47351": "events",
  "13d21c63-b5ec-5912-8397-c3a5ddb27a97": "bookings",
  "1522827f-c56c-a5c9-2ac9-00f9e6ae12d3": "pricing-plans",
  "b278a256-2757-4f19-9313-c05c783bec92": "restaurants menus",
  "9a5d83fd-8570-482e-81ab-cfa88942ee60": "restaurants online ordering",
  "f9c07de2-5341-40c6-b096-8eb39de391fb": "restaurants table reservations",
  "d90652a2-f5a1-4c7c-84c4-d4cdcc41f130": "portfolio",
  "1380b703-ce81-ff05-f115-39571d94dfcd": "ecom (checkout layer)",
  "14cc59bc-f0b7-15b8-e1c7-89ce41d0e0c9": "members area (profile)",
  "a95a5fce-e370-4402-9ce4-96956acc747d": "reviews",
};

const siteId = process.argv[2];
const token = process.env.WIX_TOKEN;
if (!siteId || !token) {
  console.error("Usage: WIX_TOKEN=<elevated credential> node discover-site.mjs <metaSiteId>");
  process.exit(1);
}
// Wix API keys ("IST.…") are sent raw; OAuth access tokens take a Bearer prefix.
const authHeader = token.startsWith("IST.") ? token : `Bearer ${token}`;

async function wixFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`${WIX_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader,
      "wix-site-id": siteId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Dynamic Context — one call returns the installed apps plus site metadata
// and CMS collection schemas.
const data = await wixFetch("/_api/dynamic-context/v1/dynamic-context", {
  method: "POST",
  body: { siteId },
});
const site = data.sites?.[0];
if (!site) throw new Error("dynamic-context returned no site for this siteId");

// Resolve against KNOWN_APPS — NEVER read the raw app list as a verdict: it
// holds 50+ infra entries and non-GUID legacy ids ("HtmlAnywhere").
const installedApps = (site.installedApps ?? []).flatMap((app) =>
  KNOWN_APPS[app.appId] ? [{ name: KNOWN_APPS[app.appId], ...app }] : []
);

console.log(
  JSON.stringify(
    {
      site: {
        id: site.id,
        displayName: site.displayName,
        url: site.url,
        namespace: site.namespace,
        editorType: site.editorType,
        published: site.published,
        premium: site.premium,
        veloEnabled: site.veloEnabled,
        createdDate: site.createdDate,
        updatedDate: site.updatedDate,
        language: site.properties?.language,
        currency: site.properties?.paymentCurrency,
        timeZone: site.properties?.timeZone,
      },
      installedApps,
      cmsCollections: (site.cmsCollections ?? []).map((c) => ({
        id: c.id,
        fields: (c.fields ?? []).filter((f) => !f.systemField).map((f) => f.key),
      })),
    },
    null,
    2
  )
);
