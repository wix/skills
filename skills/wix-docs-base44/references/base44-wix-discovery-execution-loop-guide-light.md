# Wix APIs from Base44 — zero-disk discovery & execution loop

**Discover everything.** Endpoints, paths, doc URLs, request bodies, response fields — all from
the calls below, never from memory or pattern. A 404 or empty result means discover, not permute.
Examples teach mechanics and go stale — verify before relying on one.

**Every call: fetch → reduce in memory → return ≤ 4,000 chars.** Results clip at ~5,000. Nothing
is written to disk — nothing lands in the app's repo; state between rounds is re-fetching (~1s).
**Fetch every URL inside exec with `fetch()`** — website/browser tools clip at 10,000 chars
silently. Return facts, not documents; a big result returns a count of what was left out, and you
narrow next round. One exec per round; timeout default 10s, up to 120 via `{timeout}`.

Clip guard for any snippet that might return big:
`const s = JSON.stringify(out); return s.length > 4000 ? { truncated: true, total: s.length, head: s.slice(0, 4000) } : out;`

## Identities

| | token | for |
|---|---|---|
| **admin** | `await base44.asServiceRole.connectors.getConnection("wix")` → `accessToken` | managing the site — ad hoc from exec, or in a backend function |
| **visitor** | minted in the app's frontend from the public clientId | everything the end user does |

**The headless paradigm:** the app's frontend calls `wixapis.com` DIRECTLY on the visitor token —
every end-user action. Backend functions are for admin/management work only; the platform's
"connector token in backend functions" rule is about the admin token, not a reason to proxy
end-user calls.

## 0. First admin call — what IS this site

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ siteId: WIX_SITE_ID }),
});
const { markdown } = await r.json();   // big? extract a section, not the whole report:
const apps = (markdown.match(/### Apps[\s\S]*?(?=\n### |$)/) || [markdown.slice(0, 3500)])[0];
return { total: markdown.length, apps: apps.slice(0, 3500) };
```

One report: installed apps **with ids** (incl. Stores' catalog version — V1 vs V3 decides its
endpoints), the OAuth app id (**also the visitor `clientId`**), locale, currency, CMS collections.
Another section: same call, different regex. `200` with `markdown: ""` = bad token or siteId.

## 1. Find the page

**Know the product? Browse (deterministic).** Orient with counts, then filter — unfiltered
vertical listings clip:

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

**Don't know where it lives? Search (ranks, never matches).** Each hit is a condensed method
doc. Reduce per hit, keeping the riches:

```js
const r = await fetch("https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ search_term: "pause a pricing plan subscription and resume it",
    document_type: "REST",   // SDK | WIX_HEADLESS | VELO | BUILD_APPS | CLI …
    maximum_results: 5, lines_in_each_result: 6 }),
});
const { content } = await r.json();
const hits = content.split(/\n---\n+(?=#### )/).map(b => ({
  method:   (b.match(/^# Method: (.+)$/m) || [])[1],
  endpoint: (b.match(/^# Method API Endpoint: (.+)$/m) || [])[1],   // callable as-is
  docsUrl:  (b.match(/#### \[[^\]]+\]\((https:[^)]+)\)/) || [])[1],
  gist:     ((b.match(/## Method Description:\s*\n([\s\S]{0,400})/) || [])[1] || "")
              .trim().replace(/\s+/g, " ").slice(0, 220),
})).filter(h => h.docsUrl);
return { total: content.length, hits };
```

For "how do I call X?" the hits often ARE the answer. Go deeper for fields, enums, or absence —
which only enumeration proves (§3). Drop hits from other products.

## 2. Read a doc page — fetch and map in ONE call

Always append **`.md`** (without it: a multi-MB HTML shell). Method pages are 100 KB+, twin REST
and SDK halves repeating field names at different types — never return the page:

```js
const url = "https://dev.wix.com/docs/…/cancel-booking";        // from browse/search output
const res = await fetch(url.replace(/\.md$/, "") + ".md");
if (!res.ok) return { status: res.status, hint: "not a docs page — take URLs from output, don't compose" };
const lines = (await res.text()).split("\n");
const hits = [];
lines.forEach((text, i) => {
  if (/^#{1,3} /.test(text) || /refund/i.test(text))            // headers always; term of interest
    hits.push({ line: i + 1, text: text.trim().slice(0, 100) });
});
return { lines: lines.length, shown: Math.min(hits.length, 40),
         omitted: Math.max(0, hits.length - 40), hits: hits.slice(0, 40) };
```

`omitted > 0` ⇒ narrow, map again. Headers say which `##` half each hit sits in — quote only
yours. No term = the outline; header-to-header = section windows.

**Window the REST example FIRST** — under `### Examples` below `## REST API`: a complete working
request, usually all you need. Same fetch, sliced:

```js
const url = "https://dev.wix.com/docs/…/check-in-ticket";
const lines = (await (await fetch(url + ".md")).text()).split("\n");
return lines.slice(95, 113).map((t, i) => (96 + i) + ": " + t.slice(0, 110)).join("\n");
// → the method's complete curl: URL, headers, real-format body
```

## 3. The spec index — endpoints and exact schemas

`POST https://mcp.wix.com/api/code-mode/search` with `{ code: "async function(){…}" }` → `{ result }`.
In scope:

```typescript
lightIndex: Array<{   // RESOURCES, not methods
  name; docsUrl; menuPath: string[]
  methods: Array<{ operationId,   // fully qualified: "wix.contacts.v5.Contacts.QueryContacts"
    summary, httpMethod,
    path,        // PARTIAL ("/v5/contacts/query") — never call it
    publicUrl,   // "https://www.wixapis.com/contacts/v5/contacts/query" — call THIS
    docsUrl }> }>
getResourceSchemaByUrl(docsUrl)   // full schema; API pages only — skills/articles have none
```

Inspect, don't discover: arrive with a `docsUrl`, match by it. A resource's methods with callable
URLs — also the proof an API does NOT exist (say what you enumerated):

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

Request fields: same wrapper, `getResourceSchemaByUrl(methodDocsUrl)` → the schema at
`m.requestBody.content["application/json"].schema.properties` — names and types only, drill next
round; `{ "$circular": "<name>" }` resolves via `s.components.schemas["<name>"]`.

## 4. Call it

Admin — project the response to facts, in code:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/contacts/v5/contacts/query", {   // from §3 publicUrl
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: { cursorPaging: { limit: 10 } } }),
});
const text = await r.text();
if (!r.ok) return { status: r.status, error: text.slice(0, 300) };
const data = JSON.parse(text);
return { count: data.contacts?.length, keys: Object.keys(data.contacts?.[0] || {}) };
```

Visitor — minted in the app's frontend code (not exec); the clientId is public, from §0's report:

```js
// src/lib/wixClient.js
const res = await fetch("https://www.wixapis.com/oauth2/token", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clientId: WIX_CLIENT_ID, grantType: "anonymous" }),
});
const { access_token } = await res.json();   // bearer for everything the end user does
```

End-user actions run on the **caller's** identity — the visitor token. Admin manages the site;
visitor is *on* it. **Response shapes obey the discover rule too**: code against fields you saw
in a live response or the schema — `priceData` and `media.items` are ghosts of old versions;
probe one real row first, like the projection above.

## More

Auth docs (map with §2): `api-reference/articles/authentication/about-identities` ·
`business-management/headless/authentication/retrieve-tokens`. Site management: the `wix-manage`
skill — `https://www.wix.com/skills/wix-manage`.
