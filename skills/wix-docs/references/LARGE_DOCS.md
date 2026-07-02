# Browsing the index & slicing big doc pages

Advanced `curl`-only techniques for when **search** (`SKILL.md` Lane 1, Step 1) isn't the right
move — either you'd rather **navigate** the doc tree, or you've landed on a **huge** page and need
to cut it down. All dependency-free (`curl` + `awk`/`grep`), no token, no MCP.

## Browse the index (navigate instead of search)

- **Portal index:** `curl https://dev.wix.com/docs/llms.txt` — a structured, **grep-able** list of
  every portal page as `.md` links (~440 lines). Its header documents the traversal rules.
  `curl https://dev.wix.com/docs/llms-full.txt` is the full concatenated corpus (large).
- **Menu page:** truncate any docs URL to a parent path and append `.md` — it renders as a list of
  child links. E.g. `curl https://dev.wix.com/docs/api-reference/business-solutions/bookings.md`
  lists the Bookings resources; `https://dev.wix.com/docs/sdk.md` lists the SDK portal.
- Reminder: the `.md` twin is for **`curl`**. `get-article-content` and the MCP tools take the URL
  **without** `.md`.

## Big pages: slice, don't swallow

A single method page is often **huge** (Create Booking's `.md` is ~144 KB / 900+ lines). It
carries **both** a `## REST API` and a `## JavaScript SDK` section (~70 KB each), and each has its
own `### Schema` (the bulk — 60 KB+ of inline, deeply-nested types) and a much smaller
`### Examples`. **Never read the whole thing into context** — map it, then cut to the one piece you
need.

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

**5. Cap the search response** — on `…/docs/search/markdown`, pass `maximum_results` (1–20) and
`lines_in_each_result` (1–200) so each hit is truncated with a "Read more here: `<url>`" hint
instead of dumping full pages.

**For deep/nested schemas**, prefer the structured API-spec query over slicing markdown — see
`references/API_SPEC_SEARCH.md` (or the Wix MCP `SearchWixAPISpec → getResourceSchemaByUrl`).
