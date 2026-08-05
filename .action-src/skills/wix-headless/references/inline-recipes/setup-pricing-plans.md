---
name: "Setup Pricing Plans"
description: Initializes a Wix Pricing Plans backend with Plans V3 — creates recurring / one-time / free membership plans (billing cycle + flat-rate price), then (only when bookings is also in the run) attaches bookings services to a plan through the Benefit Programs API so a member's plan covers those services. Specifies the *how* (calls + format); counts and the specific plans/prices/cycles come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Pricing Plans (Plans V3) + Bookings membership integration

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for turning a freshly provisioned Wix site with the **Wix Pricing Plans** app installed into a set of purchasable membership plans — and, when the site also has **Wix Bookings**, for wiring those plans to cover bookable services so members can book with their membership.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial Pricing Plans backend setup. (The frontend read/subscribe/book-with-plan contract is the sibling recipe `how-to-code-pricing-plans.md`.)

> **This recipe is the *how*, not the *what*.** What to seed — how many plans, their names, prices, and billing cycles, and which bookings services a plan covers — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities, prices, or which plans to create.

> **API surfaces:** plans use **Plans V3** on the **public** host `https://www.wixapis.com/pricing-plans/v3/...`. The bookings integration uses the **Benefit Programs V1** API (`https://www.wixapis.com/benefit-programs/v1/...`) — a *separate* API from Pricing Plans. Both APIs' method-article headers may show an internal `…/_api/…` form — **do not use that**; call the public non-`/_api/` form shown below. Relevant **app def ids** (constants the integration needs): Wix **Bookings** = `13d21c63-b5ec-5912-8397-c3a5ddb27a97`, Wix **Pricing Plans** = `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3`.

---

## Article: Steps for Setting Up Wix Pricing Plans
**YOU MUST** complete the following steps **in order** without skipping any and **without requiring additional user input**.

There is **no clean-up step** — a fresh Wix Pricing Plans install ships **no sample plans**, so there is nothing to delete first.

**⚠️ CRITICAL ORDER REQUIREMENT (integration only):** STEP 2 attaches **bookings service ids** to a plan. Those service ids come from the **Bookings seed** (`setup-bookings.md` → `seeded.bookings.serviceIds[]`). So when a run has **both** pricing-plans and bookings, **seed the bookings services first**, then create the plans (STEP 1), then attach (STEP 2). STEP 2 is **skipped entirely** when bookings is not in the run — a plans-only site stops after STEP 1.

### STEP 1: Create the plan(s)

Create **one plan per create call** (Plans V3 has **no bulk-create** for plans) against `POST https://www.wixapis.com/pricing-plans/v3/plans`. **How many plans, their names, prices, and billing cycles come from the request you're fulfilling** — this step only gives the call and the required format.

**⚠️ The create body MUST include `plan.status: "ACTIVE"` and a valid, unique GUID `id` on every `pricingVariants[]` and every `perks[]` entry** — omitting any of them returns `400` (`status value is required` / `id is not a valid GUID` / `id must not be empty`). These `id`s are **client-supplied** (a confirmed won't-fix server-side gap: the Pricing-Plans team will not auto-generate them; only the plan's *own* top-level `id` comes back server-generated).

**⚠️ Generate every GUID in the SHELL — never let the model type one.** A model emitting a UUID token-by-token isn't reliably valid or unique (→ `400`, or a duplicate-id collision across plans). Generate each in the shell and inject it via command substitution, so the value is always a real, fresh GUID regardless of which coding agent or OS runs this. This portable helper tries `uuidgen` → `python3` → `node`; **at least one is present in virtually every shell (a scaffolded Wix project always has `node`), so it effectively always succeeds — the fallback below covers the rare shell with none:**

```bash
gen_uuid() { uuidgen 2>/dev/null | tr 'A-Z' 'a-z' \
  || python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null \
  || node -e 'console.log(require("crypto").randomUUID())'; }
```

Then create each plan with **fresh** ids (one `gen_uuid` call per field — never reuse a value across plans or perks). Body shown is a **recurring monthly** plan at a flat $20/month (the common membership case):

