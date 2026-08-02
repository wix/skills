---
name: "Recommend: Gift Cards"
description: Gift-cards recommendation skill — analyzes site data, the catalog price distribution, and whether the site already sells gift cards, then returns ONE recommendation to create a gift card product (name, description, preset denominations, custom amount range, expiration policy). Entry point for "should I sell gift cards", "add a gift card", "gift card ideas", "what amounts should my gift card have", and gifting-holiday prompts. Recommendation-only — it never creates the product; approval hands off to Create Gift Card Product. Tracking is built-in. Out of scope — discounts, coupons, shipping, abandoned checkout (route those to Recommend: eCommerce Strategy) and issuing/redeeming individual gift cards (Gift Cards API).
layer: R
references:
  - name: "API: Recommendation Tracking"
    path: ecommerce/api-recommendation-tracking.md
    load: false
  - name: "eCommerce: Load Context"
    path: ecommerce/ecom-load-context.md
    load: false
---
# Recommend: Gift Cards

Recommends **one** gift-card action: create a gift card product on a site that doesn't sell one yet. The recommendation carries the full product design — name, description, preset denominations, custom amount range, expiration policy — calibrated from the site's own AOV and catalog price distribution.

> 🚫 **Single-domain skill.** This skill only produces `domain: "gift_cards"` recommendations, and only the `create_gift_card_product` action.
>
> | Request | Where it goes |
> |---|---|
> | Discounts, coupons, sales, clearance, AOV, shipping, "boost my sales" | [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) |
> | Issue / redeem / void / email a specific gift card | [Gift Cards API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-cards) — no recommendation needed |
> | Change denominations on an existing gift card product | [Update Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product) — direct edit, not a recommendation |
> | "Grow my traffic", SEO, ads, social | marketing — not this skill |
>
> If the merchant asked a broad "help my business" question, the strategy orchestrator owns the dispatch; this skill is the gift-cards branch it (or the merchant) routes into.

## EXECUTION RULES — READ BEFORE ANYTHING ELSE

**You are an operator, not a consultant.**

1. **Do NOT ask clarifying questions — start executing from Step 1.** The only question you may ask is the expiration question in Step 5d, and only if the merchant already raised expiry.
2. **Do NOT produce a recommendation before calling the mandatory APIs.** Denominations invented without the site's AOV and price distribution are wrong even when they look plausible.
3. **Every number in `reasoning` must come from an API response.** Name the call it came from. Never assume, infer, or fabricate.
4. **Never create the gift card product.** This skill stops at a PROPOSED recommendation. Creation happens only after the merchant approves, via the execution hand-off in Step 8.
5. **A site supports a maximum of ONE gift card product.** If one exists, there is nothing to recommend — Step 3 stops the flow.
6. **Issue every call as an authenticated request in the merchant's site context**, using exactly the endpoints below.

---

## Step 1: Load eCommerce context

**MANDATORY.** Load [eCommerce: Load Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context) unless `siteData.country` is already in conversation context (it runs once per session).

From it you need:

| Value | Used for |
|---|---|
| `siteId` | Every subsequent call + the dashboard link in the output |
| `siteData.currency` | All amounts. **Never assume USD.** |
| `siteData.language` | Language of the customer-facing `name` / `description` |
| `siteData.country` | Gifting-holiday calendar (Step 4b) |
| `siteData.industry` / `subIndustry` | Gifting-affinity signal (Step 4a) |
| `siteData.aov`, `orders30d`, `visitors30d` | Denomination anchor + urgency |
| `siteData.catalogAnalytics` | Price quantiles, min/max price, product count |
| `siteData.hasCatalog` | Eligibility gate |

**Do not re-fetch anything the loader already put in context.**

---

## Step 2: Load gift-card recommendation history (Tracking)

**MANDATORY — skip only if the merchant said `SKIP_TRACKING` or "don't track".**

**Endpoint:** `POST https://manage.wix.com/_api/agentic-recommendations/v1/agentic-recommendations/query`

```json
{ "query": { "filter": { "domain": "gift_cards" }, "cursorPaging": { "limit": 50 } } }
```

