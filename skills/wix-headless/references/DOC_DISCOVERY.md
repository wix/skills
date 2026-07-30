# Doc discovery — the shared fallback (seeding *and* code-writing)

You're here because a **pinned** page or recipe didn't cover what you need — a field, an endpoint,
an error, or an unpinned method. Doc discovery is the **fallback for both tracks**, never the first
move:

- **Seeding** → read the capability's **inline recipe** — `inline-recipes/setup-*.md`, mapped in
  `SEED.md` § "What to seed per capability". Each built capability is a **self-contained local recipe** that inlines the calls
  and **supersedes** the REST doc pages — seed from it alone. Only a capability with **no** inline
  recipe (e.g. `coupons`) discovers from the live docs (below).
- **Code-writing** → try the pinned pages in `astro.md` / `non-astro.md` + `inline-recipes/*`.
- Only when those fall short, discover from the live docs (below).

The **`wix-docs`** skill is the full playbook (`../wix-docs/SKILL.md` when co-installed). The short
version:

**1. Find a page — semantic `curl` search (no MCP required):**

```bash
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"<what you need, in natural language>","document_type":"WIX_HEADLESS","maximum_results":3}'
```

`document_type`: `SDK` / `WIX_HEADLESS` for code-writing, `REST` / `BUSINESS_SOLUTIONS` for seeding
(also `VELO` · `WDS` · `BUILD_APPS` · `CLI`). Drop `/markdown` for JSON hits.

**2. Read a page** — append `.md` to its docs URL. **For an SDK shape, append `.md?apiView=SDK`** —
the SDK view shows `_id` (what the frontend calls), the bare view shows `id`.

**3. Exact structured schema / enums (no MCP)** — `POST https://mcp.wix.com/api/code-mode/search`
with `getResourceSchemaByUrl(docsUrl)` (see `wix-docs`'s `API_SPEC_SEARCH.md`).

**If the host has the Wix MCP**, its `SearchWix*` / `SearchWixAPISpec → getResourceSchemaByUrl`
tools are richer (whole-resource schema in one payload) — prefer them, per `wix-docs` Lane 2.

**A page that IS pinned → read it directly; don't re-search for it.**
