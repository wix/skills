# Wix APIs from the Base44 sandbox — one-file edition

**Discover everything.** Endpoints, paths, doc URLs, request bodies, response fields — all come
from the calls below, never from memory or pattern. A 404 or empty result means discover, not
permute. The examples teach mechanics and go stale — verify before relying on one.

Tool results clip at ~5,000 chars. **Return facts, not documents**: filter and project *inside*
exec, return slices, iterate. Save to `.agents/scratch/` only *documents* (never API responses);
read them back with `read_file` at the exact returned path. One exec per round; timeout default
10s, pass `timeout` up to 120 for one big fetch.

Every snippet below is a complete exec_tool body. Shared clip guard — end any snippet that might
return big with:

```js
const out = /* whatever you built */;
const s = JSON.stringify(out);
return s.length > 4000 ? { truncated: true, total: s.length, head: s.slice(0, 4000) } : out;
```

## Identities

| | token | for |
|---|---|---|
| **admin** | `const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix")` | managing the site — ad hoc from exec, or in a backend function |
| **visitor** | minted in the app's own frontend from the public clientId | everything the end user does: storefront reads, cart, checkout |

## 0. First admin call — what IS this site

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ siteId: WIX_SITE_ID }),
});
const { markdown } = await r.json();
return { total: markdown.length, head: markdown.slice(0, 4000) };
```

One markdown report: installed apps **with their ids** (the Stores appId `catalogReference` needs,
and its catalog version — V1 vs V3 decides every Stores endpoint), the OAuth app id (**which is
also the visitor `clientId`**), locale, currency, CMS collections. A `200` with `markdown: ""`
means bad token or siteId — never "empty site".

## 1. Find the page

**Know the product? Browse (deterministic).** Orient with counts, then filter — an unfiltered
method listing of a vertical is ~30 KB and will clip:

```js
const r = await fetch("https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    menu_url: "https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings",
    include: ["METHOD"], name_filter: "resched", depth: 4,   // orient first: { menu_url } alone
  }),
});
return (await r.json()).content;   // null/404 ⇒ not a docs node — re-orient a level up
```

**Don't know where it lives? Search (ranks, never matches).** It always returns its best guess —
a wrong-product hit looks confident; absence is only provable by enumeration (§3):

```js
const fs = require("fs"); fs.mkdirSync("/app/.agents/scratch", { recursive: true });
const r = await fetch("https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ search_term: "cancel a booking and refund the customer",
    document_type: "REST",   // SDK | WIX_HEADLESS | VELO | BUILD_APPS | CLI …
    maximum_results: 5, lines_in_each_result: 20 }),
});
const { content } = await r.json();
fs.writeFileSync("/app/.agents/scratch/search-1.md", content);
const urls = [...new Set(content.match(/https:\/\/dev\.wix\.com\/docs\/[^\s)"'\]]+/g) || [])];
return { path: ".agents/scratch/search-1.md", bytes: content.length, urls: urls.slice(0, 20) };
```

Then switch to browsing the subtree a hit names.

## 2. Fetch a doc page — always `.md`

Without the suffix the portal serves a multi-MB HTML shell (`create-draft-post`: 5.3 MB as HTML,
414 KB as `.md`):

```js
const fs = require("fs"); fs.mkdirSync("/app/.agents/scratch", { recursive: true });
const url = "https://dev.wix.com/docs/…/cancel-booking";        // from browse/search output
const res = await fetch(url.replace(/\.md$/, "") + ".md");
if (!res.ok) return { status: res.status, hint: "not a docs page — take URLs from output, don't compose" };
const body = await res.text();
fs.writeFileSync("/app/.agents/scratch/cancel-booking.md", body);
return { path: ".agents/scratch/cancel-booking.md", bytes: body.length };
```

Articles are small — `read_file` whole. Method pages are 100 KB+ with **parallel REST and SDK
halves repeating the same field names at different types** — map before reading:

```js
const fs = require("fs");
const lines = fs.readFileSync("/app/.agents/scratch/cancel-booking.md", "utf8").split("\n");
const hits = [];
lines.forEach((text, i) => {
  if (/^#{1,3} /.test(text) || /refund/i.test(text))            // headers always; term of interest
    hits.push({ line: i + 1, text: text.trim().slice(0, 100) });
});
return { lines: lines.length, shown: Math.min(hits.length, 40),
         omitted: Math.max(0, hits.length - 40), hits: hits.slice(0, 40) };
```

`omitted > 0` ⇒ narrow the term, map again. Then `read_file` with `offset`/`limit` around the hit
lines. Header-to-header distances are section windows; a section spanning ≤3 lines is a container —
read its children. Know which `##` half (REST vs SDK) you're under before quoting.

## 3. The spec index — endpoints and exact schemas

`POST https://mcp.wix.com/api/code-mode/search` with `{ code: "async function(){…}" }` → `{ result }`.
In scope:

```typescript
lightIndex: Array<{             // RESOURCES, not methods
  name: string; docsUrl: string; menuPath: string[]
  methods: Array<{ operationId,  // "wix.contacts.v5.Contacts.QueryContacts"
    summary, httpMethod,
    path,                        // PARTIAL ("/v5/contacts/query") — never call it
    publicUrl,                   // "https://www.wixapis.com/contacts/v5/contacts/query" — call THIS
    docsUrl }>
}>
getResourceSchemaByUrl(docsUrl)  // full schema; API pages only — skills/articles have none
```

Inspect, don't discover: arrive with a `docsUrl`, match by `docsUrl`. Every method of a resource,
with callable URLs (also how you prove an API does NOT exist — enumerate and say what you enumerated):

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

A method's request fields — names and types only, drill next round, `$circular` stubs resolve via
`components.schemas[name]`:

```js
// …same POST wrapper, code:
`async function(){
  const u = "https://dev.wix.com/docs/…/create-draft-post";     // a METHOD docsUrl
  const s = await getResourceSchemaByUrl(u);
  const m = s.methods.find(x => x.docsUrl === u);
  const props = m.requestBody.content["application/json"].schema.properties;
  return Object.entries(props).map(([k, v]) => k + ": " + (v.type || v.$circular || "object"));
}`
```

## 4. Call it

Admin, from a contract you discovered — clip the response, never save it (API responses are the
user's data; scratch is committed with the app):

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/contacts/v5/contacts/query", {   // from §3 publicUrl
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: { cursorPaging: { limit: 10 } } }),
});
const text = await r.text();
if (!r.ok) return { status: r.status, error: text.slice(0, 300) };
return text.length > 4000
  ? { status: r.status, truncated: true, total: text.length, head: text.slice(0, 4000),
      hint: "narrow: filters, cursor paging, fewer fields" }
  : { status: r.status, json: JSON.parse(text) };
```

Visitor — minted in the app's frontend code (not exec); the clientId is public, from §0's report
or the project config:

```js
// src/lib/wixClient.js
const res = await fetch("https://www.wixapis.com/oauth2/token", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clientId: WIX_CLIENT_ID, grantType: "anonymous" }),
});
const { access_token } = await res.json();   // bearer for products, cart, checkout
```

Cart and checkout act on the **caller's** identity — they want the visitor token. Admin manages
the site; visitor is *on* it.

**Response shapes obey the discover rule too**: code against fields you saw in a live response or
the schema — never remembered names (`priceData`, `media.items` are ghosts of old versions; probe
one real row first).

## Auth docs (fetch with §2 when needed)

`api-reference/articles/authentication/about-identities` · `…/rest-api-authentication` ·
`business-management/headless/authentication/retrieve-tokens` (the /oauth2/token contract) ·
`go-headless/authentication/about-authentication` · `…/create-an-oauth-app-for-visitors-and-members` ·
`…/authentication/setup/set-up-a-headless-client`

For site management beyond this file — installing apps, media, properties — the `wix-manage`
skill: `npx -y skills add wix/skills/skills/wix-manage`, or `https://www.wix.com/skills/wix-manage`.
