---
name: "Recommend: Gift Cards"
description: Recommends whether a site should sell gift cards and returns the product design — preset denominations and a custom amount range sized from the site's own AOV and catalog prices, plus an expiration policy. Use for "should I sell gift cards", "add a gift card", "which amounts should I offer", and gifting-season prompts. Recommendation only — creation happens on approval. Discounts, coupons, and shipping are out of scope.
references:
  - name: "eCommerce: Load Context"
    path: ecommerce/ecom-load-context.md
    load: false
---
# Recommend: Gift Cards

Recommends **one** gift-card action: create a gift card product on a site that doesn't sell one yet. The recommendation carries the full product design — name, description, preset denominations, custom amount range, expiration policy — calibrated from the site's own AOV and catalog price distribution.

> 🚫 **Single-domain skill.** This skill produces one recommendation type: create a gift card product.
>
> | Request | Where it goes |
> |---|---|
> | Discounts, coupons, sales, clearance, AOV, shipping, "boost my sales" | [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) |
> | Issue / redeem / void / email a specific gift card | [Gift Cards API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-cards) — no recommendation needed |
> | Change denominations on an existing gift card product | [Update Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product) — direct edit, not a recommendation |
> | "Grow my traffic", SEO, ads, social | marketing — not this skill |

## EXECUTION RULES — READ BEFORE ANYTHING ELSE

**You are an operator, not a consultant.**

1. **Do NOT ask clarifying questions — start executing from Step 1.** The only question you may ask is the expiration question in Step 4d, and only if the merchant already raised expiry.
2. **Do NOT produce a recommendation before calling the mandatory APIs.** Denominations invented without the site's AOV and price distribution are wrong even when they look plausible.
3. **Every number in `reasoning` must come from an API response.** Name the call it came from. Never assume, infer, or fabricate.
4. **Never create the gift card product.** This skill stops at a recommendation the merchant can approve. Creation happens only after approval, via Step 7.
5. **A site supports a maximum of ONE gift card product.** If one exists, there is nothing to recommend — Step 2 stops the flow.
6. **All amounts are in the site's currency.** Never hard-code a currency symbol, and never assume USD.
7. **Issue every call as an authenticated request in the merchant's site context**, using exactly the endpoints below.

---

## Step 1: Load eCommerce context

**MANDATORY.** Load [eCommerce: Load Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context) unless `siteData.country` is already in conversation context (it runs once per session).

From it you need:

| Value | Used for |
|---|---|
| `siteId` | Every subsequent call + the dashboard link in Step 6 |
| `siteData.currency` | All amounts. **Never assume USD.** |
| `siteData.language` | Language of the customer-facing `name` / `description` |
| `siteData.country` | Gifting-occasion window (Step 3b) |
| `siteData.industry` / `subIndustry` | Gifting-affinity signal (Step 3c) |
| `siteData.aov`, `orders30d`, `visitors30d` | Denomination anchor + urgency |
| `siteData.catalogAnalytics` | Price quantiles, min/max price, product count |
| `siteData.hasCatalog` | Eligibility gate |

**Do not re-fetch anything the loader already put in context.**

---

## Step 2: Check whether the site already sells gift cards

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
| `giftCardProducts` is empty | Continue to Step 3. |
| One or more products returned | **Stop.** Report: "This site already sells gift cards ({name}, denominations {formattedAmounts}). A site supports one gift card product, so there's nothing to create. To change the amounts or expiry, edit it directly — [Update Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product)." |
| Call fails with `403` / app-not-installed | Wix Gift Cards is not available on this site. Report the blocker verbatim; do not recommend around it. |
| Call fails for any other reason | Report the exact error and stop. Do **not** assume "no product exists" — a false negative here produces a guaranteed-to-fail recommendation. |

---

## Step 3: Eligibility and urgency

### Step 3a: Eligibility gates

| Condition | Decision |
|---|---|
| `siteData.hasCatalog === false` (0 products) | **Stop.** "Gift cards need something to spend them on. Add products to your catalog first." |
| No price data at all — `catalogAnalytics` missing **and** `aov` unavailable | **Stop.** "Cannot size gift card denominations — no order or catalog price data for this site." Do not fall back to a stock 25/50/100 ladder. |
| `orders30d === 0` **and** `visitors30d < 100` | Continue, but urgency is `LOW` and `reasoning` must say the store has little traffic to convert yet. |
| Everything else | Continue. |