```bash
VID=$(gen_uuid); PERK1=$(gen_uuid); PERK2=$(gen_uuid)
curl -sS -w "\nHTTP:%{http_code}" -X POST 'https://www.wixapis.com/pricing-plans/v3/plans' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d "{
    \"plan\": {
      \"name\": \"Studio Membership\",
      \"description\": \"Unlimited access to group classes.\",
      \"status\": \"ACTIVE\",
      \"visibility\": \"PUBLIC\",
      \"buyable\": true,
      \"buyerCanCancel\": true,
      \"pricingVariants\": [
        { \"id\": \"$VID\", \"name\": \"Monthly\",
          \"billingTerms\": { \"billingCycle\": { \"period\": \"MONTH\", \"count\": 1 }, \"startType\": \"ON_PURCHASE\", \"endType\": \"UNTIL_CANCELLED\" },
          \"pricingStrategies\": [ { \"flatRate\": { \"amount\": \"20.00\" } } ] }
      ],
      \"perks\": [ { \"id\": \"$PERK1\", \"description\": \"Unlimited group classes\" }, { \"id\": \"$PERK2\", \"description\": \"10% off workshops\" } ]
    }
  }"
```

> **Fallback — only if the shell has NO generator** (`uuidgen`, `python3`, **and** `node` all absent — effectively never in a Wix project): do **not** guess UUIDs. **Skip plan creation** and record a clear note for the user listing the plans to create by hand in the Wix dashboard (name, price, billing cycle). Failing loud beats seeding malformed plans.

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **Pricing lives under `pricingVariants[]`, NOT a top-level `price`.** Each variant carries `billingTerms` (the cycle) + `pricingStrategies` (the amount). Send **one** `pricingVariant` with **one** `pricingStrategy` — the schema nominally allows up to 20 variants but documents "currently limited to 1", so one is the norm.
- **All amounts and money-ish values are decimal STRINGS**, not numbers: `flatRate.amount` = `"20.00"` (≥ `"0"`, ≤ 4 decimals). A number is rejected.
- **`billingTerms` selects the plan type** (the request decides which):
  - **Recurring** (subscription): `billingCycle: { "period": "DAY|WEEK|MONTH|YEAR", "count": 1 }`, `startType: "ON_PURCHASE"`, `endType: "UNTIL_CANCELLED"`. **Default to `MONTH`/`1`** unless the request names another cycle.
  - **One-time** (bill once, then ends): `endType: "CYCLES_COMPLETED"` + `cyclesCompletedDetails: { "billingCycleCount": 1 }`. A one-time plan with *no* end date instead sets `"billingCycle": null` + `endType: "UNTIL_CANCELLED"`.
  - **Free**: `pricingStrategies: [ { "flatRate": { "amount": "0" } } ]`; cap reuse with `"purchaseLimits": { "type": "PER_MEMBER_LIFETIME", "count": 1 }` (the older `maxPurchasesPerBuyer: 1` is deprecated — removal targeted 2026-11-30 — prefer `purchaseLimits`).
- **Currency is NOT set in the request** — it's read-only in the response and derived from the site's business currency (like Bookings prices). Don't send a `currency`; don't fight the one that comes back.
- **`visibility: "PUBLIC"` + `buyable: true`** make the plan appear on the public grid and be orderable. A `PRIVATE`/`buyable:false` plan is assign-only (only seed one if the request explicitly wants a hidden/manual plan).
- **`name`** is required, 1–50 chars. **`perks[]`** are **display-only** (`{ description }`, ≤ 1400 chars each) — they are the bullet list shown on the plan card and have **no functional effect**. The actual bookings coverage is wired in STEP 2, **not** through `perks`.
- **`plan.status: "ACTIVE"` is REQUIRED** — omitting it returns `400 status value is required` (undocumented but enforced; `ACTIVE` is the only value).
- **`pricingVariants[].id` and `perks[].id` are REQUIRED, client-supplied GUIDs** — generate each in the shell (the `gen_uuid` helper above), never model-typed (→ malformed/duplicate → `400`), fresh per field. Only the plan's **own top-level `id`** is server-generated; it echoes the variant/perk ids you sent back in the response.
- On partial failure across multiple plans, retry the **failed** plan(s) **once** with the same format — do not loop.

**⚠️ Reading the response — the created plan is under `plan`, keep `plan.id`.** A successful create returns `200` with:

