---
name: wix-docs
description: "Best-practices reference for looking up the Wix API/SDK documentation when you need to confirm an exact endpoint, HTTP method, request/response shape, field, enum, or error before writing Wix code — never guess a Wix API from memory. Two lookup lanes: (1) unauthenticated `curl` (zero dependencies, no token — the default): search the docs via `POST /mcp-docs-search/v1/docs/search` (JSON) or `/docs/search/markdown` (LLM-ready markdown), passing `{ search_term, document_type }` — then read any page in two variants, markdown (append `.md` to the URL) or JSON (the `get-article-content` endpoint, `schema=true` for a method's request/response schema); and (2) the Wix MCP doc tools when your agent has them. This skill is a shared FALLBACK referenced by other Wix skills (wix-vibe-headless, wix-headless, wix-manage, …): those skills' bundled templates, recipes, and helpers are the primary implementation path — reach for docs lookup only to fill a gap they don't cover, or when iterating on an error. Triggers: look up a Wix API, find the Wix endpoint/method, confirm a Wix request body or field, verify a Wix API shape, explore Wix docs, which Wix API do I call, read a Wix method schema."
---

# Wix Docs — how to look things up (a fallback, not a first step)

Use this when you need the **exact** truth about a Wix API — endpoint, HTTP method,
request/response body, a field, an enum value, or an error — and the code you already
have doesn't cover it. **Never invent a Wix endpoint, path, body, or enum from memory.**

## Read this discipline first

**Docs lookup is a fallback for iteration — not the starting point.**

If you arrived here from another Wix skill (`wix-vibe-headless`, `wix-headless`,
`wix-manage`, …), that skill's **bundled templates, recipes, and helper snippets are the
implementation**. Build from them first. Come here only when:

- a shipped snippet/recipe doesn't cover the use case (a field, an endpoint, a flow), or
- a call errored and you need to confirm the correct shape to fix it, or
- you're extending the client with a new call the skill didn't ship.

A pinned/linked doc page is already curated — **read it directly; don't re-discover it with
search.** Search and menu-walking are for *finding* a page nothing pinned for you.

## Lane 1 — `curl` the public doc endpoints (default: zero-dependency, no auth)

These are **unauthenticated** public endpoints — plain `curl`, no token, no SDK, no MCP.
The right lane for client-only / dependency-free contexts. No auth headers on any of them.

### Step 1 — Search the docs (curl-only)

**`POST https://www.wixapis.com/mcp-docs-search/v1/docs/search`** — unauthenticated, no token.
It has **two variants** returning the same hits in different formats; append `/markdown` for the
markdown one:

| Variant | URL | Returns |
|---|---|---|
| **JSON** | `…/v1/docs/search` | `{ results: [ { id, title, content, url, relevance_score, kb_name } ] }` |
| **Markdown** | `…/v1/docs/search/markdown` | `{ content: "<one LLM-ready markdown string of all hits>" }` |

Both take the same JSON body:

| Field | Notes |
|---|---|
| `search_term` | required, 1–500 chars |
| `document_type` | `REST` (default) · `SDK` · `WIX_HEADLESS` · `BUSINESS_SOLUTIONS` · `VELO` · `WDS` · `BUILD_APPS` · `CLI` |
| `maximum_results` | default 15, range 1–20 |
| `lines_in_each_result` | default 20, range 1–200 |

```bash
# JSON variant — parse result[].url / .content
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"create booking","document_type":"REST","maximum_results":3}'

# Markdown variant — one ready-to-read string (best to hand straight to the model)
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"create booking","document_type":"REST","maximum_results":3}'
```

