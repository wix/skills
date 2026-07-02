---
name: wix-docs
description: "Look up the Wix API/SDK documentation to confirm an exact endpoint, HTTP method, request/response shape, field, enum, or error before writing Wix code — never guess a Wix API from memory. Two lookup lanes: (1) unauthenticated `curl` (zero dependencies, no token): search the docs via `POST /mcp-docs-search/v1/docs/search` (JSON) or `/docs/search/markdown` (LLM-ready markdown), passing `{ search_term, document_type }` — then read any page in two variants, markdown (append `.md` to the URL) or JSON (the `get-article-content` endpoint, `schema=true` for a method's request/response schema); and (2) the Wix MCP doc tools when your agent has them. Triggers: look up a Wix API, find the Wix endpoint/method, confirm a Wix request body or field, verify a Wix API shape, explore Wix docs, which Wix API do I call, read a Wix method schema."
---

# Wix Docs — look up the Wix API/SDK documentation

Use this to get the **exact** truth about a Wix API — endpoint, HTTP method, request/response
body, a field, an enum value, or an error. **Never invent a Wix endpoint, path, body, or enum
from memory** — confirm it here first.

If you already have a specific page URL, **read it directly** (Step 2); search and menu-walking
are for *finding* a page you don't have yet.

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
>
> Prefer to **browse** the tree instead of searching (the `llms.txt` index, menu pages)? See
> `references/LARGE_DOCS.md`. If the Wix MCP is available, its search tools (Lane 2) return richer
> whole-resource schemas — prefer them when present.

### Step 2 — Read the page: two variants

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

### Going deeper (references)

- **Big pages / browsing the tree** → `references/LARGE_DOCS.md`. Method pages are large and carry
  **both** a `## REST API` and a `## JavaScript SDK` section (~70 KB each) — don't read one whole;
  map its outline and slice to the section/field you need. Also covers browsing the `llms.txt`
  index and menu pages.
- **Exact structured schema / enums / error codes, without MCP** → `references/API_SPEC_SEARCH.md`.
  An unauthenticated `POST https://mcp.wix.com/api/code-mode/search` runs a JS query over the API
  spec (`lightIndex` + `getResourceSchema`) — the no-MCP equivalent of `SearchWixAPISpec`.

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