```json
{ "plan": {
  "id": "<planId>",
  "revision": "1",
  "name": "Studio Membership",
  "visibility": "PUBLIC",
  "buyable": true,
  "currency": "USD",
  "pricingVariants": [ { "id": "<variantId>", "name": "Monthly", "billingTerms": { … }, "pricingStrategies": [ … ] } ],
  "perks": [ { "id": "<perkId>", "description": "Unlimited group classes" } ]
} }
```

Keep each plan's **`plan.id`** into `seeded.pricing-plans.planIds[]` — it's the id the frontend orders by, **and** the `externalId` the STEP 2 integration keys on.

---

### STEP 2: Attach bookings services to a plan (integration — SKIP when there is no bookings in the run)

This is the **pricing-plans ↔ bookings membership link**: making a plan *cover* one or more bookable services so a member who holds the plan can book those services with their membership (frontend flow lives in `how-to-code-pricing-plans.md`). The link is **NOT** a field on the plan and **NOT** a perk — it goes through the separate **Benefit Programs API**, in three ordered sub-steps. Do this **per plan** that should cover services, using the plan's `plan.id` from STEP 1 and the **bookings service ids** from `setup-bookings.md`'s `seeded.bookings.serviceIds[]`.

**⚠️ CRITICAL: the three sub-steps are strictly ordered — each consumes an id from the previous:** `plan.id` → `programDefinition.id` → `itemSetId` → items. Don't parallelize them.

#### STEP 2a: Get the plan's program definition (READ — do not create it)

When a plan is created, the Pricing Plans app **automatically creates a matching "program definition"** in Benefit Programs. You **read** it (you never create it) by the plan id + namespace:

```bash
curl -X GET 'https://www.wixapis.com/benefit-programs/v1/program-definitions/by-namespace-and-external-id?externalId=<PLAN_ID>&namespace=@wix/pricing-plans' \
  -H 'Authorization: <AUTH>'
```

Response — keep **`programDefinition.id`** (this is the "programDefinitionId" STEP 2b needs):

```json
{ "programDefinition": {
  "id": "<programDefinitionId>",
  "namespace": "@wix/pricing-plans",
  "externalId": "<PLAN_ID>",
  "displayName": "…"
} }
```

- **⚠️ `namespace` is literally `@wix/pricing-plans`** (with the `@` and the slash) in every sub-step 2a–2c. The generic Benefit Programs docs use placeholder namespaces (`gym_rewards`, `benefit_programs_app`) — **do not** use those.
- **Provisioning is effectively immediate.** The program definition is created by the Plans app within ~1s of STEP 1. It's still created *asynchronously*, so if this GET returns `404`/empty right after creating the plan, **retry once after a short backoff** as insurance — do not loop.

#### STEP 2b: Create the pool definition (one per integrating app)

Create **one** pool definition holding **exactly one** benefit that names the Bookings app as the provider:

```bash
curl -X POST 'https://www.wixapis.com/benefit-programs/v1/pool-definitions' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "poolDefinition": {
      "namespace": "@wix/pricing-plans",
      "displayName": "Bookings benefit",
      "programDefinitionIds": ["<programDefinitionId FROM 2a>"],
      "details": {
        "benefits": [
          {
            "benefitKey": "<RANDOM_UUID>",
            "displayName": "Bookings sessions",
            "providerAppId": "13d21c63-b5ec-5912-8397-c3a5ddb27a97",
            "price": "0"
          }
        ]
      }
    },
    "cascade": "IMMEDIATELY"
  }'
```

Response — keep the generated **`itemSetId`** for the benefit (matched by its `benefitKey`):

```json
{ "poolDefinition": {
  "id": "<poolDefinitionId>",
  "programDefinitionIds": ["<programDefinitionId>"],
  "namespace": "@wix/pricing-plans",
  "details": { "benefits": [
    { "benefitKey": "<RANDOM_UUID>", "itemSetId": "<itemSetId>", "providerAppId": "13d21c63-b5ec-5912-8397-c3a5ddb27a97", "price": "0" }
  ] }
} }
```

