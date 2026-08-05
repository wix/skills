---
name: wix-docs
description: "Look up the Wix API/SDK documentation to confirm an exact endpoint, HTTP method, request/response shape, field, enum, or error before writing Wix code — never guess a Wix API from memory. A lookup is a short flow: find the right page, then read it. Two ways: (1) plain `curl` (zero dependencies) — find a page by **semantic search** (`POST /mcp-docs-search/v1/docs/search`, natural-language `{ search_term, document_type }`) **or by browsing** the docs tree as a menu from the `llms.txt` root (append `.md` to any docs path), then read the page by appending `.md` to its URL; and (2) the Wix MCP doc tools when your agent has them. Triggers: look up a Wix API, find the Wix endpoint/method, confirm a Wix request body or field, verify a Wix API shape, explore Wix docs, which Wix API do I call, read a Wix method schema."
---

# Wix Docs — look up the Wix API/SDK documentation

Get the **exact** truth about a Wix API — endpoint, HTTP method, request/response body, a field, an
enum, or an error. **Never invent a Wix endpoint, path, body, or enum from memory** — confirm it
here first.

A lookup is a short flow: **find the right page, then read it.** Do it with `curl` (default, below)
or the Wix MCP doc tools if your agent has them (Lane 2).

## Lane 1 — `curl` (default)

The docs are one tree of markdown pages: **append `.md` to any `https://dev.wix.com/docs/…` URL**
to get that page as markdown. No SDK, no MCP.

### 1. Find the page — search, browse, or query the index

Three ways to reach the right page — use whichever fits.

**A. Semantic search.** Describe what you want in natural language ("let a customer book an
appointment"), not just keywords; hits come back ranked by relevance. Same `POST` body for both
variants: `search_term` (required, 1–500), `document_type` (`REST` default · `SDK` · `WIX_HEADLESS` ·
`BUSINESS_SOLUTIONS` · `VELO` · `WDS` · `BUILD_APPS` · `CLI`), `maximum_results` (1–20, def 15),
`lines_in_each_result` (1–200, def 20). Two variants — pick by what you're doing:

**`/docs/search/markdown` → read it (start here).** Returns JSON with a single `content` field
holding one LLM-ready markdown string (extract it with `jq -r '.content'`) where each hit is a
**condensed method doc**: the API **endpoint**, **real request code examples**, the **response
shape**, and the **method description** (with its gotchas) — each truncated to `lines_in_each_result`
with a "read more" link. For *"how do I call X?"* this is usually all you need in **one call** — hand
it straight to the model; no page fetch, no schema dig.

```bash
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"create a booking","document_type":"REST","maximum_results":3}' \
  | jq -r '.content'      # no jq? → python3 -c 'import sys,json;print(json.load(sys.stdin)["content"])'
```

**`/docs/search` (JSON) → route on it.** Returns `{ results: [ { title, url, content,
relevance_score, … } ] }` — structured hits. Use it when you want to **pick/route programmatically**:
grab a hit's `url` to read that page (§2) or feed it to the schema query (§C). (Method hits carry a
`url`; article hits keep their link inside `content`.)

```bash
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"create a booking","document_type":"REST","maximum_results":5}' \
  | jq -r '.results[] | select(.url) | "\(.title)\t\(.url)"'
# no jq? → python3 -c 'import sys,json;[print(r["title"],r["url"]) for r in json.load(sys.stdin)["results"] if r.get("url")]'
```

**B. Browse the tree from the root, like a menu.** Every docs path has a `.md` twin, so you can
navigate the docs as a menu tree — no search needed. `curl https://dev.wix.com/docs/llms.txt` is the
top-level map; the portals under it:

| Portal | Start here for |
|---|---|
| [`api-reference.md`](https://dev.wix.com/docs/api-reference.md) | **All backend / business-solution APIs — the main one.** Each page documents **both** its REST and SDK usage (`.md?apiView=SDK` for the SDK view). |
| [`sdk.md`](https://dev.wix.com/docs/sdk.md) | **SDK-only surfaces not in the API reference:** client setup (`createClient`, `OAuthStrategy`), core modules (`@wix/sdk`, `@wix/essentials`), host modules (`dashboard`/`editor`/`site`), and frontend modules (`members`, `pay`, `seo`, `storage`, `pricing-plans`, …). |
| [`go-headless.md`](https://dev.wix.com/docs/go-headless.md) | Headless setup, auth, hosting, framework integration. |
| [`build-apps.md`](https://dev.wix.com/docs/build-apps.md) | Building Wix apps / extensions. |
| [`wix-cli.md`](https://dev.wix.com/docs/wix-cli.md) · [`velo.md`](https://dev.wix.com/docs/velo.md) | Wix CLI commands; Velo site-coding APIs. |

**Drill like a menu** — append `.md` to any path (a *section* → a menu of child links, a *leaf* →
the content/method page); truncate to go up, extend to go down. **Read the sibling intro / "About …"
/ flow articles too**, not just the method page. Example — drill to the create-booking method,
grepping each menu for the next link:

```bash
curl -sS https://dev.wix.com/docs/api-reference/business-solutions.md            | grep -i bookings   # → .../bookings.md
curl -sS https://dev.wix.com/docs/api-reference/business-solutions/bookings.md   | grep -iE 'bookings|flow'  # → resource/flow pages
curl -sS https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings.md | grep -i create      # → the create method leaf
curl -sS https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md  # read it
```

A 2-level map of the API-reference portal (all verticals, one level down) is in
`references/EXTRACTING.md`.

**C. Query the API index — one call, structured.** The `code-mode` search endpoint runs a JS
function over `lightIndex` (the whole REST API spec: every resource + method with `operationId`,
`httpMethod`, `menuPath`, `docsUrl`, and executable `publicUrl`). Best when you want to
**enumerate/filter methods programmatically** — browse a vertical, or grep across *all* methods —
and get the `docsUrl` + `publicUrl` back in one shot, no menu-drilling:

```bash
# pinpoint a method by keyword across the whole index → its docsUrl + executable publicUrl
curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' -H 'Content-Type: application/json' \
  --data-raw '{"code":"async function(){ return lightIndex.flatMap(r=>r.methods).filter(m=>/createBooking$/i.test(m.operationId)).map(m=>({op:m.operationId, httpMethod:m.httpMethod, publicUrl:m.publicUrl, docsUrl:m.docsUrl})); }"}'
```

**Filter narrowly and return only the fields you need** — the index is large, so an unfiltered dump
is huge. Scope: **REST API methods only** (not concept/guide articles, headless prose, or SDK-only
surfaces — use A/B for those). More examples (browse a whole vertical, `menuPath` walk,
whole-resource schema) and the `getResourceSchema` reader → **`references/API_SPEC_SEARCH.md`**.

If the Wix MCP is present, it exposes these same capabilities as native tools (no `curl`/JSON
boilerplate) — Lane 2.

### 2. Read what you land on

Appending `.md` to a URL gives one of **three kinds of page**. Know which you're looking at, and
handle it accordingly:

- **Menu page** — a *section* path (from browsing, §1B). A list of child links, often tens of KB —
  **don't read it whole; `grep` it** for the child you want, then drill into that page:

  ```bash
  curl -sS 'https://dev.wix.com/docs/api-reference/business-solutions/bookings.md' | grep -i 'booking'
  ```

- **Article / guide** — introductions, concepts, sample-flow pages. Prose markdown, usually small —
  **read it whole**:

  ```bash
  curl -sS 'https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/introduction.md'
  ```

- **Method page** — one API method, and the heavy one: it carries **both** a REST and a JavaScript
  SDK section, the full request/response schema, and code examples — often 100 KB+. **Don't swallow
  the whole page** — map it, then pull the part you need (the examples are usually enough to model a
  call):

  ```bash
  curl -sS "$URL.md" | grep -nE '^#{1,3} '                                              # 1. map the outline
  curl -sS "$URL.md" | awk '/^## REST API/{r=1} r&&/^### Examples/{f=1} /^## JavaScript SDK/{f=0} f'  # 2. just the REST examples
  curl -sS "$URL.md" | grep -nE 'name: (selectedPaymentOption|totalParticipants)'       # 3. grep specific schema fields
  ```

  More recipes (split REST vs SDK, resolve an enum) → `references/EXTRACTING.md`.

  For the exact **structured** schema and enum values, don't hand-slice the markdown — query the API
  spec with a `curl` `POST` to `https://mcp.wix.com/api/code-mode/search` (the no-MCP equivalent of
  the MCP `SearchWixAPISpec`). The `code` is a JS function with `lightIndex` and
  `getResourceSchemaByUrl(docsUrl)` in scope; return only what you need:

  ```bash
  # find a method by keyword → its docsUrl + executable publicUrl
  curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' -H 'Content-Type: application/json' \
    --data-raw '{"code":"async function(){ return lightIndex.flatMap(r=>r.methods).filter(m=>/createBooking$/i.test(m.operationId)).map(m=>({op:m.operationId, httpMethod:m.httpMethod, publicUrl:m.publicUrl, docsUrl:m.docsUrl})); }"}'

  # pull one method's request/response schema by its docsUrl (resolve $circular refs via s.components.schemas)
  curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' -H 'Content-Type: application/json' \
    --data-raw '{"code":"async function(){ const u=\"https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking\"; const s=await getResourceSchemaByUrl(u); const m=s.methods.find(x=>x.docsUrl===u); return { publicUrl:m.publicUrl, requestBody:m.requestBody, responses:m.responses }; }"}'
  ```

  Full example set (resource listing, partial-URL resolution, enum/nested-ref expansion) →
  `references/API_SPEC_SEARCH.md`.

## Lane 2 — Wix MCP doc tools (only if your agent has them)

If the Wix MCP is connected, these are the **same backends as Lane 1** (the doc-search service and
the API-spec index) wrapped as native tools — schema-validated, response-size handled, no
`curl`/JSON boilerplate. A convenience over the curl lane, **not a richer data source**; use them
when present, fall back to Lane 1 when not. Optional — skip this lane if the tools aren't present.

| Tool | Use for |
|---|---|
| `SearchWixRESTDocumentation` | Find a REST method/recipe by keyword |
| `SearchWixSDKDocumentation` | Find an SDK method (surfaces runtime functions a module menu hides) |
| `SearchWixAPISpec` → `getResourceSchemaByUrl` | The **whole resource** — every method + shared object schema in one payload |
| `ReadFullDocsArticle` | Read a recipe/flow/article page in full |
| `BrowseWixRESTDocsMenu` | Walk the menu tree to drill to a method |

- **Prefer the whole-resource view** (`getResourceSchemaByUrl`) over a single method page: a
  requirement is often documented on a *sibling* method (e.g. a `memberId` required on
  single-create but omitted from the bulk-create page). The resource view carries both.
- **Look for the vertical's recipe/flow page first** — many verticals publish opinionated,
  multi-step recipes under a `…/business-solutions/<vertical>/skills` node (search
  `"<vertical> setup recipe"` or browse the menu). A recipe gives correct ordering,
  cross-step gotchas, and the one bundled endpoint that does the whole job — which a
  per-method schema won't flag.

## The `.md` suffix

Append `.md` only when `curl`-ing a page directly. The MCP tools and the search endpoint take the
plain docs URL **without** `.md` — never feed a `.md` URL to an MCP tool.

## Before you write the code

Confirm on the page — not from memory — the endpoint, the HTTP verb, the request body shape,
required fields, and any enum values. Then write the call. If you're extending a skill's shipped
client, keep the skill's existing transport/helper style; you're adding one call, not
re-architecting.
