# Building on Wix from Base44

The Wix connector is connected; this is how the app gets built on it — gather the site's context,
find the APIs and learn their contracts from the docs, write the code. **Discover everything**: endpoints, paths, doc URLs,
request and response fields all come from the calls below, never from memory or pattern. 404 or
empty ⇒ discover, not permute. Examples teach mechanics and go stale — verify before relying.

## What are you building?

The app's audience picks the token, and the token picks the architecture: the **visitor token is
public** — anyone can mint it from the site's `clientId` — and the **admin token is a secret**,
the connector's, server-side only.

```
browser            ──(visitor token)─► wixapis.com   the visitor's own reads & actions
base44/functions/* ──(admin token)───► wixapis.com   work that needs the owner's identity
exec_tool          ──(admin token)───► wixapis.com   you: ad hoc probing/managing while building
```

**A site for visitors** — storefront, blog, booking. Headless means the Wix site has no pages of
its own: your app IS its frontend. **The complete visitor experience —
every page, every read, every action a visitor takes — is browser calls on the visitor token;
none of it needs a backend function.** Public reads
included (the visitor token queries the catalog directly), and `carts/current/*` + checkout act
on the CALLER's cart, so only the visitor token reaches the visitor's cart. One file carries it
all: `src/lib/wixClient.js` (Write the code, below). `base44/functions/*` appear only where work
needs the owner's identity — elevated-permission ops a visitor triggers, webhooks, scheduled
jobs — and for the app's non-Wix backend.

**An admin tool for the owner** — dashboard, back office. The pages act as the owner, whose token
is a secret: `pages → base44/functions/* ──(admin token)──► wixapis.com`.

## The helpers

Research and probing run in exec_tool, and one loader opens every exec (execs share no state —
reload each round, ~1s):

```js
const src = await (await fetch("https://www.wix.com/skills/wix-docs-base44/scripts/disk.js")).text();
const wx = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", src)(m, m.exports, require); return m.exports; })();
```

Results ≤ 4,000 chars come back inline (exec results clip at ~5,000); anything bigger is saved
under `.agents/skills/wix-docs-base44/scratch/` and returns `{ path, bytes, lines, outline }` —
the outline is the map. Read a saved file the way you already know how:
`wx.bash("grep -n 'term' <path> | head -40")` to find (GNU grep/sed, awk is mawk, no rg;
across everything saved: `grep -rn 'term' .agents/skills/wix-docs-base44/scratch/`), and
`read_file` to quote — a window via `offset`/`limit` at the lines grep named, or the whole
file when it fits read_file's 45K cap. **API responses are site data and never land in
scratch** — project them to facts. Fetch every URL inside exec with `fetch()` — website/browser
tools clip at 10,000 chars silently. One exec per round; timeout 10s, up to 120 via `{timeout}`.

## Gather context — the dynamic context report

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
return await wx.context(accessToken, "Apps");   // no section arg → the report's outline
```

One report: installed apps **with ids** (incl. Stores' catalog version — V1 vs V3 decides its
endpoints), the OAuth app id (**also the visitor `clientId`**), locale, currency, CMS collections.
An empty report = bad token, never an empty site.

## Learn Wix — find the APIs, learn their contracts

```js
// know the product? browse is deterministic — menuUrl alone orients (children + counts);
// filter before listing methods, unfiltered listings clip
await wx.browse("https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings",
                { include: ["METHOD"], filter: "resched", depth: 4 });

// don't know where it lives? search ranks, never says "no match" — drop wrong-product hits
await wx.search("pause a pricing plan subscription and resume it");
// → { hits: [{ method, endpoint /* callable */, docsUrl, gist }] } — hits often ARE the answer
```

Go deeper for fields, enums, or absence — only the spec index proves absence.

### Read a doc page

Method pages are 100 KB+, twin REST and SDK halves repeating field names at different types —
`page` fetches, saves, and maps in one round; quote only your half:

```js
const pg = await wx.page(docsUrl);   // whole text when small; else { path, bytes, lines, outline }
await wx.bash(`grep -in 'refund' ${pg.path} | head -40`);   // grep -n 'term|^#' keeps the sections visible
// quote with read_file(pg.path) + offset/limit at the lines grep named — the REST example FIRST:
// under ### Examples below ## REST API sits a complete working request
await wx.bash(`sed -n '53,949p' ${pg.path} | grep -oE '"[a-zA-Z]+":' | sort -u | head -60`);
//  ↑ a giant fenced example → its field vocabulary in one round; read it whole only if you must
```

`search` also saves its raw content beside the inline hits — grep its `path` when a hit's six
lines weren't enough.

### The spec index

Answers questions about pages you already found — arrive with a `docsUrl`, match by it. Also the
only proof an API does NOT exist:

```js
await wx.spec(`
  const r = lightIndex.find(x => x.docsUrl === "<docsUrl from browse/search>");
  return r.methods.map(m => ({ op: m.operationId.split(".").pop(), verb: m.httpMethod,
                               call: m.publicUrl }));   // publicUrl is callable — path is PARTIAL
`);
// request fields next round: getResourceSchemaByUrl(docsUrl) →
//   m.requestBody.content["application/json"].schema.properties — names and types, drill deeper
//   per round; $circular stubs resolve via s.components.schemas["<name>"]
```

### Management recipes — check before composing admin flows

~100 curated multi-step recipes (install apps, seed catalogs, set up whole verticals):

```js
await wx.recipes();           // categories with counts
await wx.recipes("stores");   // a category's list — or any task word: wx.recipes("coupon")
await wx.page(url);           // read the chosen recipe — whole when small, saved + outline when
                              // big; then grep / read_file windows by the outline's line numbers
```

A matching recipe beats composing the flow from single endpoints: it carries ordering and
cross-step gotchas no method page mentions.

## Write the code

**Response shapes obey the discover rule in every lane**: code against fields you saw in a live
response or the schema — remembered names are often from older versions. Probe one real row first.

### Admin calls — exec ad hoc, backend functions deployed

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const data = await wx.post("https://www.wixapis.com/contacts/v5/contacts/query",   // spec-index publicUrl
  { query: { cursorPaging: { limit: 10 } } }, accessToken);
return { count: data.contacts?.length, keys: Object.keys(data.contacts?.[0] || {}) };   // project, don't dump
```

The same call deploys as `base44/functions/*` (work the app does as the owner) — shipped code
carries its own four-line fetch; the helpers are a build tool, not a runtime dependency.

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
//               a fresh anonymous mint is a NEW visitor — the old one's cart goes with it
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
```