- **`benefitKey`** is a **freshly generated random UUID** you supply (any v4 UUID).
- **`providerAppId`** is the **Bookings** app def id `13d21c63-b5ec-5912-8397-c3a5ddb27a97` (the same GUID used as the bookings app id in the cart/frontend recipes). It is **not** the Pricing Plans id.
- **`price`** is credit-model, not money: **`"0"` = unlimited** sessions covered (leave `creditConfiguration` empty — the "unlimited membership" case, the default here); **`"1"` = limited credits**, which then requires a `details.creditConfiguration` (e.g. `{ "amount": "10" }` for a 10-session pack). Default to **`"0"` (unlimited)** unless the request names a session count.
- **⚠️ Limited-credit plan (`price:"1"`): `creditConfiguration` goes at `details.creditConfiguration` — a SIBLING of `benefits[]`, NOT a field inside a benefit.** Nesting it inside the benefit makes the server treat the credit pool as "not set up" and reject the non-zero price with `400 "Price should be 0 when credit pool is not set up"`. The correct `details` shape for a limited pack (e.g. an 8-class pass):
  ```json
  "details": {
    "creditConfiguration": { "amount": "8" },
    "benefits": [
      { "benefitKey": "<RANDOM_UUID>", "displayName": "Bookings sessions",
        "providerAppId": "13d21c63-b5ec-5912-8397-c3a5ddb27a97", "price": "1" }
    ]
  }
  ```
  (The unlimited case above keeps `price:"0"` and **no** `creditConfiguration`.)
- **One pool definition per integrating app** — for a plan covering bookings, that's exactly one pool with one benefit. Don't create a second pool for the same app on the same plan.
- **`itemSetId` path is `poolDefinition.details.benefits[i].itemSetId`** — pick the entry whose `benefitKey` matches the one you sent.

#### STEP 2c: Bulk-create the benefit items (one per covered service)

Attach the actual bookings services to the benefit — **one item per service** — via bulk create:

```bash
curl -X POST 'https://www.wixapis.com/benefit-programs/v1/bulk/items/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "items": [
      {
        "namespace": "@wix/pricing-plans",
        "category": "",
        "providerAppId": "13d21c63-b5ec-5912-8397-c3a5ddb27a97",
        "itemSetId": "<itemSetId FROM 2b>",
        "externalId": "<BOOKINGS_SERVICE_ID>"
      }
    ],
    "returnEntity": true
  }'
```

Response — standard bulk shape; each covered service lands under `results[].itemMetadata` (and `results[].item` because `returnEntity: true`):

```json
{ "results": [
  { "itemMetadata": { "id": "<benefitItemId>", "originalIndex": 0, "success": true },
    "item": { "id": "<benefitItemId>", "externalId": "<BOOKINGS_SERVICE_ID>", "itemSetId": "<itemSetId>" } }
], "bulkActionMetadata": { "totalSuccesses": 1, "totalFailures": 0 } }
```

- **`externalId` is the bookings SERVICE id** (`item.id` from `setup-bookings.md` STEP 3) — one item per service the plan should cover. Up to **100** items per call.
- **`category` is an empty string `""`**, and **`namespace`/`providerAppId`** repeat the STEP-2b values on every item.
- **The public path is `POST …/benefit-programs/v1/bulk/items/create`.** Some docs examples show a bare `…/bulk/items`; ignore that and use the `/bulk/items/create` form shown here.
- **Check `results[].itemMetadata.success` per item** (`false` populates `.error`); retry only the failed items **once** with the same format.

Keep the linkage in the seed map so the coding handoff can reason about coverage: `seeded.pricing-plans.bookingsCoverage = { <planId>: { itemSetId, serviceIds: [ … ] } }`.

---

## Conclusion
Following these steps **in order** sets up a Plans V3 Wix Pricing Plans site (and, when bookings is present, the membership integration):
- Each plan is created **`visibility: PUBLIC` + `buyable: true`** with pricing under **`pricingVariants[].billingTerms` + `pricingStrategies[].flatRate.amount`** (decimal **strings**), the cycle (`MONTH`/`1` by default) and type (recurring / one-time / free) chosen from the request; currency is site-derived, `perks` are display-only.
- **Bookings coverage is wired through the Benefit Programs API**, not the plan object: **read** the auto-created program definition (`programDefinition.id`) → create **one** pool definition with one benefit whose `providerAppId` is the **Bookings** app id (`price:"0"` = unlimited) → bulk-create **items** whose `externalId` is each covered **bookings service id**. This is **skipped** when bookings isn't in the run.
- IDs kept for the coding handoff: `planIds[]`, and (integration) per plan `{ itemSetId, covered serviceIds[] }`.