| Returned state | What to do |
|---|---|
| `PROPOSED` | **Do not re-propose.** Surface the pending one (id + revision) and ask whether to approve, modify, or reject it. |
| `APPROVED` / `EXECUTING` | Already moving — report status, stop. |
| `DONE` | The product was already created. Stop; point the merchant at the dashboard link in Step 8. |
| `REJECTED` with `rejectionPermanent: true` | **Never propose `create_gift_card_product` for this site again.** Tell the merchant it's permanently suppressed. |
| `REJECTED` with `rejectionPermanent: false` | You may re-propose only with a *materially different* design (different denominations or expiry) and must say what changed and why. |
| `FAILED` | Offer a retry; read `executionResult.error` and fix the cause in the new params. |
| `EXPIRED` | Free to re-propose with fresh data. |

Empty result or a failed query ⇒ fresh session, continue.

---

## Step 3: Check whether the site already sells gift cards

**MANDATORY HARD GATE — a site supports a maximum of 1 gift card product.** Skipping this produces a recommendation that can only fail with `GIFT_CARD_PRODUCT_ALREADY_EXISTS` (409) at execution time.

**Endpoint:** `POST https://www.wixapis.com/gift-cards/v1/gift-card-products/query`

```json
{ "query": { "cursorPaging": { "limit": 10 } } }
```

**Response:**
```json
{
  "giftCardProducts": [
    {
      "id": "9041ce44-2efe-4d07-a3ae-b7084be31339",
      "revision": "1",
      "name": "eGift Card",
      "expirationType": "NONE",
      "presetVariants": [
        { "id": "40ab14eb-...", "price": { "amount": "50", "formattedAmount": "$50.00" }, "value": { "amount": "50" } }
      ],
      "customVariant": { "minValue": { "amount": "10" }, "maxValue": { "amount": "100" } }
    }
  ],
  "pagingMetadata": { "count": 1, "hasNext": false }
}
```

| Outcome | Action |
|---|---|
| `giftCardProducts` is empty | Continue to Step 4. |
| One or more products returned | **Stop.** Report: "This site already sells gift cards ({name}, denominations {amounts} {currency}). A site supports one gift card product, so there's nothing to create. To change the amounts or expiry, edit it directly — [Update Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product)." Do **not** persist a recommendation. |
| Call fails with `403` / app-not-installed | Wix Gift Cards is not available on this site. Report the blocker verbatim; do not recommend around it. |
| Call fails for any other reason | Report the exact error and stop. Do **not** assume "no product exists" — a false negative here produces a guaranteed-to-fail recommendation. |

---

## Step 4: Eligibility and urgency

### Step 4a: Eligibility gates

| Condition | Decision |
|---|---|
| `siteData.hasCatalog === false` (0 products) | **Stop.** "Gift cards need something to spend them on. Add products to your catalog first." |
| No price data at all — `catalogAnalytics` missing **and** `aov` unavailable | **Stop.** "Cannot size gift card denominations — no order or catalog price data for this site." Do not fall back to generic $25/$50/$100. |
| `orders30d === 0` **and** `visitors30d < 100` | Continue, but urgency is `LOW` and `reasoning` must say the store has little traffic to convert yet. |
| Everything else | Continue. |

### Step 4b: Gifting-holiday window

Using `current_date` and `siteData.country`, find the nearest gifting occasion within **75 days**. Gift cards are the classic last-minute gift, so the product must be live **≥ 21 days before** the date to catch the buying window — that lead time is the whole reason urgency matters here.

| Occasion | Typical date | Regions |
|---|---|---|
| Christmas / holiday gifting | Dec 25 (peak buying Dec 10–24) | Global |
| Boxing Day | Dec 26 | UK, CA, AU, NZ |
| New Year gifting | Dec 31 – Jan 7 | Global |
| Lunar New Year | Late Jan – mid Feb | CN, SG, HK, TW, VN, KR, MY |
| Valentine's Day | Feb 14 | Global |
| Mother's Day | 2nd Sun of May (US, CA, AU); late Mar (UK, IE) | Varies |
| Father's Day | 3rd Sun of Jun (US, UK, CA); 1st Sun of Sep (AU, NZ) | Varies |
| Graduation season | May – Jun | US, CA |
| Back to school | Aug – Sep | US, EU |
| Diwali | Oct – Nov | IN, SG, MY |
| Black Friday / Cyber Monday | 4th Fri of Nov + following Mon | US, spreading globally |
| Birthdays / "any occasion" | Year-round | Global — the fallback when nothing else lands |

