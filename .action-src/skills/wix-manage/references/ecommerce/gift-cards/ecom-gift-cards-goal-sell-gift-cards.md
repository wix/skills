---
name: "Goal: Sell Gift Cards"
description: SELL_GIFT_CARDS goal — the GIFT_CARDS domain logic loaded by the strategy orchestrator. Sizes a gift card product from the site's own AOV and catalog prices (preset denominations, custom amount range, expiration policy) and gates on the site already selling gift cards. Sub-step, NOT a direct entry point — load Recommend: eCommerce Strategy first; it owns domain activation, cross-domain dedup, and tracking.
references:
  - name: "API: Recommendation Tracking"
    path: ecommerce/api-recommendation-tracking.md
    load: false
  - name: "eCommerce: Load Context"
    path: ecommerce/ecom-load-context.md
    load: false
---
# Goal: Sell Gift Cards

> ⛔ **Routing gate — [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) must be loaded before this file.**
>
> This is the GIFT_CARDS domain sub-step, not a direct entry point. If you have not yet loaded the orchestrator in this conversation, **stop and load it now**. It owns domain activation (its Step 4), the recommendation-history check that stops you re-pitching a rejected gift card (its Step 2), and the 5-recommendation cap. This file owns what's specific to gift cards: the existing-product gate, eligibility, denomination sizing, expiry policy, persistence of this recommendation (Step 5), and the create-call mapping.

**Goal ID:** `SELL_GIFT_CARDS`

Produces **at most one** recommendation — create a gift card product on a site that doesn't sell one yet — carrying the full product design: name, description, preset denominations, custom amount range, expiration policy. Amounts are calibrated from the site's own AOV and catalog price distribution.

The orchestrator activates this domain on "should I sell gift cards", "add a gift card", "which amounts should my gift card offer", gift-card denominations, a gifting-season prompt where a gift card is the lever, or an open "boost my sales" prompt on a site that sells no gift card yet with a gifting occasion near.

**Not this goal:** issuing / redeeming / voiding / emailing an individual gift card is the [Gift Cards API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-cards) — a direct operation, not a recommendation. Changing denominations on a product that already exists is [Update Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product).

## Execution rules

1. **Do NOT ask clarifying questions.** The only question you may ask is the expiration question in Step 3d, and only if the merchant already raised expiry.
2. **Do NOT size denominations before calling the APIs below.** Amounts invented without the site's AOV and price distribution are wrong even when they look plausible.
3. **Every number in `reasoning` must come from an API response.** Name the call it came from.
4. **Persist before presenting.** The recommendation must be written via `BatchCreate` (Step 5) before the merchant sees it, unless they said `SKIP_TRACKING`.
5. **Never create the gift card product here.** Creation happens only after the merchant approves the persisted recommendation (Step 6).
6. **A site supports a maximum of ONE gift card product.** If one exists, there is nothing to recommend — Step 1 drops this domain.
7. **All amounts are in the site's currency.** Never hard-code a currency symbol, and never assume USD.
8. **Always state the expiry stance** in what you show the merchant — see Step 3d.

---

## Step 1: Check whether the site already sells gift cards

**MANDATORY HARD GATE — a site supports a maximum of 1 gift card product.** Skipping this produces a recommendation that can only fail with `GIFT_CARD_PRODUCT_ALREADY_EXISTS` (409) at creation time.

**Endpoint:** `POST https://www.wixapis.com/gift-cards/v1/gift-card-products/query`

```json
{ "query": { "cursorPaging": { "limit": 10 } } }
```

**Response** (amounts are in the site's currency; `formattedAmount` carries the site's own symbol — use it when displaying):
```json
{
  "giftCardProducts": [
    {
      "id": "9041ce44-2efe-4d07-a3ae-b7084be31339",
      "revision": "1",
      "name": "eGift Card",
      "expirationType": "NONE",
      "presetVariants": [
        { "id": "40ab14eb-...", "price": { "amount": "50", "formattedAmount": "50.00" }, "value": { "amount": "50" } }
      ],
      "customVariant": { "minValue": { "amount": "10" }, "maxValue": { "amount": "100" } }
    }
  ],
  "pagingMetadata": { "count": 1, "hasNext": false }
}
```