### Step 3b: Gifting-occasion window

Gift cards are the classic last-minute gift, so the product must be live **≥ 21 days before** the occasion to catch the buying window — that lead time is the whole reason urgency matters here.

Using `current_date` and `siteData.country`, resolve the nearest gifting occasion within **75 days** **for that country**. Do not assume a US calendar — the same occasion moves, and some don't exist locally:

- **Mother's Day** — 2nd Sunday of May in the US, CA, AU; late March (Mothering Sunday) in the UK and IE; other dates elsewhere.
- **Year-end gifting** — peaks in the days before Dec 25 across most of Europe, but in Spain and much of Latin America the gift-giving peak shifts to Reyes on Jan 6.

Other occasions worth resolving per country rather than assuming: Valentine's Day, Father's Day, graduation season, Black Friday, Boxing Day, Lunar New Year, Diwali, Eid al-Fitr, Hanukkah.

If nothing lands within 75 days, do **not** stop — recommend the evergreen case (birthdays, last-minute gifts, indecisive buyers) at lower urgency.

### Step 3c: Urgency

| Condition | `urgency` |
|---|---|
| Gifting occasion 21–75 days out | `HIGH` |
| Gifting occasion under 21 days out | `MEDIUM` — the product can still go live, but say the buying window is already open and part of it is lost |
| No occasion in window, but a gifting-heavy industry (fashion, beauty, jewelry, food & drink, wellness/spa, art, home decor, toys, books) **or** `orders30d >= 10` | `MEDIUM` |
| Anything else | `LOW` |

**Never use `CRITICAL`.** Gift cards are a revenue opportunity, never a blocker — reserve `CRITICAL` for broken configuration (no shipping coverage, no payment method).

---

## Step 4: Design the gift card product

All amounts are **decimal strings** in `siteData.currency`. The numbers in the examples below are bare on purpose — no currency symbol belongs in the params.

### Step 4a: Pick the anchor

| Available data | `anchor` |
|---|---|
| `orders30d >= 1` and `aov > 0` | `aov` (= `gpv30d / orders30d`) — what customers actually spend |
| Otherwise | `p50` — the median price from the "All Products" group of `catalogAnalytics` |

Also read from the "All Products" group: `priceMin` (`min(price)`), `priceMax` (`max(price)`), `p90`. Ignore every other `categoryName` — category-level stats do not size a store-wide gift card.

### Step 4b: Preset denominations

1. Candidates: `anchor × 0.5`, `anchor × 1`, `anchor × 2`, `anchor × 4`.
2. Round each to a "nice" number:

   | Raw amount | Round to nearest multiple of |
   |---|---|
   | < 50 | 5 |
   | 50 – 199 | 10 |
   | 200 – 499 | 25 |
   | ≥ 500 | 50 |

3. Floor every value at `10`. Drop duplicates. Sort ascending.
4. If the lowest preset is below `priceMin`, raise it to `priceMin` rounded **up** with the table — a card that can't buy the cheapest item is dead weight.
5. If `priceMax` is known, cap the highest preset at `priceMax × 2` rounded with the table.
6. Keep **3–5 presets**. Fewer than 3 after dedupe ⇒ add `anchor × 3` (rounded) until you have 3.

**Worked example** — `aov = 62`, `priceMin = 18`, `priceMax = 210`, all in the site's currency:
`31 → 30`, `62 → 60`, `124 → 120`, `248 → 250`; cap check `210 × 2 = 420` → no change ⇒ `["30", "60", "120", "250"]`.

The rounding table is currency-agnostic: it operates on the site's own currency units, whatever they are. Do not convert to another currency first, and do not re-tune the thresholds per currency.

### Step 4c: Custom variant

Always include one — it captures buyers whose budget sits between presets.

- `minValue` = `min(lowest preset ÷ 2, priceMin)`, rounded with the table, floored at `10`.
- `maxValue` = `highest preset × 2`, rounded with the table.
- **`minValue` must be strictly less than `maxValue`** — otherwise creation fails with `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_INVALID_CUSTOM_AMOUNTS_RANGE`.

