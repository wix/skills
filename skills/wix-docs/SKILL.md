---
name: wix-docs
description: "Look up the Wix API/SDK documentation to confirm an exact endpoint, HTTP method, request/response shape, field, enum, or error before writing Wix code — never guess a Wix API from memory. A lookup is a short flow: find the right page, then read it. Two ways: (1) plain `curl` (zero dependencies) — find a page by **semantic search** (`POST /mcp-docs-search/v1/docs/search`, natural-language `{ search_term, document_type }`, incl. the SKILLS recipe corpus for multi-step workflows) **or by browsing** a docs portal as a menu — a structured, typed, counted browse of the REST, SDK, CLI, Build Apps, and Headless portals (`POST /mcp-docs-search/v1/docs/menu/browse`), or the `.md` menu tree from the `llms.txt` root for any surface — then read the page by appending `.md` to its URL; (2) the Wix MCP doc tools when present. Triggers: look up a Wix API, find the Wix endpoint/method, confirm a Wix request body or field, verify a Wix API shape, explore Wix docs, which Wix API do I call, read a Wix method schema."
---

# Wix Docs — look up the Wix API/SDK documentation

Get the **exact** truth about a Wix API — endpoint, HTTP method, request/response body, a field, an
enum, or an error. **Never invent a Wix endpoint, path, body, or enum from memory** — confirm it
here first. That includes the example endpoints in this skill: they illustrate the mechanics and
go stale like any snapshot — discover the real contract before you rely on one.

A lookup is a short flow: **find the right page, then read it.** Do it with `curl` (default, below)
or the Wix MCP doc tools if your agent has them (Lane 2). Either way, route by what you already
know:

- **You have a docs URL** → just read it (§2). Don't re-search for a page you can already name.
- **A multi-step workflow** ("take a booking from service setup to payment") → look for a **recipe**
  first: semantic search with `document_type: "SKILLS"` (§1A). A recipe carries step ordering,
  cross-step gotchas, and the one bundled endpoint that does the whole job — things no single
  method page states. No relevant recipe → search the relevant API corpus and assemble the workflow
  from verified per-method contracts.
- **One specific operation, field, or enum** → search its API corpus (`REST` / `SDK`), then read or
  schema-check what you land on.

## Lane 1 — `curl` (default)

The docs are one tree of markdown pages: **append `.md` to any `https://dev.wix.com/docs/…` URL**
to get that page as markdown. No SDK, no MCP.

### 1. Find the page — search, browse, or query the index

Three ways to reach the right page — use whichever fits.

