---
name: wix-base44-connector
description: "Build on and manage the connected Wix site from a Base44 app: discover and call any Wix API (endpoints, request/response shapes, fields), gather site context, route each call to the right identity, and follow curated recipes for admin tasks."
---

# Building on Wix from Base44

The Wix connector is connected; this is how the app gets built on it — gather the site's context,
find the APIs and learn their contracts from the docs, write the code. **Discover everything**: endpoints, paths, doc URLs,
request and response fields all come from the calls below, never from memory or pattern. 404 or
empty ⇒ discover, not permute. Examples teach mechanics and go stale — verify before relying.

**Start every Wix task by getting the site context** (`wx.context`, below). It reports what the
site actually has and how each part is configured, so every call targets what is really there
instead of a guess from a name. It is the first step of a task, not a one-time setup: a later turn
does not inherit an earlier turn's context, so re-read it before building on or calling a Wix API.

**A management or admin task starts at the recipes**: call `wx.mgmtRecipes` (Learn Wix) and follow
the one that fits. A recipe states outright what an API does not support, which fields a bulk call
actually writes, and the order two calls have to go in — from the schemas alone those get re-derived
several errors at a time. A REST search ranks the matching recipes too (`recipes` in its return), so
they also surface from a search that began at the methods.

## What are you building?

The app's audience picks the token, and the token picks the architecture: the **visitor token is
public** — anyone can mint it from the site's `clientId` — and the **admin token is a secret**,
the connector's, server-side only.

```
browser            ──(visitor token)─► wixapis.com   the visitor's own reads & actions
base44/functions/… ──(admin token)───► wixapis.com   work that needs the owner's identity
exec_tool          ──(admin token)───► wixapis.com   you: ad hoc probing/managing while building
```

**A site for visitors** — store, blog, booking, ecom, CMS, CRM, and the rest of the business solutions.
Your app is the site's frontend — whether the site is headless (no pages of its own) or your
frontend extends an existing site. **The complete visitor experience —
every page, every read, every action a visitor takes — is browser calls on the visitor token;
none of it needs a backend function.** Public reads
included (the visitor token queries public content directly), and per-visitor state is scoped to
the CALLER — an API that acts on "the current visitor's" data resolves the visitor from the
token, so only the visitor token reaches that visitor's own state. One shared visitor client
carries it all (Write the code, below). `base44/functions/…` appear only where work
needs the owner's identity — elevated-permission ops a visitor triggers, webhooks, scheduled
jobs — and for the app's non-Wix backend.

**An admin tool for the owner** — dashboard, back office. Admin pages and agent act as the
owner, using the secret admin token: `pages → base44/functions/… ──(admin token)──► wixapis.com`.

## The helpers

Research and probing run in exec_tool, and one loader opens every exec (execs share no state —
reload each round; the module lives on disk next to this file, network only as first-touch
fallback):

```js
const fs = require("fs"), P = ".agents/skills/wix-base44-connector/utils.js";
if (!fs.existsSync(P)) { fs.mkdirSync(".agents/skills/wix-base44-connector", { recursive: true });
  fs.writeFileSync(P, await (await fetch("https://www.wix.com/skills/wix-base44-connector/scripts/utils.js")).text()); }
const wx = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync(P, "utf8"))(m, m.exports, require); return m.exports; })();
```

`wx` exports these helpers:

- `wx.post/get/patch/put/del(url, [body], token?)` — JSON transports, one per verb (`get`/`del` take no body): Bearer from `token`, non-2xx **throws** the API's own error
- `wx.clip(value)` — cap a return value: oversized → `{ truncated, total, head }`; renders `undefined` as `null` so absence stays visible
- `wx.context(token, section?)` — the site's dynamic context report; no section → its outline
- `wx.browse(menuUrl, { include, filter, depth })` — walk a docs-portal menu deterministically
- `wx.search(term, { type, max, lines })` — ranked docs search; hits carry endpoint (`VERB url`) + docsUrl + gist, and the worked requests the docs publish for them. A REST search also ranks the **management recipes**, returned as their own `recipes` list ahead of the methods — each with its steps, the endpoints it calls, and `file` when the wix-manage skill is on disk
- `wx.page(docsUrl)` — read a doc page; its worked examples come back as titles + line numbers
- `wx.bash(cmd)` — shell over saved files (GNU grep/sed; awk is mawk; no rg)
- `wx.spec(docsUrl | code)` — a method's exact schema, plus the titles of the docs' own request examples saved at `examplesPath`; pass a hit's docsUrl (direct load), or raw code to query the index yourself
- `wx.mgmtRecipes(q?)` — management-recipe index; no arg → categories, a word → matching recipes
- `wx.installApp(appDefId, siteId, token)` — install a Wix app on the site (Apps Installer). If discovery finds an API whose app isn't installed on the site, install it first — that's a one-call prerequisite, **not** a reason to fall back to a hand-built alternative. `appDefId` from `search` or the Apps-Created-by-Wix table; `siteId` from `context` (the site report)