> Use **markdown** when you just want to read the top hits; use **JSON** when you need to pull a
> specific field (each hit's `url` is the docs page — read it in full in Step 2).

Two more curl-only discovery aids when you'd rather browse than search:

- **Portal index:** `curl https://dev.wix.com/docs/llms.txt` — a grep-able list of every portal
  page as `.md` links (`https://dev.wix.com/docs/llms-full.txt` is the full corpus).
- **Menu page:** truncate any docs URL to a parent path and append `.md` — e.g.
  `curl https://dev.wix.com/docs/api-reference/business-solutions/bookings.md`.

> If the Wix MCP is available, its search tools (Lane 2) return richer whole-resource schemas —
> prefer them when present.

### Step 2 — Read the page: two variants (both verified)

Same content, two formats. Pick by what you're doing:

**A. Markdown — append `.md` to the page URL** (the documented surface; best for reading prose
+ code examples, and it also renders menu pages):

```bash
curl -sS 'https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md'
# → Content-Type: text/markdown — raw article + SDK/REST examples
```

**B. JSON — `get-article-content`** (parseable envelope `{ ok, articleContent, resourceId }`;
add `schema=true` for the method's **request/response schema**, `schema=false` for prose):

```bash
# Method request/response schema, as JSON
curl -sS --get 'https://dev.wix.com/rawdocs/api/get-article-content' \
  --data-urlencode 'articleUrl=https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking' \
  --data-urlencode 'schema=true'
# → {"ok":true,"articleContent":"... Method: createBooking ...","resourceId":"..."}
```

- Use **A (`.md`)** to skim/read and for **menu** pages. Use **B (JSON)** when you want to parse
  the result programmatically or specifically need the method **schema** (`schema=true`).
- **B works only on real article/method URLs** — it returns `{"ok":false}` (HTTP 404) for a menu
  URL, so use **A** to browse menus and **B** to pull a concrete method's schema.

### Step 3 — Big pages: slice, don't swallow

A single method page is often **huge** (Create Booking's `.md` is ~144 KB / 900+ lines). It
carries **both** a `## REST API` and a `## JavaScript SDK` section (~70 KB each), and each has
its own `### Schema` (the bulk — 60 KB+ of inline, deeply-nested types) and a much smaller
`### Examples`. **Never read the whole thing into context** — map it, then cut to the one piece
you need. All of the below are plain `curl | awk/grep`, no dependencies:

**1. Map first — outline only (cheap, ~18 lines):**

```bash
curl -sS "$URL.md" | grep -nE '^#{1,3} '
# 26:## REST API   28:### Schema   329:### Examples   481:## JavaScript SDK   483:### Schema ...
```

**2. Keep only the API you use** — halves the page. (Better: search with `document_type: REST`
*or* `SDK` in Step 1 so hits already point at the right half.)

```bash
curl -sS "$URL.md" | awk '/^## REST API/{f=1} /^## JavaScript SDK/{f=0} f'   # REST only
curl -sS "$URL.md" | awk '/^## JavaScript SDK/{f=1} f'                       # SDK only
```

**3. Prefer Examples over Schema to model a call** — the examples block is small (~9 KB) and
usually enough to copy a working request:

```bash
curl -sS "$URL.md" | awk '/^## REST API/{r=1} r&&/^### Examples/{f=1} /^## JavaScript SDK/{f=0} f'
```

**4. Drill into a giant Schema by field — don't read it whole.** Schema lines are one-per-field:
`- name: <field> | type: <Type> | description: … | validation: …`. Grep the field(s) you care
about (each appears once for the request, once for the response — you get both shape + rules):

```bash
curl -sS "$URL.md" | grep -nE 'name: (selectedPaymentOption|totalParticipants)'
# to resolve a referenced type's enum values, grep the Type name, e.g.:  grep -nE 'SelectedPaymentOption'
```

**5. For deep/nested schemas, skip markdown entirely.** The JSON read (`get-article-content …
schema=true`, Step 2B) returns just the method schema; and if the Wix MCP is present,
`SearchWixAPISpec → getResourceSchemaByUrl` returns the **whole resource** (every method + shared
types) in one compact structured payload — far easier than slicing 60 KB of prose.

**6. Cap the search response** — on `…/docs/search/markdown`, pass `maximum_results` (1–20) and
`lines_in_each_result` (1–200) so each hit is truncated with a "Read more here: `<url>`" hint
instead of dumping full pages.

## Lane 2 — Wix MCP doc tools (only if your agent has them)

If the Wix MCP is connected, these beat blind curling for **discovery** and for the
**whole-resource** view. Optional — skip this lane entirely if the tools aren't present.

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

## The one rule about the `.md` suffix

**Only the markdown-twin read (variant A) uses `.md`.** `get-article-content` (variant B) and
every MCP tool take the plain docs URL **without** `.md`. So: append `.md` only when you're
`curl`-ing the page directly for markdown; strip it everywhere else. Never feed a `.md` URL to
an MCP tool or to `get-article-content`.

## Before you write the code

Confirm on the page — not from memory — the endpoint, the HTTP verb, the request body
shape, required fields, and any enum values. Then write the call. If you're extending a
skill's shipped client, keep the skill's existing transport/helper style; you're adding one
call, not re-architecting.