| Outcome | Action |
|---|---|
| `giftCardProducts` is empty | Continue to Step 2. |
| One or more products returned | **Drop the GIFT_CARDS domain** — no create recommendation, nothing persisted, and the orchestrator reuses the freed slot. Then answer with the existing-product review below rather than a bare stop. |
| Call fails with `403` / app-not-installed | Wix Gift Cards is not available on this site. Report the blocker verbatim; do not recommend around it. |
| Call fails for any other reason | Report the exact error and drop the domain. Do **not** assume "no product exists" — a false negative here produces a guaranteed-to-fail recommendation. |

### When a product already exists — review it, don't re-pitch it

A merchant asking "should I sell gift cards / which amounts?" who already has a product wants their **current** setup assessed. Never emit a create recommendation, never persist anything, and never propose a second product — a site supports one. Instead, read the design rules in Step 3 and report:

1. **What exists** — `name`, the preset amounts and custom range from the Query response (use `formattedAmount`), and the expiry stance read from `expirationType`: `NONE` → "these never expire, which is the safer default"; `RELATIVE` / `FIXED` → state the period or date and flag that gift card expiry is regulated and varies by market, so it's worth confirming it's permitted where they sell.
2. **Whether the amounts still fit** — size the ladder you *would* pick from the site's data (Step 3a–3c) and compare. Say plainly if the current presets sit far from that (e.g. every preset below the median product price, or a top preset far above anything the store sells), and name the numbers on both sides.
3. **How to change it** — [Update Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product) (`PATCH`, needs the current `revision`), and the dashboard link at the end of Step 5. Updating replaces the whole `presetVariants` list; individual presets can't be patched.

**Expiry gets stated in this path too** — reading it off the existing product, per Step 3d. A gift-card answer that never mentions expiry is incomplete regardless of which branch you took.

---

## Step 2: Eligibility and urgency

Site data comes from the orchestrator's context load ([eCommerce: Load Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context)) — `siteData.currency`, `language`, `country`, `industry`, `aov`, `orders30d`, `visitors30d`, `catalogAnalytics`, `hasCatalog`. **Do not re-fetch any of it.**

### Step 2a: Eligibility gates

| Condition | Decision |
|---|---|
| `siteData.hasCatalog === false` (0 products) | **Drop the domain.** "Gift cards need something to spend them on. Add products to your catalog first." |
| `aov` is available (site has orders) | **Continue** — `aov` alone is enough to size denominations. Missing or empty `catalogAnalytics` is **not** a blocker; you simply skip the catalog clamps in Step 3b. |
| `aov` unavailable but `catalogAnalytics` has price data | **Continue** — anchor on the catalog median instead. |
| **Both** missing — no `aov` **and** no usable catalog price data | **Drop the domain.** "Cannot size gift card denominations — this site has no order or catalog price data to base amounts on." Do not fall back to a stock 25/50/100 ladder, and do not invent product names or prices. Saying you can't size it yet is the correct answer here; offer to proceed if the merchant names a typical order value. |
| `orders30d === 0` **and** `visitors30d < 100` | Continue, but urgency is `LOW` and `reasoning` must say the store has little traffic to convert yet. |
| Everything else | Continue. |

### Step 2b: Gifting-occasion window

Gift cards are the classic last-minute gift, so the product must be live **≥ 21 days before** the occasion to catch the buying window — that lead time is the whole reason urgency matters here.

Using `current_date` and `siteData.country`, resolve the nearest gifting occasion within **75 days** **for that country**. Do not assume a US calendar — the same occasion moves, and some don't exist locally:

- **Mother's Day** — 2nd Sunday of May in the US, CA, AU; late March (Mothering Sunday) in the UK and IE; other dates elsewhere.
- **Year-end gifting** — peaks in the days before Dec 25 across most of Europe, but in Spain and much of Latin America the gift-giving peak shifts to Reyes on Jan 6.

Other occasions worth resolving per country rather than assuming: Valentine's Day, Father's Day, graduation season, Black Friday, Boxing Day, Lunar New Year, Diwali, Eid al-Fitr, Hanukkah.

If nothing lands within 75 days, do **not** drop the domain — recommend the evergreen case (birthdays, last-minute gifts, indecisive buyers) at lower urgency.

### Step 2c: Urgency

| Condition | `urgency` |
|---|---|
| Gifting occasion 21–75 days out | `HIGH` |
| Gifting occasion under 21 days out | `MEDIUM` — the product can still go live, but say the buying window is already open and part of it is lost |
| No occasion in window, but a gifting-heavy industry (fashion, beauty, jewelry, food & drink, wellness/spa, art, home decor, toys, books) **or** `orders30d >= 10` | `MEDIUM` |
| Anything else | `LOW` |

**Never use `CRITICAL`.** Gift cards are a revenue opportunity, never a blocker — the orchestrator reserves `CRITICAL` for broken configuration (no shipping coverage, no payment method).

---

## Step 3: Design the gift card product

All amounts are **decimal strings** in `siteData.currency`. The numbers in the examples below are bare on purpose — no currency symbol belongs in the params.

### Step 3a: Pick the anchor

| Available data | `anchor` |
|---|---|
| `orders30d >= 1` and `aov > 0` | `aov` (= `gpv30d / orders30d`) — what customers actually spend. **Preferred, and sufficient on its own.** |
| No `aov`, but `catalogAnalytics` has prices | `p50` — the median price from the "All Products" group |

`aov` comes from the metasite profile fields the orchestrator already loaded, **not** from the catalog — so a failed or empty `GetCatalogAnalytics` does not stop you sizing denominations. Only both sources missing does (Step 2a).

When `catalogAnalytics` is available, also read `priceMin` (`min(price)`), `priceMax` (`max(price)`), and `p90` from the "All Products" group — they only tune the clamps in Step 3b. Ignore every other `categoryName`: category-level stats do not size a store-wide gift card.

### Step 3b: Preset denominations

1. Candidates: `anchor × 0.5`, `anchor × 1`, `anchor × 2`, `anchor × 4`.
2. Round each to a "nice" number:

   | Raw amount | Round to nearest multiple of |
   |---|---|
   | < 50 | 5 |
   | 50 – 199 | 10 |
   | 200 – 499 | 25 |
   | ≥ 500 | 50 |

3. Floor every value at `10`. Drop duplicates. Sort ascending.
4. **If `priceMin` is known** and the lowest preset falls below it, raise it to `priceMin` rounded **up** with the table — a card that can't buy the cheapest item is dead weight. Skip this step when catalog stats are unavailable.
5. **If `priceMax` is known**, cap the highest preset at `priceMax × 2` rounded with the table. Skip when unavailable.
6. Keep **3–5 presets**. Fewer than 3 after dedupe ⇒ add `anchor × 3` (rounded) until you have 3.

**Worked example** — `aov = 62`, `priceMin = 18`, `priceMax = 210`, all in the site's currency:
`31 → 30`, `62 → 60`, `124 → 120`, `248 → 250`; cap check `210 × 2 = 420` → no change ⇒ `["30", "60", "120", "250"]`.

The rounding table is currency-agnostic: it operates on the site's own currency units, whatever they are. Do not convert to another currency first, and do not re-tune the thresholds per currency.

### Step 3c: Custom variant

Always include one — it captures buyers whose budget sits between presets.