Every helper answers inline when the result fits (≤ 4,000 chars — exec results clip at ~5,000).
A bigger result is saved under `.agents/skills/wix-base44-connector/tmp/` and comes back as
`{ path, bytes, lines, outline }` — the outline is your map into the file. Work a saved file in
two moves: find with `wx.bash("grep -n 'term' <path> | head -40")` (or across every save:
`grep -rn 'term' .agents/skills/wix-base44-connector/tmp/`), then quote with `read_file` — an
`offset`/`limit` window at the lines grep named, or the whole file when it fits the 45K cap.

## Gather context — the dynamic context report

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
return await wx.context(accessToken, "Apps");   // no section arg → the report's outline
```

One report: installed apps **with ids** (incl. Stores' catalog version — V1 vs V3 decides its
endpoints), the OAuth app id (**also the visitor `clientId`**), locale, currency, CMS collections.
An empty report = bad token, never an empty site.

## Learn Wix — find the APIs, learn their contracts

### Management recipes — first stop for an admin task

Curated admin flows, by category — ecommerce, bookings, stores, cms, google-ads, sites, contacts,
get-paid, marketing, pricing-plans, events, blog, forms, restaurants, domains, media, …:

```js
await wx.mgmtRecipes();           // categories with counts
await wx.mgmtRecipes("stores");   // a category's list — or any task word: wx.mgmtRecipes("coupon")
// each row points at its recipe: `file` when the wix-manage skill is installed — read_file it
// straight off disk — else `url`: wx.page(url), whole when small, saved + outline when big
```

A recipe carries prerequisites, order, and gotchas that no method page has. A REST search ranks
these same recipes as its own `recipes` list, so they surface either way.

### Find a method — search and browse

```js
// name the method? search finds it in one call:
await wx.search("stores v3 update product");   // → [{ method, endpoint: "VERB url", docsUrl, gist }]; call wx.<verb>(url, body, token); spec(docsUrl) for the full schema
// exploring an unfamiliar product? browse is deterministic — menuUrl alone orients (children + counts);
// filter before listing methods. browse works for both portals this skill uses — REST
// (api-reference) and WIX_HEADLESS (go-headless) — just pass that portal's menu URL.
await wx.browse("https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings",
                { include: ["METHOD"], filter: "resched", depth: 4 });
// non-REST portal — same call, that portal's menu URL:
await wx.browse("https://dev.wix.com/docs/go-headless/authentication", { depth: 2 });

// don't know where it lives? search ranks, never says "no match" — drop wrong-product hits
await wx.search("pause a pricing plan subscription and resume it");
// → { hits: [{ method, endpoint /* callable */, docsUrl, gist }] } — hits often ARE the answer

// { type } picks the portal (default "REST" — the HTTP APIs this skill calls). Same query,
// other corpus — search WIX_HEADLESS for headless/external client code (visitor auth,
// JS SDK, quick-starts). It returns article-style hits (method gists thin out) — read the saved path.
await wx.search("mint a visitor token and read the current cart", { type: "WIX_HEADLESS" });
```

Products and their capabilities — the common ones, partial lists:

- **Stores** — products · categories · product options and variants · inventory · promotions · *+7 more*
- **Bookings** — services · appointments · classes · staff members · time slots · waitlists · *+7 more*
- **eCommerce** — cart · checkout · orders · order fulfillment · discount rules · *+7 more*
- **Events** — events · ticket definitions · RSVP · check-in · *+6 more*
- **Restaurants** — menus · items · item modifiers · online orders · reservations · *+9 more*
- **Blog** — posts · draft posts · categories · tags · *+3 more*
- **CMS** — data items · data collections · collection permissions · external databases · *+4 more*
- **Pricing Plans** — plans · orders · recurring subscriptions · free trial periods · *+4 more*
- **Members & Contacts** — contacts · labels · extended fields · members · badges · *+7 more*
- **Forms** — form schemas · form submissions · interactive form sessions · *+3 more*
- **Loyalty** — loyalty points · earning rules · tiers · rewards · *+5 more*

Full list — all 36 products, their capabilities and docs paths: `references/CAPABILITY_MAP.md`.

Go deeper for fields, enums, or absence — only the spec index proves absence.

### Read a doc page

Method pages are 100 KB+, twin REST and SDK halves repeating field names at different types —
map and window in the SAME exec; coordinates are for your code, not for a second round:

```js
const pg = await wx.page(docsUrl);   // whole text when small; else { path, bytes, lines, outline }
// pg.examples lists the page's worked requests as { title, line } — a complete request (URL,
// headers, body) is usually all you need: read_file(pg.path, offset: <its line>)
// anything else, windowed to your term in the same round:
return wx.bash(`sed -n '/^## REST API/,/^## JavaScript SDK/p' ${pg.path} | grep -B5 -A40 -i 'examples\\|<term>' | head -c 3800`);
// a giant fenced example → its field vocabulary instead of paging it:
// wx.bash(`sed -n '<a>,<b>p' ${pg.path} | grep -oE '"[a-zA-Z]+":' | sort -u | head -60`)
```

`search` also saves its raw content beside the inline hits — grep its `path` when a hit's six
lines weren't enough.

### The spec index — a located method's exact schema

Pass a method's `docsUrl` (a search/browse hit carries it) — spec loads that method's schema (request
body, responses, filterable-fields map, examples) in one call, a direct lookup. Read the field
**descriptions**, not just the names — they carry the rules (which field is canonical, when one is empty):

```js
const sp = await wx.spec(hit.docsUrl);
// sp.examples — the method's worked requests as { title, line }, all saved at sp.examplesPath.
// The one that matches the task is rarely the first: read_file(sp.examplesPath, offset: <its line>)
```

Want to shape the result yourself? Pass raw code against the index (`lightIndex` + `getResourceSchemaByUrl`):

```js
await wx.spec(`
  const url = "<docsUrl from search/browse>";           // API method page, not a skill/article page
  const s = await getResourceSchemaByUrl(url);
  const m = s.methods.find(x => x.docsUrl === url);
  return {
    call: m.publicUrl,                                       // callable https://www.wixapis.com/… URL
    body: m.requestBody?.content["application/json"].schema.properties,
    responses: m.responses,
    filterable: m.queryMethodData?.queryFieldsCapabilitiesMap      // query methods
             || m.searchMethodData?.searchFieldsCapabilitiesMap,   // search methods
    example: m.legacyExamples?.[0]?.content,
  };
  // { $circular: "<name>" } types resolve via s.components.schemas["<name>"] — complete in this call
`);
```

`filterable` maps each field to its allowed operators + sort — filter server-side only on what it
lists, else filter in code.

## Write the code

**REST, not the JS SDK** — everywhere: the admin ops you run while building, backend functions,
frontend pages. Doc pages carry twin REST and SDK halves; read the REST one.

**Send what the page documents, nothing more** — required fields, nesting, and enum values exactly
as spelled; a header only when the operation's REST section lists it. Never `wix-site-id`: every
token here is already bound to a site, and in the browser the header fails CORS preflight outright.

**Shapes are discovery too**: read a method's request/response schema from `spec()` — its field
descriptions state which field is canonical and when one reads back empty. Don't infer shape from a
single live probe: it reflects only the params you sent, so probe with the same request your code makes.

### Admin ops while building — you, in exec_tool

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const data = await wx.post("https://www.wixapis.com/contacts/v5/contacts/query",   // spec-index publicUrl
  { query: { cursorPaging: { limit: 10 } } }, accessToken);
// let it throw — the thrown message is your result; .catch hides the answer
return wx.clip({ error: null, count: data.contacts?.length, first: data.contacts[0] });
// `first` is one complete record — read the real field shapes off it; don't code from remembered key names
```