Continuing the example: `minValue = "15"`, `maxValue = "500"`.

### Step 4d: Expiration policy

**Default: no expiration. Leave `expirationMonths` unset.** Two reasons, both worth stating in `reasoning`:

- Expiry on stored-value cards is regulated, and the rules differ by market — some jurisdictions impose a multi-year minimum, others ban expiry outright. You cannot assess which applies from API data.
- Unexpiring cards convert better and generate fewer support tickets.

Only if the merchant explicitly asked for an expiry: propose `expirationMonths: 60` (5 years), and add to `reasoning`: "Expiry set at the merchant's request. Gift card expiry is regulated in many jurisdictions — confirm 5 years is permitted where you sell." Never propose fewer than 60 months. Never volunteer an expiry the merchant didn't ask for.

### Step 4e: Name and description

Customer-facing copy — write both in `siteData.language`, not English.

| Field | Rules |
|---|---|
| `name` | **Max 55 chars** (hard API limit). 2–4 words. `"eGift Card"` is the safe default; add one vertical word when the industry is obvious (`"Spa eGift Card"`, `"Bookshop Gift Card"`). No amounts — the variants carry those. No store name unless the merchant gave one. |
| `description` | Max 3000 chars, but write **1–3 sentences (~200–400 chars)**. Cover: any amount works, it's delivered by email, and — only when `expirationMonths` is unset — that it never expires. Never claim a delivery method or expiry the params don't back. |

---

## Step 5: Validate before returning

Run every check. A failure here is a recommendation that cannot be executed.

| # | Check |
|---|---|
| 1 | No existing gift card product (Step 2 returned empty) |
| 2 | `name` non-empty and ≤ 55 chars |
| 3 | `description` ≤ 3000 chars |
| 4 | At least one preset variant **or** a custom variant — both empty fails with `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITHOUT_VARIANTS`. This skill always emits both. |
| 5 | 3–5 presets, ascending, no duplicates, every value ≥ 10 |
| 6 | `customVariant.minValue < customVariant.maxValue` |
| 7 | Every amount is a decimal string (`"60"`, not `60`), scale ≤ 4, in `siteData.currency`, with no currency symbol baked into the value |
| 8 | `expirationMonths` either unset or ≥ 60, and set only because the merchant asked |
| 9 | `name` / `description` in `siteData.language`; `title` / `reasoning` in English |
| 10 | `reasoning` cites the actual numbers and names the call each came from |
| 11 | Exactly **one** recommendation |

---

## Step 6: Return the recommendation

Return the recommendation inline for the merchant to approve or reject. **There is no persistence step** — do not write the recommendation to any tracking service.

```json
{
  "recommendations": [
    {
      "title": "Sell gift cards before Mother's Day — 30/60/120/250 plus a custom amount",
      "shortTitle": "Start selling gift cards",
      "reasoning": "QueryGiftCardProducts returned 0 products, so this site sells no gift cards. AOV is 62 (metasite online_gpv_last_30_days 12,400 / last_30_days_orders_count 200), currency EUR. GetCatalogAnalytics 'All Products': min price 18, max price 210. Denominations anchor on AOV (0.5x/1x/2x/4x, rounded); the 15-500 custom range covers the cheapest item up to twice the top preset. merchant_business_country is IE and Mother's Day there falls in late March, 38 days out — enough lead time to be live for the gifting window. No expiry: expiry on stored-value cards is regulated and varies by market, and unexpiring cards convert better.",
      "domain": "gift_cards",
      "urgency": "HIGH",
      "action": "create_gift_card_product",
      "params": {
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
  ]
}
```

Omit `giftCardProduct.expirationMonths` entirely when there's no expiry. Do not send `null`.

Alongside the JSON, present the recommendation in prose — the denominations formatted in the site's currency, the reason, and this dashboard link (from [Stores Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/stores-dashboard-navigation)):

`https://manage.wix.com/dashboard/{siteId}/ecom-platform/gift-cards`

### Field rules

