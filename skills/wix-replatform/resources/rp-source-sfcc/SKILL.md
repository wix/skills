---
name: rp-source-sfcc
description: >-
  Salesforce Commerce Cloud (SFCC / Demandware, SFRA storefront) source techniques: how to
  get a store's public data with no Business Manager or OCAPI access — the files and public
  storefront endpoints to read, and how to scan the remaining site pages. Use when the
  source platform is SFCC.
---

# rp-source-sfcc

Technique guide for reading a **public** SFCC/SFRA storefront. It ships no capture code:
`rp-discovery` follows its "no adapter exists → capture manually, same output contract"
path, and you write the capture code for each migration as generated project code under
`migrations/<project>/src/`, with its outputs in `migrations/<project>/data/sfcc-discovery/`.
⚠️ Nothing site-specific (code, ids, values, fixtures) is ever added to this skill.

## Recognize the platform

- Pipeline URLs: `/on/demandware.store/Sites-<site>-Site/<locale>/<Controller>`. The
  homepage `og:url` often uses one, which gives you the site id and the default locale.
- Static assets: `/on/demandware.static/...`. Image renditions:
  `/dw/image/v2/<REALM>_<ENV>/...`.
- OCAPI (`/s/<site>/dw/shop/...`, `/s/-/dw/data/...`) answers `401` without credentials.
  Don't ask for Business Manager or OCAPI credentials in this flow; record them as a later
  phase. Use `sourceMode=public_content`.

## Files to read first

1. **`robots.txt`.** Obey it for every request, and take the sitemap index from it.
2. **Sitemaps** (index → `sitemap_N.xml`). These list products, categories and
   `<image:loc>` originals. ⚠️ **Sitemaps are incomplete.** Pre-order products and variant
   SKUs are commonly missing, some listed products aren't searchable, and some `*.html`
   entries are content assets or malformed. Never treat the sitemap as the catalog.
3. **The homepage, plus a few category and product pages.** Read the header, navigation,
   footer and `hreflang` links. The homepage may have no `hreflang`, so learn the locale
   routes from inner pages before you crawl.

## Public storefront endpoints (SFRA)

| Need | Endpoint / source | Notes |
|---|---|---|
| Category id | Category page markup (`cgid`) | Links carry it percent-encoded: decode it once, then encode it once when you build a request |
| Category members | `Search-ShowAjax?cgid=<id>&start=<n>&sz=<page>` | Page until `resultCount` is reached. Tiles are `div.product[data-pid]` with the PDP link. A zero-result listing is not a category |
| Full product model | `Product-Variation?pid=<id>&quantity=1` → JSON `{product}` | The main source: sales and list price, `variationAttributes` with every value, `options`, `availability`, min/max order quantity, descriptions, images with alt text, promotions, plus the store's own custom fields. It is a storefront controller, not a contracted API |
| Variant siblings | `Product-Variation?pid=<master>&dwvar_<master>_<attr>=<value>` | The master id appears in the value `url`s. A master alone returns `404`. Accept a value only when the response marks **that** value `selected`; `selectable: false` values may not be fetchable |
| Fallback | PDP `schema.org` JSON-LD (`Product`, `BreadcrumbList`) | It holds only the sales price and a flattened availability, so a record built from it lists the missing fields as unobserved |
| SEO and redirect source | PDP/category `<title>`, meta description, `og:*`, canonical | Detect template-generated SEO versus SEO set per item. Store paths decoded. A path is a redirect source, never a Wix slug |

The product set is the **union** of the grid tiles from every category (including
categories linked only from the navigation) and the sitemap's product URLs. Key products by
SFCC product id, not by URL: locale renditions have their own canonicals.

## Signals that are easy to misread

- **Product types.** Variation attributes create SKUs (Wix variant options). SFCC
  *product options* (e.g. engraving) change the price, not the SKU, so they are Wix
  modifiers. Keep them in separate fields.
- **Option visibility.** An option can be attached to a product but hidden on the
  storefront: its markup is present but hidden. SFRA has no standard visibility flag. Find
  the store's own custom field by comparing products where the option is shown and where
  it isn't. If you can't find one, record visibility as unknown and never drop the option.
- **Stock.** The values are `inStock`, `preorder` (with `inStockDate`, which only means a
  date when the status is `preorder`), and out of stock (often no status at all, only a
  message). `lowStockCount` and `maxOrderQuantity` are hints, never authoritative
  quantities.
- **Prices.** `price.list` is the compare-at price. `promotions[]` names promotion ids but
  never their rules. `callForPrice` hides the price and add-to-cart: that needs a human
  decision.
- **Images.** The original is the static path: drop `/dw/image/v2/<REALM>_<ENV>` and the
  query string. Larger `sw`/`sh` renditions are upscales.
- **Ratings** can be an aggregate number with no reviews behind it, which can't be imported
  as reviews.
- **Videos** may be opaque ids whose host is not exposed.

## Scan the other pages

Product and category pages are covered by the capture above. Everything else (about,
shipping, returns, FAQ, legal, store locator, forms, gift certificates, loyalty) is usually
linked **only** from the header and footer.

**Seeds:**
- the homepage;
- every link harvested from product and category pages;
- **every default-locale sitemap URL the catalog capture did not claim** (content assets and
  `Page-Show` pages often appear only there).

**Rules:**
- Stay on the same host, follow `robots.txt`, and skip the alternate-locale prefixes.
- **Admit content routes:** `Page-Show?cid=<id>` (SFRA content assets), Page Designer pages,
  `Stores-Find` (store locator), and ordinary `*.html` or extensionless content paths.
