---
name: wix-docs
description: "Look up the Wix API/SDK documentation to confirm an exact endpoint, HTTP method, request/response shape, field, enum, or error before writing Wix code — never guess a Wix API from memory. A lookup is a short flow: find the right page, then read it. Two ways: (1) plain `curl` (zero dependencies) — a semantic search endpoint (`POST /mcp-docs-search/v1/docs/search`, natural-language `{ search_term, document_type }`) to find pages, then read any page by appending `.md` to its docs URL; and (2) the Wix MCP doc tools when your agent has them. Triggers: look up a Wix API, find the Wix endpoint/method, confirm a Wix request body or field, verify a Wix API shape, explore Wix docs, which Wix API do I call, read a Wix method schema."
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

### 1. Find the page

Fastest is a **semantic** search — describe what you want in natural language ("let a customer book
an appointment"), not just keywords; hits come back ranked by relevance, each with a docs `url`.
It has two variants — append `/markdown` for the second:

| Variant | URL | Returns |
|---|---|---|
| **JSON** | `POST …/mcp-docs-search/v1/docs/search` | `{ results: [ { title, url, content, relevance_score, … } ] }` |
| **Markdown** | `POST …/docs/search/markdown` | `{ content: "<one LLM-ready markdown string of all hits>" }` |

Same JSON body: `search_term` (required, 1–500), `document_type` (`REST` default · `SDK` ·
`WIX_HEADLESS` · `BUSINESS_SOLUTIONS` · `VELO` · `WDS` · `BUILD_APPS` · `CLI`), `maximum_results`
(1–20, def 15), `lines_in_each_result` (1–200, def 20).

```bash
# markdown — hand straight to the model; append nothing for JSON to parse result[].url
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"create a booking","document_type":"REST","maximum_results":3}'
```

Each hit's `url` is the page to read next. (Rather navigate by hand? Start at a menu page — see
below. If the Wix MCP is present, its search is richer — Lane 2.)

### 2. Read what you land on

Appending `.md` to a URL gives one of **three kinds of page**. Know which you're looking at, and
handle it accordingly:

- **Menu page** — what a *section* path returns (truncate any URL to a parent + `.md`, e.g.
  `…/business-solutions/bookings.md`; the root of the tree is `https://dev.wix.com/docs/llms.txt`).
  It's a list of links to child pages and can be tens of KB — **don't read it whole; `grep` it** for
  the child you want, then drill in:

  ```bash
  curl -sS 'https://dev.wix.com/docs/api-reference/business-solutions/bookings.md' | grep -i 'booking'
  ```

- **Article / guide** — introductions, concepts, sample-flow pages. Prose markdown, usually small —
  **read it whole**:

  ```bash
  curl -sS 'https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/introduction.md'
  ```

- **Method page** — one API method, and the heavy one: it carries **both** a REST and a JavaScript
  SDK section, the full request/response schema, and code examples — often 100 KB+. The **examples**
  are usually all you need; **don't swallow the whole page.** To pull just the example/section/field,
  see `references/READING_PAGES.md`. For the exact structured schema and enum values, see
  `references/API_SPEC_SEARCH.md` (a `curl` query over the API spec — the no-MCP equivalent of the
  MCP `SearchWixAPISpec`).

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

## The `.md` suffix

Append `.md` only when `curl`-ing a page directly. The MCP tools and the search endpoint take the
plain docs URL **without** `.md` — never feed a `.md` URL to an MCP tool.

## Before you write the code

Confirm on the page — not from memory — the endpoint, the HTTP verb, the request body shape,
required fields, and any enum values. Then write the call. If you're extending a skill's shipped
client, keep the skill's existing transport/helper style; you're adding one call, not
re-architecting.
