# Wix APIs from Base44 — zero-disk discovery & execution loop

**Discover everything.** Endpoints, paths, doc URLs, request and response fields — all from the
calls below, never from memory or pattern. 404 or empty ⇒ discover, not permute. Examples teach
mechanics and go stale — verify before relying on one.

**Every call: fetch → reduce in memory → return ≤ 4,000 chars.** Results clip at ~5,000. Nothing
is written to disk; state between rounds is re-fetching (~1s). **Fetch every URL inside exec with
`fetch()`** — website/browser tools clip at 10,000 chars silently. Return facts, not documents; a
big result returns a count of what was left out, and you narrow next round. One exec per round;
timeout default 10s, up to 120 via `{timeout}`.

Clip guard for any big return:
`const s = JSON.stringify(out); return s.length > 4000 ? { truncated: true, total: s.length, head: s.slice(0, 4000) } : out;`

## Who calls Wix

```
end user's browser ──(visitor token)─► wixapis.com   the app, at runtime
exec_tool          ──(admin token)───► wixapis.com   you, ad hoc: probing/managing while building
backend function   ──(admin token)───► wixapis.com   admin work the app itself does at runtime
```

Headless means the Wix site has no pages of its own — **your app IS its frontend**, and a
frontend calls its backend from the browser. Visitor token: minted in frontend code (§5). Admin
token: `getConnection("wix")` (§0).

Litmus: about to write a backend function that a page calls to reach Wix? If the page serves
the site's *visitors*, stop — that call belongs in the browser, on the visitor token. Backend
functions carry what the app does *as the site's owner* — and if the app is a management
dashboard rather than a visitor-facing site, that's most of it.