- `minValue` = `min(lowest preset ÷ 2, priceMin)`, rounded with the table, floored at `10`.
- `maxValue` = `highest preset × 2`, rounded with the table.
- **`minValue` must be strictly less than `maxValue`** — otherwise creation fails with `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_INVALID_CUSTOM_AMOUNTS_RANGE`.

Continuing the example: `minValue = "15"`, `maxValue = "500"`.

### Step 3d: Expiration policy

**Default: no expiration. Leave `expirationMonths` unset.** Two reasons, both worth stating in `reasoning`:

- Expiry on stored-value cards is regulated, and the rules differ by market — some jurisdictions impose a multi-year minimum, others ban expiry outright. You cannot assess which applies from API data.
- Unexpiring cards convert better and generate fewer support tickets.

Only if the merchant explicitly asked for an expiry: propose `expirationMonths: 60` (5 years), and add to `reasoning`: "Expiry set at the merchant's request. Gift card expiry is regulated in many jurisdictions — confirm 5 years is permitted where you sell." Never propose fewer than 60 months. Never volunteer an expiry the merchant didn't ask for.

**State the expiry stance explicitly, every time — in every branch.** When you're recommending a new product it must appear in all three of `reasoning`, `successCriteria`, and the prose you show the merchant; when a product already exists, report that product's `expirationType` instead (Step 1). Concretely, for a new product — "these cards never expire, which is also the safer default because expiry is regulated and varies by market", or the 5-year version with its caveat. A recommendation that silently omits expiry is incomplete: expiry is a decision the merchant is accountable for, not a default to leave unmentioned.

### Step 3e: Name and description

Customer-facing copy — write both in `siteData.language`, not English.

| Field | Rules |
|---|---|
| `name` | **Max 55 chars** (hard API limit). 2–4 words. `"eGift Card"` is the safe default; add one vertical word when the industry is obvious (`"Spa eGift Card"`, `"Bookshop Gift Card"`). No amounts — the variants carry those. No store name unless the merchant gave one. |
| `description` | Max 3000 chars, but write **1–3 sentences (~200–400 chars)**. Cover: any amount works, it's delivered by email, and — only when `expirationMonths` is unset — that it never expires. Never claim a delivery method or expiry the params don't back. |

---

## Step 4: Validate

Run every check before handing the recommendation back to the orchestrator. A failure here is a recommendation that cannot be executed.

| # | Check |
|---|---|
| 1 | No existing gift card product (Step 1 returned empty) |
| 2 | No `PROPOSED` / `DONE` gift-card recommendation, and no permanent rejection, in the orchestrator's history load (its Step 2) |
| 3 | `name` non-empty and ≤ 55 chars |
| 4 | `description` ≤ 3000 chars |
| 5 | At least one preset variant **or** a custom variant — both empty fails with `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITHOUT_VARIANTS`. This goal always emits both. |
| 6 | 3–5 presets, ascending, no duplicates, every value ≥ 10 |
| 7 | `customVariant.minValue < customVariant.maxValue` |
| 8 | Every amount is a decimal string (`"60"`, not `60`), scale ≤ 4, in `siteData.currency`, with no currency symbol baked into the value |
| 9 | `expirationMonths` either unset or ≥ 60, and set only because the merchant asked |
| 10 | `name` / `description` in `siteData.language`; `title` / `reasoning` in English |
| 11 | `reasoning` cites the actual numbers and names the call each came from |
| 12 | The expiry stance is stated in `reasoning`, `successCriteria`, **and** the prose shown to the merchant |
| 13 | `BatchCreate` returned an `id` (or the merchant said `SKIP_TRACKING`, or you are reporting that tracking failed) |
| 14 | **At most one** gift-card recommendation in the orchestrator's set |

---

## Step 5: Persist the recommendation — MANDATORY

⛔ **You have not finished this goal until `BatchCreate` has returned an `id`. Do not present the recommendation to the merchant before that.** Skip only if the merchant said `SKIP_TRACKING` or "don't track". See [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking) for the lifecycle.