| Field | Rule |
|---|---|
| `title` | Max 200 chars, English. Lead with the outcome and the denominations. |
| `shortTitle` | Max 50 chars, ~5 words — headline for dashboards and notifications. English. |
| `reasoning` | Max 2000 chars, English. Must name the source call for every number (`QueryGiftCardProducts`, metasite profile fields, `GetCatalogAnalytics`). |
| `domain` | Always `"gift_cards"`. |
| `urgency` | `HIGH`, `MEDIUM`, or `LOW` — per Step 3c. Never `CRITICAL`. |
| `action` | Always `"create_gift_card_product"`. |
| `name`, `description` | Customer-facing — in `siteData.language`. |
| All amounts | Decimal strings in `siteData.currency`, no symbol in the value. Format with the currency only when displaying to the merchant. |
| `successCriteria` | Concrete and checkable: product name, exact denominations, custom range, expiry. |

---

## Step 7: On approval — create the product

Only after the merchant approves, call [Create Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/create-gift-card-product):

`POST https://www.wixapis.com/gift-cards/v1/gift-card-products`

**`params` do not map 1:1 onto the API. Use this table:**

| `params.giftCardProduct` | Create Gift Card Product field | Notes |
|---|---|---|
| `name` | `giftCardProduct.name` | Required. |
| `description` | `giftCardProduct.description` | Optional. |
| `presetVariants[].value` | `presetVariants[].price.amount` **and** `presetVariants[].value.amount` | **Both required.** Set them to the same amount — `price` is what the buyer pays, `value` is the balance loaded. They differ only for promotional pricing (pay 45, get 50), which this skill never proposes. |
| `customVariant.minValue` / `maxValue` | `customVariant.minValue.amount` / `customVariant.maxValue.amount` | Decimal strings. |
| `expirationMonths` unset | `expirationType: "NONE"` | The default. |
| `expirationMonths: 60` | `expirationType: "RELATIVE"`, `relativeExpirationDate: { "value": 60, "period": "MONTHS" }` | `period` ∈ `DAYS`/`WEEKS`/`MONTHS`/`YEARS`. `FIXED` + `fixedExpirationDate` is the other option — this skill never uses it. |
| — | `image` | Not part of the recommendation. Optional at creation; Wix Media Manager images only (`id`, `width`, `height` required). Upload first if the merchant wants one. |

Currency comes from the site's default — the request carries bare amounts, not a currency field. After a successful create, report the new `giftCardProduct.id` and hand back the dashboard link.

---

## Error handling

| Error | Cause | Fix |
|---|---|---|
| `GIFT_CARD_PRODUCT_ALREADY_EXISTS` (409) | A product exists — Step 2 was skipped or raced | Stop recommending; route to Update Gift Card Product |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITHOUT_VARIANTS` (428) | No presets and no custom variant | Validation check 4 |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_INVALID_CUSTOM_AMOUNTS_RANGE` (400) | `minValue >= maxValue` | Validation check 6 |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_PAST_EXPIRATION_DATE` (428) | A `FIXED` expiry date in the past | This skill never uses `FIXED` — use `RELATIVE` |
| `403` / app not installed on QueryGiftCardProducts | Wix Gift Cards unavailable on the site | Report the blocker; do not work around it |
| Missing catalog **and** order data | New/empty site | Stop — do not invent denominations |

---

## Constraints

- Exactly **one** recommendation, always the create-gift-card-product action.
- One gift card product per site — Step 2 is not optional.
- Never create, update, or delete anything before the merchant approves. Steps 1–6 are read-only.
- No persistence: the recommendation is returned inline, not written to a tracking service.
- Denominations derive from this site's AOV and catalog prices. No stock 25/50/100 ladder.
- No expiry unless the merchant asked; then ≥ 60 months, with the compliance caveat stated.
- Amounts are decimal strings in the site's currency. Never assume USD, never hard-code a symbol.
- `presetVariants[].price` and `.value` are always equal — promotional gift-card pricing is out of scope.

## References

- [Gift Card Products API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products) — [Create](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/create-gift-card-product) · [Query](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/query-gift-card-products) · [Update](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product) · [Delete](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/delete-gift-card-product)
- [Gift Cards API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-cards) — individual issued cards (out of scope here)
- [eCommerce: Load Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context)