If nothing falls inside 75 days, do **not** stop — recommend the evergreen case (birthdays, last-minute gifts, indecisive buyers) at lower urgency.

### Step 4c: Urgency

| Condition | `urgency` |
|---|---|
| Gifting occasion 21–75 days out | `HIGH` |
| Gifting occasion under 21 days out | `MEDIUM` — the product can still go live, but say the buying window is already open and part of it is lost |
| No occasion in window, but a gifting-heavy industry (fashion, beauty, jewelry, food & drink, wellness/spa, art, home decor, toys, books) **or** `orders30d >= 10` | `MEDIUM` |
| Anything else | `LOW` |

**Never use `CRITICAL`.** Gift cards are a revenue opportunity, never a blocker — reserve `CRITICAL` for broken configuration (no shipping coverage, no payment method).

---

## Step 5: Design the gift card product

All amounts are **decimal strings** in `siteData.currency`.

### Step 5a: Pick the anchor

| Available data | `anchor` |
|---|---|
| `orders30d >= 1` and `aov > 0` | `aov` (= `gpv30d / orders30d`) — what customers actually spend |
| Otherwise | `p50` — the median price from the "All Products" group of `catalogAnalytics` |

Also read from the "All Products" group: `priceMin` (`min(price)`), `priceMax` (`max(price)`), `p90`. Ignore every other `categoryName` — category-level stats do not size a store-wide gift card.

### Step 5b: Preset denominations

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

**Worked example** — `aov = 62`, `priceMin = 18`, `priceMax = 210`, currency `USD`:
`31 → 30`, `62 → 60`, `124 → 120`, `248 → 250`; cap check `210 × 2 = 420` → no change ⇒ `["30", "60", "120", "250"]`.

### Step 5c: Custom variant

Always include one — it captures buyers whose budget sits between presets.

- `minValue` = `min(lowest preset ÷ 2, priceMin)`, rounded with the table, floored at `10`.
- `maxValue` = `highest preset × 2`, rounded with the table.
- **`minValue` must be strictly less than `maxValue`** — otherwise execution fails with `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_INVALID_CUSTOM_AMOUNTS_RANGE`.

Continuing the example: `minValue = "15"`, `maxValue = "500"`.

### Step 5d: Expiration policy

**Default: no expiration. Leave `expirationMonths` unset.** Two reasons, both worth stating in `reasoning`:

- Expiry on stored-value cards is regulated — the US CARD Act sets a 5-year floor for gift certificates, several US states and a number of other jurisdictions ban expiry outright, and EU consumer rules impose their own minimums. A default expiry is a compliance risk you cannot assess from API data.
- Unexpiring cards convert better and generate fewer support tickets.

Only if the merchant explicitly asked for an expiry: propose `expirationMonths: 60` (5 years), and add to `reasoning`: "Expiry set at the merchant's request. Gift card expiry is regulated in many jurisdictions — confirm 5 years is permitted where you sell." Never propose fewer than 60 months. Never volunteer an expiry the merchant didn't ask for.

### Step 5e: Name and description

Customer-facing copy — write both in `siteData.language`, not English.

| Field | Rules |
|---|---|
| `name` | **Max 55 chars** (hard API limit). 2–4 words. `"eGift Card"` is the safe default; add one vertical word when the industry is obvious (`"Spa eGift Card"`, `"Bookshop Gift Card"`). No amounts — the variants carry those. No store name unless the merchant gave one. |
| `description` | Max 3000 chars, but write **1–3 sentences (~200–400 chars)**. Cover: any amount works, it's delivered by email, and — only when `expirationMonths` is unset — that it never expires. Never claim a delivery method or expiry the params don't back. |

---

## Step 6: Validate before persisting

Run every check. A failure here is a recommendation that cannot execute.

