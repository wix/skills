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

### A partial map to orient from

Paths under `https://dev.wix.com/docs/` — **append `.md` to any of them** to read that page.
**This is a pruned map, not the full tree** — `…` marks where real children were left out; the
deep leaves are cherry-picked to show how far it goes. Re-derive from the `.md` menus / `llms.txt`
for anything not shown.

```text
dev.wix.com/docs/                                      ← append .md to any path below
├── api-reference/                                     all backend APIs — REST + SDK on every page
│   ├── business-solutions/                            vertical → app/version → resource → method
│   │   ├── stores/
│   │   │   └── catalog-v3/                            V3 catalog (introduction · e-commerce-integration · …)
│   │   │       ├── products-v3/                       the products resource
│   │   │       │   ├── query-products                 ← method page (leaf: schema + examples)
│   │   │       │   ├── create-product-with-inventory  ← method (create + stock in one call)
│   │   │       │   └── get-product · search-products · update-product · count-products · …
│   │   │       └── inventory-items-v3/ · categories/ · customizations-v3/ · brands-v3/ · …
│   │   ├── bookings/
│   │   │   └── bookings/                              core resource group (nested under the vertical)
│   │   │       ├── bookings-writer-v2/                writes
│   │   │       │   └── create-booking                 ← method (leaf); + bulk-create-booking · …
│   │   │       └── bookings-reader-v2/ · attendance/ · waitlist/ · …
│   │   ├── e-commerce/                                cart, checkout, orders, discounts
│   │   ├── cms/                                       Wix Data — data-items, collections
│   │   └── blog/ · events/ · pricing-plans/ · restaurants/ · portfolio/ · gift-cards/ · coupons/ · donations/ · …
│   ├── crm/                                           contacts, members, forms, inbox, loyalty
│   ├── business-management/                           payments, invoices, SEO, site-properties, automations
│   ├── app-management/                                install apps, OAuth, app-instance/installations
│   ├── assets/                                        media, rich-content
│   └── account-level/ · site/ · tools/ · articles/    domains/sites, site config, auth/query guides
├── sdk/                                               SDK-only surfaces (not in api-reference)
│   ├── articles/set-up-a-client                       createClient + OAuthStrategy setup
│   ├── core-modules/
│   │   ├── sdk/                                       @wix/sdk
│   │   │   ├── wix-client · oauth-strategy · setup    client creation + auth strategies
│   │   │   └── media · api-key-strategy · app-strategy · …
│   │   └── essentials/ · realtime/ · web-methods/     elevate/host-bridge · realtime · web methods
│   ├── host-modules/                                  dashboard · editor · site (build on Wix surfaces)
│   └── frontend-modules/
│       ├── members/                                  introduction · custom-fields · …
│       └── pay/ · seo/ · storage/ · pricing-plans/ · location/ · …
├── go-headless/                                       headless setup, auth, hosting, framework integration
├── build-apps/                                        building Wix apps / extensions
├── wix-cli/
│   ├── guides/                                        project-structure · about-the-wix-cli · …
│   └── command-reference/                             project-creation · project-commands · global-commands
├── velo/ · develop-websites/                          Velo site-coding APIs + guides
└── …                                                  (full portal list: curl llms.txt)
```

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