**Endpoint:** `POST https://manage.wix.com/_api/agentic-recommendations/v1/agentic-recommendations/batch-create`

```json
{
  "agenticRecommendations": [ <the recommendation object below> ],
  "conversationId": "<conversationId>"
}
```

If the orchestrator activated other domains too, this recommendation goes into **that same batch** — one `BatchCreate` for all domains, not a second call. If gift cards is the only active domain, make the call here yourself.

**Save the returned `id` and `revision`** — they are what the merchant approves against, and Step 6 needs them. If `BatchCreate` fails, present the recommendation anyway, without an `id`, and say that tracking failed.

The recommendation object — `domain: "gift_cards"`, `action: "create_gift_card_product"`:

```json
{
  "title": "Sell gift cards before Mother's Day — 30/60/120/250 plus a custom amount",
  "reasoning": "QueryGiftCardProducts returned 0 products, so this site sells no gift cards. AOV is 62 (metasite online_gpv_last_30_days 12,400 / last_30_days_orders_count 200), currency EUR. GetCatalogAnalytics 'All Products': min price 18, max price 210. Denominations anchor on AOV (0.5x/1x/2x/4x, rounded); the 15-500 custom range covers the cheapest item up to twice the top preset. merchant_business_country is IE and Mother's Day there falls in late March, 38 days out — enough lead time to be live for the gifting window. No expiry: expiry on stored-value cards is regulated and varies by market, and unexpiring cards convert better.",
  "domain": "gift_cards",
  "urgency": "HIGH",
  "expiresAt": "2026-03-15T00:00:00.000Z",
  "advice": {
    "action": "create_gift_card_product",
    "params": {
      "shortTitle": "Start selling gift cards",
      "language": "en-IE",
      "currency": "EUR",
      "giftCardProduct": {
        "name": "eGift Card",
        "description": "Not sure what to pick? An eGift Card lets them choose. Pick an amount, add a personal message, and it arrives by email — and it never expires.",
        "presetVariants": [
          { "value": "30" },
          { "value": "60" },
          { "value": "120" },
          { "value": "250" }
        ],
        "customVariant": { "minValue": "15", "maxValue": "500" }
      }
    },
    "successCriteria": "A gift card product named 'eGift Card' exists with preset amounts 30/60/120/250 EUR, a 15-500 EUR custom range, and no expiration"
  }
}
```

Omit `giftCardProduct.expirationMonths` entirely when there's no expiry. Do not send `null`.

`expiresAt` = the earlier of *(gifting occasion − 7 days)* and *(current_date + 30 days)*; `current_date + 30 days` when there's no occasion in window. Past that the data is stale and the window is gone.

**In the orchestrator's output, echo the `id` and `revision` BatchCreate returned for this recommendation** — they're required for Approve / MarkExecuting / MarkDone. When presenting, format the denominations in the site's currency and include this dashboard link (from [Stores Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/stores-dashboard-navigation)):

`https://manage.wix.com/dashboard/{siteId}/ecom-platform/gift-cards`

### Field rules

| Field | Rule |
|---|---|
| `id` / `revision` | From the BatchCreate result. Omit only if tracking was skipped or failed. |
| `title` | Max 200 chars, English. Lead with the outcome and the denominations. |
| `params.shortTitle` | Max 50 chars, ~5 words — headline for dashboards and notifications. English. |
| `reasoning` | Max 2000 chars, English. Must name the source call for every number (`QueryGiftCardProducts`, metasite profile fields, `GetCatalogAnalytics`). |
| `domain` | Always `"gift_cards"`. |
| `urgency` | `HIGH`, `MEDIUM`, or `LOW` — per Step 2c. Never `CRITICAL`. |
| `name`, `description` | Customer-facing — in `siteData.language`. |
| All amounts | Decimal strings in `siteData.currency`, no symbol in the value. Format with the currency only when displaying to the merchant. |
| `successCriteria` | Concrete and checkable: product name, exact denominations, custom range, expiry. |

