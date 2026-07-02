# Extracting what you need from big doc pages

`SKILL.md`'s flow — find a page, then read it — covers the common case. This is the detail for the
**two heavy pages** you hit along the way: big **menu** pages (when you navigate by hand) and big
**method** pages (the actual API reference). The goal both times: pull only the part you need with
`curl` + `grep`/`awk`, never swallow the whole page. No dependencies.

## Menu pages — find the child link fast

A menu page (a section path + `.md`) is a list of links to its children and can be tens of KB. Don't
read it whole:

- **Grep it** for the child you're after, then drill into that URL:

  ```bash
  curl -sS 'https://dev.wix.com/docs/api-reference/business-solutions/bookings.md' | grep -i 'booking'
  ```

- **Walk down** by extending the path and re-appending `.md` — e.g. the portal root
  `https://dev.wix.com/docs/api-reference.md` → a vertical `…/business-solutions/bookings.md` → a
  resource `…/bookings/bookings/bookings-writer-v2.md`.
- **The whole tree at once:** `https://dev.wix.com/docs/llms.txt` is the grep-able index of every
  page; `https://dev.wix.com/docs/llms-full.txt` is the full concatenated corpus (very large — grep,
  don't read).

## Method pages — slice, don't swallow

A method page is often **huge** (Create Booking's `.md` is ~144 KB / 900+ lines). It carries **both**
a `## REST API` and a `## JavaScript SDK` section (~70 KB each), and each has its own `### Schema`
(the bulk — 60 KB+ of inline, deeply-nested types) and a much smaller `### Examples`. Map it, then
cut to the one piece you need.

**1. Map first — outline only (cheap, ~18 lines):**

```bash
curl -sS "$URL.md" | grep -nE '^#{1,3} '
# 26:## REST API   28:### Schema   329:### Examples   481:## JavaScript SDK   483:### Schema ...
```

**2. Keep only the API you use** — halves the page. (Better: search with `document_type: REST` *or*
`SDK` so hits already point at the right half.)

```bash
curl -sS "$URL.md" | awk '/^## REST API/{f=1} /^## JavaScript SDK/{f=0} f'   # REST only
curl -sS "$URL.md" | awk '/^## JavaScript SDK/{f=1} f'                       # SDK only
```

**3. Prefer Examples over Schema to model a call** — the examples block is small (~9 KB) and usually
enough to copy a working request:

```bash
curl -sS "$URL.md" | awk '/^## REST API/{r=1} r&&/^### Examples/{f=1} /^## JavaScript SDK/{f=0} f'
```

**4. Drill into a giant Schema by field — don't read it whole.** Schema lines are one-per-field:
`- name: <field> | type: <Type> | description: … | validation: …`. Grep the field(s) you care about
(each appears once for the request, once for the response — you get both shape + rules):

```bash
curl -sS "$URL.md" | grep -nE 'name: (selectedPaymentOption|totalParticipants)'
# resolve a referenced type's enum values by grepping the Type name, e.g.:  grep -nE 'SelectedPaymentOption'
```

**5. Cap the search response** — on `…/docs/search/markdown`, pass `maximum_results` (1–20) and
`lines_in_each_result` (1–200) so each hit is truncated with a "Read more here: `<url>`" hint instead
of dumping full pages.

**For deep/nested schemas**, don't hand-slice markdown — query the structured spec instead
(`references/API_SPEC_SEARCH.md`, or the Wix MCP `SearchWixAPISpec → getResourceSchemaByUrl`).