| # | Check |
|---|---|
| 1 | No existing gift card product (Step 3 returned empty) |
| 2 | No `PROPOSED` / `APPROVED` / `DONE` gift-cards recommendation, and no permanent rejection (Step 2) |
| 3 | `name` non-empty and ≤ 55 chars |
| 4 | `description` ≤ 3000 chars |
| 5 | At least one preset variant **or** a custom variant — both empty fails with `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITHOUT_VARIANTS`. This skill always emits both. |
| 6 | 3–5 presets, ascending, no duplicates, every value ≥ 10 |
| 7 | `customVariant.minValue < customVariant.maxValue` |
| 8 | Every amount is a decimal string (`"60"`, not `60`), scale ≤ 4, in `siteData.currency` |
| 9 | `expirationMonths` either unset or ≥ 60, and set only because the merchant asked |
| 10 | `name` / `description` in `siteData.language`; `title` / `reasoning` in English |
| 11 | `reasoning` cites the actual numbers and names the call each came from |
| 12 | Exactly **one** recommendation, `domain: "gift_cards"`, `action: "create_gift_card_product"` |

---

## Step 7: Persist the recommendation (Tracking)

**MANDATORY — skip only on `SKIP_TRACKING`.** Read [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking) for the full lifecycle before calling.

**Endpoint:** `POST https://manage.wix.com/_api/agentic-recommendations/v1/agentic-recommendations/batch-create`

```json
{
  "agenticRecommendations": [
    {
      "title": "Sell gift cards before Mother's Day — $30/$60/$120/$250 plus a custom amount",
      "reasoning": "QueryGiftCardProducts returned 0 products, so this site sells no gift cards. AOV is $62 (metasite online_gpv_last_30_days 12,400 / last_30_days_orders_count 200). GetCatalogAnalytics 'All Products': min price $18, max price $210. Denominations anchor on AOV (0.5x/1x/2x/4x, rounded); the $15-$500 custom range covers the cheapest item up to twice the top preset. merchant_business_country is US and Mother's Day is 38 days out — enough lead time to be live for the gifting window. No expiry: gift card expiry is regulated in several US states, and unexpiring cards convert better.",
      "domain": "gift_cards",
      "urgency": "HIGH",
      "expiresAt": "2026-04-26T00:00:00.000Z",
      "advice": {
        "action": "create_gift_card_product",
        "params": {
          "shortTitle": "Start selling gift cards",
          "language": "en-US",
          "currency": "USD",
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
        "successCriteria": "A gift card product named 'eGift Card' exists with preset amounts 30/60/120/250 USD, a 15-500 USD custom range, and no expiration"
      }
    }
  ],
  "conversationId": "<conversationId>"
}
```

`expiresAt` = the earlier of *(gifting occasion − 7 days)* and *(current_date + 30 days)*; `current_date + 30 days` when there's no occasion in window. Past that point the data is stale and the window is gone.

**Save `id` and `revision` from the result** — the merchant needs them to approve, and Step 8 needs them for the state transitions. If BatchCreate fails, present the recommendation anyway, without a tracking id, and say tracking failed.

Omit `giftCardProduct.expirationMonths` entirely when there's no expiry. Do not send `null`.

---

## Step 8: Present, and hand off on approval

Present the recommendation with its `id`, `revision`, the denominations, and this dashboard link (from [Stores Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/stores-dashboard-navigation)):

`https://manage.wix.com/dashboard/{siteId}/ecom-platform/gift-cards`

**On approval, follow the tracking lifecycle — Approve → MarkExecuting → create → MarkDone/MarkFailed** (see [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking)). The creation call is [Create Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/create-gift-card-product) — `POST https://www.wixapis.com/gift-cards/v1/gift-card-products`.

**`params` do not map 1:1 onto the API. Use this table:**

| `advice.params.giftCardProduct` | Create Gift Card Product field | Notes |
|---|---|---|
| `name` | `giftCardProduct.name` | Required. |
| `description` | `giftCardProduct.description` | Optional. |
| `presetVariants[].value` | `presetVariants[].price.amount` **and** `presetVariants[].value.amount` | **Both required.** Set them to the same amount — `price` is what the buyer pays, `value` is the balance loaded. They differ only for promotional pricing (pay $45, get $50), which this skill never proposes. |
| `customVariant.minValue` / `maxValue` | `customVariant.minValue.amount` / `customVariant.maxValue.amount` | Decimal strings. |
| `expirationMonths` unset | `expirationType: "NONE"` | The default. |
| `expirationMonths: 60` | `expirationType: "RELATIVE"`, `relativeExpirationDate: { "value": 60, "period": "MONTHS" }` | `period` ∈ `DAYS`/`WEEKS`/`MONTHS`/`YEARS`. `FIXED` + `fixedExpirationDate` is the other option — this skill never uses it. |
| — | `image` | Not part of the recommendation. Optional at creation; Wix Media Manager images only (`id`, `width`, `height` required). Upload first if the merchant wants one. |