## 0. First admin call — what IS this site

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ siteId: WIX_SITE_ID }),
});
const { markdown } = await r.json();   // big? extract a section, don't page blind:
const apps = (markdown.match(/### Apps[\s\S]*?(?=\n### |$)/) || [markdown.slice(0, 3500)])[0];
return { total: markdown.length, apps: apps.slice(0, 3500) };
```

One report: installed apps **with ids** (incl. Stores' catalog version — V1 vs V3 decides its
endpoints), the OAuth app id (**also the visitor `clientId`**), locale, currency, CMS
collections. `200` with `markdown: ""` = bad token or siteId, never an empty site.

## 1. Find the page

**Know the product? Browse (deterministic).** Orient with counts, then filter — unfiltered
listings clip:

```js
const r = await fetch("https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    menu_url: "https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings",
    include: ["METHOD"], name_filter: "resched", depth: 4,   // orient first: menu_url alone
  }),
});
return (await r.json()).content;   // null/404 ⇒ not a docs node — re-orient a level up
```

**Don't know where it lives? Search (ranks, never matches).** Each hit is a condensed method
doc. Reduce per hit, keeping the riches:

```js
const r = await fetch("https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ search_term: "pause a pricing plan subscription and resume it",
    document_type: "REST",   // or SDK | WIX_HEADLESS | VELO | CLI
    maximum_results: 5, lines_in_each_result: 6 }),
});
const { content } = await r.json();
const hits = content.split(/\n---\n+(?=#### )/).map(b => ({
  method:   (b.match(/^# Method: (.+)$/m) || [])[1],
  endpoint: (b.match(/^# Method API Endpoint: (.+)$/m) || [])[1],   // callable as-is
  docsUrl:  (b.match(/#### \[[^\]]+\]\((https:[^)]+)\)/) || [])[1],
  gist: ((b.match(/## Method Description:\s*\n([\s\S]{0,400})/) || [])[1] || "").trim().replace(/\s+/g, " ").slice(0, 220),
})).filter(h => h.docsUrl);
return { total: content.length, hits };   // hits often ARE the answer
```

Go deeper only for fields, enums, or absence — which only enumeration proves (§3). Drop hits
from other products.

## 2. Read a doc page — fetch and map in ONE call

Always append **`.md`** (without it: a multi-MB HTML shell). Method pages are 100 KB+, twin
REST and SDK halves repeating field names at different types — never return the page:

```js
const url = "https://dev.wix.com/docs/…/cancel-booking";   // from browse/search output
const res = await fetch(url.replace(/\.md$/, "") + ".md");
if (!res.ok) return { status: res.status, hint: "not a docs page — take URLs from output, don't compose" };
const lines = (await res.text()).split("\n");
const hits = [];
lines.forEach((text, i) => {
  if (/^#{1,3} /.test(text) || /refund/i.test(text))   // headers always; term of interest
    hits.push({ line: i + 1, text: text.trim().slice(0, 100) });
});
return { lines: lines.length, shown: Math.min(hits.length, 40),
         omitted: Math.max(0, hits.length - 40), hits: hits.slice(0, 40) };
```

`omitted > 0` ⇒ narrow, map again. Headers say which `##` half each hit is in — quote only yours.
No term = the outline; header-to-header = section windows.

**Window the REST example FIRST** — under `### Examples` below `## REST API` sits a complete
working request (URL, headers, real-format body): usually all you need. Window it with the same
fetch, sliced to the map's line numbers: `lines.slice(a, b).map((t, i) => (a + 1 + i) + ": " + t.slice(0, 110)).join("\n")`.

## 3. The spec index — endpoints and exact schemas

`POST https://mcp.wix.com/api/code-mode/search` with `{ code: "async function(){…}" }` → `{ result }`.
In scope:

```typescript
lightIndex: Array<{   // RESOURCES, not methods
  name; docsUrl; menuPath: string[]
  methods: Array<{ operationId,   // fully qualified — never filter by resource name on it
    summary, httpMethod,
    path,        // PARTIAL — never call it
    publicUrl,   // the callable https://www.wixapis.com/… URL — call THIS
    docsUrl }> }>
getResourceSchemaByUrl(docsUrl)   // full schema; API method pages only
```

Inspect, don't discover: arrive with a `docsUrl`, match by it. A resource's methods with
callable URLs — also the only proof an API does NOT exist:

```js
const r = await fetch("https://mcp.wix.com/api/code-mode/search", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: `async function(){
    const r = lightIndex.find(x => x.docsUrl ===
      "https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5");
    return r.methods.filter(m => /query/i.test(m.summary))
                    .map(m => ({ op: m.operationId.split(".").pop(),
                                 verb: m.httpMethod, call: m.publicUrl }));
  }` }),
});
return (await r.json()).result;
```

Request fields: same wrapper, `getResourceSchemaByUrl(methodDocsUrl)` → schema at
`m.requestBody.content["application/json"].schema.properties` — names and types only, drill next
round; `$circular` stubs resolve via `s.components.schemas["<name>"]`.

## 4. Call it (admin, from exec)

The admin token is the connector's (§0). Project the response to facts:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/contacts/v5/contacts/query", {   // from §3 publicUrl
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: { cursorPaging: { limit: 10 } } }),
});
if (!r.ok) return { status: r.status, error: (await r.text()).slice(0, 300) };
const data = await r.json();   // project, don't dump:
return { count: data.contacts?.length, keys: Object.keys(data.contacts?.[0] || {}) };
```

**Response shapes obey the discover rule too**: before coding against a field name, see it in a
live response or the schema — remembered names are often from older API versions. Probe one real
row first, like the projection above.

## 5. The visitor token (app code, not exec)

Neither `clientId` nor the minted token is a secret — together they are "an anonymous visitor",
safe in shipped frontend code:

```js
// src/lib/wixClient.js — ships with the app
const res = await fetch("https://www.wixapis.com/oauth2/token", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clientId: WIX_CLIENT_ID, grantType: "anonymous" }),
});
const { access_token, refresh_token, expires_in } = await res.json();   // expires_in: 14400 (4h)
```

On expiry exchange `refresh_token` (`grantType: "refresh_token"`) — a fresh anonymous mint is a
NEW visitor and the old one's cart goes with it. Contract: `…/headless/authentication/retrieve-tokens`.

## More

Site management: `wix-manage` — `https://www.wix.com/skills/wix-manage`.
