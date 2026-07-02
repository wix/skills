---
name: wix-docs
description: "Best-practices reference for looking up the Wix API/SDK documentation when you need to confirm an exact endpoint, HTTP method, request/response shape, field, enum, or error before writing Wix code — never guess a Wix API from memory. Two lookup lanes: (1) unauthenticated `curl` against the public doc-search + rawdocs endpoints (zero dependencies, no token — the default), and (2) the Wix MCP doc tools when your agent has them. Also covers the `.md`-twin trick for raw markdown. This skill is a shared FALLBACK referenced by other Wix skills (wix-vibe-headless, wix-headless, wix-manage, …): those skills' bundled templates, recipes, and helpers are the primary implementation path — reach for docs lookup only to fill a gap they don't cover, or when iterating on an error. Triggers: look up a Wix API, find the Wix endpoint/method, confirm a Wix request body or field, verify a Wix API shape, explore Wix docs, which Wix API do I call, read a Wix method schema."
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
This is the right lane for client-only / dependency-free contexts.

| Need | Request |
|---|---|
| Search REST / SDK / headless docs | `GET https://www.wixapis.com/mcp-docs-search/v1/search?kbName=<KB>&searchTerm=<q>&maxResults=<n>` |
| Read a full article | `GET https://dev.wix.com/rawdocs/api/get-article-content?articleUrl=<url>&schema=false` |
| Read a method's request/response schema | Same URL with `schema=true` |
| Browse the REST docs menu tree | `GET https://dev.wix.com/docs/api/v1/get-menu-content?url=<url>&format=markdown` |

`kbName` values: `REST_METHODS_KB_ID`, `SDK_KB_ID`, `HEADLESS_KB_ID`.

```bash
# Find the method (search)
curl -sS --get 'https://www.wixapis.com/mcp-docs-search/v1/search' \
  --data-urlencode 'kbName=REST_METHODS_KB_ID' \
  --data-urlencode 'searchTerm=create booking' \
  --data-urlencode 'maxResults=3'

# Read the method's request/response schema (schema=true)
curl -sS --get 'https://dev.wix.com/rawdocs/api/get-article-content' \
  --data-urlencode 'articleUrl=https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking' \
  --data-urlencode 'schema=true'
```

No auth headers required on any of these.

### The `.md`-twin trick (works for any docs URL)

- **Append `.md`** to any `https://dev.wix.com/docs/...` URL to get its raw markdown
  (content pages carry the schema; menu pages list child links).
- **Truncate to a parent path + `.md`** for a menu page — e.g.
  `https://dev.wix.com/docs/sdk.md`, `.../business-solutions.md`.
- Portal indexes: `https://dev.wix.com/docs/llms.txt` (all portals) and
  `https://dev.wix.com/docs/llms-full.txt` (full concatenated docs).

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

## The one rule that keeps the lanes straight

**`curl` uses the `.md` suffix; the MCP tools take the URL *without* `.md`.** Don't feed a
`.md` URL into an MCP tool, and don't strip `.md` when curling. Pick one lane per lookup.

## Before you write the code

Confirm on the page — not from memory — the endpoint, the HTTP verb, the request body
shape, required fields, and any enum values. Then write the call. If you're extending a
skill's shipped client, keep the skill's existing transport/helper style; you're adding one
call, not re-architecting.