---

## Step 6: On approval — create the product

Only after the merchant approves the persisted recommendation, follow the tracking transitions in [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking) — Approve → MarkExecuting → create → MarkDone / MarkFailed — and call [Create Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/create-gift-card-product):

`POST https://www.wixapis.com/gift-cards/v1/gift-card-products`

**`params` do not map 1:1 onto the API. Use this table:**

| `params.giftCardProduct` | Create Gift Card Product field | Notes |
|---|---|---|
| `name` | `giftCardProduct.name` | Required. |
| `description` | `giftCardProduct.description` | Optional. |
| `presetVariants[].value` | `presetVariants[].price.amount` **and** `presetVariants[].value.amount` | **Both required.** Set them to the same amount — `price` is what the buyer pays, `value` is the balance loaded. They differ only for promotional pricing (pay 45, get 50), which this goal never proposes. |
| `customVariant.minValue` / `maxValue` | `customVariant.minValue.amount` / `customVariant.maxValue.amount` | Decimal strings. |
| `expirationMonths` unset | `expirationType: "NONE"` | The default. |
| `expirationMonths: 60` | `expirationType: "RELATIVE"`, `relativeExpirationDate: { "value": 60, "period": "MONTHS" }` | `period` ∈ `DAYS`/`WEEKS`/`MONTHS`/`YEARS`. `FIXED` + `fixedExpirationDate` is the other option — this goal never uses it. |
| — | `image` | Not part of the recommendation. Optional at creation; Wix Media Manager images only (`id`, `width`, `height` required). Upload first if the merchant wants one. |

Currency comes from the site's default — the request carries bare amounts, not a currency field. On success, call MarkDone with the new `giftCardProduct.id` in `executionResult.resultPayload` and hand back the dashboard link.

---

## Error handling

| Error | Cause | Fix |
|---|---|---|
| `GIFT_CARD_PRODUCT_ALREADY_EXISTS` (409) | A product exists — Step 1 was skipped or raced | Drop the domain; route to Update Gift Card Product |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITHOUT_VARIANTS` (428) | No presets and no custom variant | Validation check 5 |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_INVALID_CUSTOM_AMOUNTS_RANGE` (400) | `minValue >= maxValue` | Validation check 7 |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_PAST_EXPIRATION_DATE` (428) | A `FIXED` expiry date in the past | This goal never uses `FIXED` — use `RELATIVE` |
| `403` / app not installed on QueryGiftCardProducts | Wix Gift Cards unavailable on the site | Report the blocker; do not work around it |
| `RECOMMENDATION_SUPPRESSED` (400) | `create_gift_card_product` permanently rejected for this site | Never re-propose; tell the merchant it's suppressed |
| `VERSION_MISMATCH` (400) | Stale `revision` on a state transition | Query for the latest revision, then retry |
| Missing catalog **and** order data | New/empty site | Drop the domain — do not invent denominations |

---

## Constraints

- **At most one** gift-card recommendation per session — one gift card product per site, so Step 1 is not optional.
- Never create, update, or delete anything before the merchant approves the persisted recommendation.
- Denominations derive from this site's AOV and catalog prices. No stock 25/50/100 ladder.
- No expiry unless the merchant asked; then ≥ 60 months, with the compliance caveat stated.
- Amounts are decimal strings in the site's currency. Never assume USD, never hard-code a symbol.
- `presetVariants[].price` and `.value` are always equal — promotional gift-card pricing is out of scope.
- Persist via `BatchCreate` before presenting (Step 5), unless `SKIP_TRACKING`.
- The expiry stance is always stated to the merchant, never left implicit.

## References

- [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) — the orchestrator that loads this file · [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking)
- [Gift Card Products API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products) — [Create](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/create-gift-card-product) · [Query](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/query-gift-card-products) · [Update](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product) · [Delete](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/delete-gift-card-product)
- [Gift Cards API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-cards) — individual issued cards (out of scope here)