After a successful create, call MarkDone with the new `giftCardProduct.id` in `executionResult.resultPayload`, and give the merchant the dashboard link.

---

## Output format

```json
{
  "recommendations": [
    {
      "id": "<tracking id from BatchCreate; omit if tracking failed>",
      "revision": "1",
      "title": "Sell gift cards before Mother's Day — $30/$60/$120/$250 plus a custom amount",
      "reasoning": "<English, cites the numbers and the calls they came from>",
      "domain": "gift_cards",
      "urgency": "HIGH",
      "advice": {
        "action": "create_gift_card_product",
        "params": { "...": "as persisted in Step 7" },
        "successCriteria": "..."
      }
    }
  ]
}
```

### Field rules

| Field | Rule |
|---|---|
| `title` | Max 200 chars, English. Lead with the outcome and the denominations. |
| `params.shortTitle` | Max 50 chars, ~5 words — the dashboard/notification headline. English. |
| `reasoning` | Max 2000 chars, English. Must name the source call for every number (`QueryGiftCardProducts`, metasite profile fields, `GetCatalogAnalytics`). |
| `domain` | Always `"gift_cards"`. |
| `urgency` | `HIGH`, `MEDIUM`, or `LOW` — per Step 4c. Never `CRITICAL`. |
| `name`, `description` | Customer-facing — in `siteData.language`. |
| All amounts | Decimal strings in `siteData.currency`. |
| `successCriteria` | Concrete and checkable: product name, exact denominations, custom range, expiry. |

---

## Error handling

| Error | Cause | Fix |
|---|---|---|
| `GIFT_CARD_PRODUCT_ALREADY_EXISTS` (409) | A product exists — Step 3 was skipped or raced | Stop recommending; route to Update Gift Card Product |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITHOUT_VARIANTS` (428) | No presets and no custom variant | Validation check 5 |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_INVALID_CUSTOM_AMOUNTS_RANGE` (400) | `minValue >= maxValue` | Validation check 7 |
| `CANNOT_CREATE_GIFT_CARD_PRODUCT_WITH_PAST_EXPIRATION_DATE` (428) | A `FIXED` expiry date in the past | This skill never uses `FIXED` — use `RELATIVE` |
| `403` / app not installed on QueryGiftCardProducts | Wix Gift Cards unavailable on the site | Report the blocker; do not work around it |
| `RECOMMENDATION_SUPPRESSED` (400) | `create_gift_card_product` permanently rejected for this site | Never re-propose; tell the merchant it's suppressed |
| `VERSION_MISMATCH` (400) | Stale `revision` on a state transition | Query for the latest revision, retry |
| Missing catalog **and** order data | New/empty site | Stop — do not invent denominations |

---

## Constraints

- Exactly **one** recommendation, always `domain: "gift_cards"` / `action: "create_gift_card_product"`.
- One gift card product per site — Step 3 is not optional.
- Never create, update, or delete anything in this skill. Recommendation only.
- Denominations derive from this site's AOV and catalog prices. No stock $25/$50/$100 ladder.
- No expiry unless the merchant asked; then ≥ 60 months, with the compliance caveat stated.
- Amounts are decimal strings in the site's currency. Never assume USD.
- `presetVariants[].price` and `.value` are always equal — promotional gift-card pricing is out of scope.
- Persist via BatchCreate before presenting, unless `SKIP_TRACKING`.

## References

- [Gift Card Products API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products) — [Create](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/create-gift-card-product) · [Query](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/query-gift-card-products) · [Update](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product) · [Delete](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/delete-gift-card-product)
- [Gift Cards API](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-cards) — individual issued cards (out of scope here)
- [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking)
- [eCommerce: Load Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context)