### Backend functions — the app, as the owner

The same API call, deployed. **No helpers run here** — `wx.*` is a build tool loaded into exec,
absent from `base44/functions/…`; write plain `fetch`. Nor `clip`, which caps what an exec returns
to you: a function returns its data to the app.

```js
// inside base44/functions/… — plain fetch, no wx
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const res = await fetch("https://www.wixapis.com/contacts/v5/contacts/query", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: { cursorPaging: { limit: 10 } } }),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);   // the API's own error, not a generic one
return (await res.json()).contacts;
```

- That `Authorization: Bearer …` is the whole auth for this lane, unless the operation's page says
  otherwise.
- One file per business area, not per call — each file is its own deploy, and deploys cost time.
- Call every function you deploy and fix what breaks. Deploying is not testing.

### A visitor client — src/lib/wixClient.js

The "site for visitors" shape (What are you building?), in code — one file pages import. Neither
`clientId` (from the context report) nor the minted token is a secret; together they are "an
anonymous visitor", safe in shipped code:

```js
// src/lib/wixClient.js
let token;
const mint = async (body) => {
  const r = await (await fetch("https://www.wixapis.com/oauth2/token", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  token = r.access_token; sessionStorage.setItem("wixRefresh", r.refresh_token);   // expires_in: 14400s = 4h
};
// first visit:  mint({ clientId: WIX_CLIENT_ID, grantType: "anonymous" });
// on expiry:    mint({ refreshToken: sessionStorage.getItem("wixRefresh"), grantType: "refresh_token" });
export const wix = (path, opts = {}) => fetch("https://www.wixapis.com" + path, { ...opts,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
```

Token contract: `…/headless/authentication/retrieve-tokens`. Prove the lane in one exec before
writing pages — mint a visitor, make one public read with it:

```js
const { access_token } = await wx.post("https://www.wixapis.com/oauth2/token",
  { clientId: WIX_CLIENT_ID, grantType: "anonymous" });   // clientId: from the context report
return await wx.post("<a public read from Learn Wix>", { query: {} }, access_token);
// 200 ⇒ every visitor-facing page in the app is this same call, no server between
// a lean default response isn't the whole shape — contracts often define a fields param
// that opts INTO heavier parts (formatted prices, media); read the contract for it
```

No OAuth app in the context report to take the `clientId` from? Create one (admin, one-time) —
the returned `id` IS the `clientId`:

```js
const { oAuthApp } = await wx.post("https://www.wixapis.com/oauth-app/v1/oauth-apps",
  { oAuthApp: { name: "My App" } }, accessToken);   // oAuthApp.id is the visitor clientId
```