**A. Semantic search.** Describe what you want in natural language ("let a customer book an
appointment"), not just keywords; hits come back ranked by relevance. Same `POST` body for both
variants: `search_term` (required, 1–500), `document_type` (`REST` default · `SDK` · `SKILLS` ·
`WIX_HEADLESS` · `BUSINESS_SOLUTIONS` · `VELO` · `WDS` · `BUILD_APPS` · `CLI` · `OVERVIEW`),
`maximum_results` (1–20, def 15), `lines_in_each_result` (0–200, def 20; `0` = no per-hit line cap).
`SKILLS` is the dedicated **recipe corpus** — multi-step workflow pages that a `REST` search does
not return; `OVERVIEW` is platform orientation (which development approach, which API family). Two
variants — pick by what you're doing:

**`/docs/search/markdown` → read it (start here).** Returns JSON with a single `content` field
holding one LLM-ready markdown string (extract it with `jq -r '.content'`) where each hit is a
**condensed method doc**: the API **endpoint**, **real request code examples**, the **response
shape**, and the **method description** (with its gotchas). Hits are **previews, not full pages**:
the condensed format has fixed per-section limits, so raising `lines_in_each_result` does not expand
every section, and `0` only removes the per-hit line cap — it never reproduces the whole source page.
Before building on a hit, check sufficiency: do you have the required inputs, the conditions that
apply to your case, and the REST contract or SDK signature you need? If yes, proceed — no extra
fetch. If not, make **one targeted follow-up**: read the method page (§2) or pull its schema (§C).

```bash
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"create a booking","document_type":"REST","maximum_results":3}' \
  | jq -r '.content'      # no jq? → python3 -c 'import sys,json;print(json.load(sys.stdin)["content"])'
```

For a workflow, hit the recipe corpus first, then resolve each step's call in `REST`/`SDK`:

```bash
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"end to end booking flow","document_type":"SKILLS","maximum_results":2}' \
  | jq -r '.content'
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

**B. Browse the docs tree as a menu.** Two ways: the **structured browse endpoint** for the
supported portals (preferred there — typed, counted, filterable), and the **`.md` menu tree** for
any surface and for reading pages.

**B1. Structured browse — the supported portals.** `POST /mcp-docs-search/v1/docs/menu/browse`
walks a portal's tree and returns each child with its **kind**, its **HTTP verb** (for methods), and
**subtree counts** ("Catalog V3 — 121 methods, 32 articles"), so you pick the right area by shape —
in ~2 KB, not a ~40 KB menu page you have to `grep`. `include`, `name_filter`, and `depth` jump
straight to what you want.

Portals (`document_type`): `REST` (default — the `api-reference` portal) · `FRONTEND_SDK` (`sdk`) ·
`CLI` (`wix-cli`) · `BUILD_APPS` (`build-apps`) · `WIX_HEADLESS` (`go-headless`). In **browse only**,
`SDK` is an alias for `REST` (the API reference documents both views on every page) — it does **not**
select `FRONTEND_SDK`, and the alias doesn't apply to semantic search. To discover a portal's areas,
omit `menu_url` — you get the portal root; passing a supported portal's URL as `menu_url` also infers
the portal for you.

Body: `menu_url?` (absolute docs URL; omit for the portal root), `document_type?`, `depth?` (1, max
6), `include?` (`CATEGORY`·`RESOURCE`·`METHOD`·`ARTICLE`·`WEBHOOK`·`OBJECT`·`SKILL`), `deprecated?`
(`HIDE` default·`SHOW`·`ONLY`), `name_filter?`, `max_nodes?`, `format?` (`MARKDOWN` default →
`content` string; `STRUCTURED` → JSON tree with `url`/`http_method`/`resource_id`/`child_counts`,
plus `counts_by_type`, `truncated`, `deprecated_counts_by_type`).

Two response signals to act on, not ignore:

- **`truncated: true`** — the node cap cut the listing. Narrow instead of re-reading: browse a
  deeper `menu_url`, tighten `include`/`name_filter`, or lower `depth`.
- **Deprecation filtering** — deprecated entries are **hidden by default**;
  `deprecated_counts_by_type` reports how many were filtered out. An API missing from a browse may
  be deprecated, not nonexistent — re-browse with `deprecated: "SHOW"` (or `"ONLY"`) to inspect it,
  and follow its replacement pointer where one is documented.

```bash
# a vertical's structure, with per-child subtree counts
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse' \
  -H 'Content-Type: application/json' \
  --data-raw '{"menu_url":"https://dev.wix.com/docs/api-reference/business-solutions/stores"}' \
  | jq -r '.content'

# jump straight to a method by name — no multi-level grep
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse' \
  -H 'Content-Type: application/json' \
  --data-raw '{"menu_url":"https://dev.wix.com/docs/api-reference/business-solutions/bookings","include":["METHOD"],"name_filter":"cancel","depth":4}' \
  | jq -r '.content'

# a non-REST portal: the CLI docs, from the portal root
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse' \
  -H 'Content-Type: application/json' \
  --data-raw '{"document_type":"CLI","depth":2}' | jq -r '.content'
```

Browse-only: it hands you the page **URL** — read it by appending `.md` (§2), and get the exact
schema from §C.

**B2. `.md` menu tree — any surface, and how you read pages.** Every docs path has a `.md` twin, so
you can navigate any surface with zero dependencies; use it for surfaces structured browse doesn't
cover (e.g. Velo) and to read leaves. `curl https://dev.wix.com/docs/llms.txt` is the
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
is huge. Scope: the **REST surface**. `lightIndex` indexes REST **methods**; a sibling `articles`
index plus `getArticleContentByUrl(docsUrl)` / `getArticleContent(resourceId)` cover the REST
portal's **prose** (introductions, recipes, flow pages). SDK-only surfaces and the other portals
aren't here — use A/B for those, and note the schemas returned are REST contracts, not SDK
signatures (the SDK view of the same method lives on its docs page, §2). More examples (browse a
vertical, `menuPath` walk, resource schema) and the schema/article readers →
**`references/API_SPEC_SEARCH.md`**.

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
  `getResourceSchemaByUrl(docsUrl)` in scope; return only what you need.

  `getResourceSchemaByUrl` scopes to the URL you pass: a **method URL** returns a schema whose
  `methods` array holds just that method — read it as `methods[0]`, and don't select it by comparing
  `m.docsUrl` to your input (the reader normalizes URLs). A **resource URL** (the method URL minus
  its last segment) returns the **whole resource** — fetch that when you need sibling operations or
  shared resource context.

  ```bash
  # find a method by keyword → its docsUrl + executable publicUrl
  curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' -H 'Content-Type: application/json' \
    --data-raw '{"code":"async function(){ return lightIndex.flatMap(r=>r.methods).filter(m=>/createBooking$/i.test(m.operationId)).map(m=>({op:m.operationId, httpMethod:m.httpMethod, publicUrl:m.publicUrl, docsUrl:m.docsUrl})); }"}'

  # a METHOD URL → that one method's contract (resolve $circular refs via s.components.schemas)
  curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' -H 'Content-Type: application/json' \
    --data-raw '{"code":"async function(){ const s=await getResourceSchemaByUrl(\"https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking\"); const m=s.methods[0]; return { publicUrl:m.publicUrl, requestBody:m.requestBody, responses:m.responses }; }"}'
  ```

  The envelope is `{ "result": … }` or `{ "error": "<message>" }` — **both arrive as HTTP 200**, so
  check the body, not the status. The error text names the fix: an article URL → switch to
  `getArticleContentByUrl`; an unknown URL → search `lightIndex` by keyword. Don't re-send an
  identical failed lookup — change something based on the error, and if discovery still fails,
  report the limitation instead of guessing the contract.

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
| `SearchWixAPISpec` → `getResourceSchemaByUrl` | Structured schema — a **method URL** for that method's contract, a **resource URL** for the whole resource |
| `ReadFullDocsArticle` | Read a recipe/flow/article page in full |
| `BrowseWixRESTDocsMenu` | Walk the menu tree to drill to a method |

- **Fetch the method for its contract; fetch the resource for context.** A method URL gives exactly
  that method. When a requirement may live on a *sibling* method (e.g. a `memberId` required on
  single-create but omitted from the bulk-create page), fetch the **resource** URL instead — the
  resource view carries every method plus the shared object schema.
- The **recipe-first routing** at the top of this skill applies here too: for a multi-step workflow,
  search the recipe corpus (many verticals publish recipes under a
  `…/business-solutions/<vertical>/skills` node) before assembling per-method calls.

## The `.md` suffix

Append `.md` only when `curl`-ing a page directly. The MCP tools and the search endpoint take the
plain docs URL **without** `.md` — never feed a `.md` URL to an MCP tool.

## From docs to calls

Understanding the contract is this skill's job; executing it needs an identity. Which identities a
method accepts is part of what you read — check the method page's permissions and identity notes
before calling, and confirm your token's site/account scope matches. Token minting (CLI admin
tokens, visitor tokens), the identity model, and the dynamic site-context report →
**`references/CALLING.md`**.

## Before you write the code

Confirm on the page — not from memory — the endpoint, the HTTP verb, the request body shape,
required fields, and any enum values. Then write the call. If you're extending a skill's shipped
client, keep the skill's existing transport/helper style; you're adding one call, not
re-architecting.