- **Skip only these:** assets; query variants of an already-seen page; catalog routes the
  capture owns (`Product-*`, `Search-*`); and action or AJAX routes (`Cart-*`, `Checkout*`,
  `Account-*`, `Login-*`, `Order-*`, `Wishlist-*`, `*-Ajax*`, form `POST` targets).
  ⚠️ Never skip a whole controller family that isn't on this list. Record it for review
  instead.
- Give every URL a disposition (`captured`, `covered-by-catalog`, `skipped:<reason>` or
  `failed:<status>`) in `data/sfcc-discovery/page-inventory.json`. Re-runs re-attempt
  `failed`.

For each captured page, read its content and propose the Wix destination: a static page,
CMS items, a form, pickup locations, a gift-card product, or a manual or dropped item.
Policy prose such as free-shipping thresholds, delivery times, VAT wording or the return
window is **evidence for Wix settings, not settings**.
- Quote it verbatim into `data/sfcc-discovery/policy-rules.json`, with `status: candidate`.
- Never fill in a value the text doesn't state.
- Have the user confirm each rule, including threshold boundaries, shipping option titles
  and delivery estimates. Store their verbatim answer and set `status: confirmed` before
  anything is written to Wix.

## Be polite and resumable

- Keep one throttle for every request (start around 60 per minute), use a bounded timeout,
  and retry `429`/`503` honoring `Retry-After`.
- Checkpoint as you go, so a re-run resumes and re-attempts only failures. Refresh prices
  and stock just before import.
- Decode URLs tolerantly: a malformed `%` must not abort the run.

## Hand-off (existing artifacts only)

Each stage writes only its own part, through the contracts that already exist:

| Stage (producer) | Writes | Read by |
|---|---|---|
| Capture code (`migrations/<project>/src/`) | Raw data, `page-inventory.json`, `policy-rules.json` under `data/sfcc-discovery/` | `rp-discovery` |
| `rp-discovery` | `source-schema.json` (catalog entities, `site_page`, confirmed rules as `site_policy_rule`, gaps in `sourceMeta`) and the "Gaps" section of `source-profile.md`, naming each cutover item below | `rp-mapper` |
| `rp-mapper` | `mapping/mapping-plan.json`, including each routed entity's `urlPolicy`; one `mapping/review/mapping-gaps.json` row per cutover item | `rp-setup-discovery`, `rp-import-codegen` |
| `rp-setup-discovery` | One `setup/setup-requirements.json` entry per cutover item (`automation: manual` or `blocked`, the `requirementId` below, `recommendedAction`) | The website handoff (`setupContract.manualBlockers`) |
| Generated import code | URL state in `state/url-preservation/`, through `lib/url-preservation-state.js` (below) | Resume, redirect planning, cutover |

URL state, each file in its own role:
- `base-paths.json`: entity-level route intent from mapping `urlPolicy`.
- `url-ledger.ndjson`: one append-only row per public record (source URL, planned and actual
  target).
- `redirects.ndjson`: only when both relative URLs are known and differ.
- `unresolved.ndjson`: only URLs still waiting on a route decision, a target lookup or
  manual review.
- A preserved URL (same relative path) closes with no redirect.

Cutover items:

| `requirementId` | Trigger | Owner → action | Resolves when |
|---|---|---|---|
| `sfcc-redirects` | Planned `redirects.ndjson` rows exist | Cutover Operator → enter them in Wix when the domain moves (there is no redirect API) | Each planned old URL lands on its target after cutover |
| `sfcc-page-build:<path>` | A captured page with no automatic destination, or an `unresolved.ndjson` `manual_review` page | Cutover Operator → build the page from its captured content, or mark it dropped, before launch | The page is published at its target URL (then its ledger row and redirect follow), or a recorded drop decision exists |
| `sfcc-policy-unconfirmed:<domain>` | A rule still `candidate` in `policy-rules.json` | **Requires Import Operator** → "Confirm or reject the candidate rules in `data/sfcc-discovery/policy-rules.json` with the merchant, then re-run mapping and setup for `site_policy_rule`" | Every rule is `confirmed` (with the Wix setting read back) or `rejected`, each with the merchant's verbatim answer |
| `sfcc-call-for-price` | A product that hides its price | **Requires Import Operator** → "Ask the merchant how each call-for-price product should sell on Wix, record the answer, and re-import those products" | A recorded answer, and the products read back in that state |
| `sfcc-option-visibility` | Option visibility is unknown | **Requires Import Operator** → "Confirm which add-on options shoppers can buy, then re-import the affected products" | A recorded answer, and the options read back |
| `sfcc-partial-variants:<master>` | Unresolved variant values | **Requires Import Operator** → "Re-run the capture to re-attempt them; ask the merchant whether any remaining values are retired" | Every value is resolved or recorded as retired |
| `sfcc-authenticated-data` | Always, on a public-only run | Cutover Operator → tell the merchant that promotion rules, real inventory, customers, orders, gift-certificate balances and offline products need Business Manager access later | A recorded merchant acknowledgement, or the later authenticated pass is complete |
| `sfcc-alternate-locale:<locale>` | Locale renditions seen but not captured | Cutover Operator → tell the merchant that locale isn't migrated yet | A recorded merchant acknowledgement, or a later locale pass is complete |

⚠️ No cutover UI reads these yet. They are preserved for it, not wired to it.
