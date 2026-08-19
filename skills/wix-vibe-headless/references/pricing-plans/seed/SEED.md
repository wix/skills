# Pricing Plans — seeding

Seed Wix Pricing Plans (Plans V3) by **calling `seed-pricing-plans.js`** — don't hand-write the
REST calls. It's a build-time module (run via `exec_tool`, not shipped in the app) that abstracts
every Pricing Plans + Benefit Programs seed operation. `require` it and call the functions with
plain data.

> **NOT yet live-verified — transcribed from `setup-pricing-plans.md`.**

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // connector name: "wix" or "wixheadless"
const fs = require("fs");
// exec_tool's require can return EMPTY exports for these build-time modules — load the file itself:
const seed = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync("/app/.agents/skills/wix-vibe-headless/references/pricing-plans/seed/seed-pricing-plans.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// setupPricingPlans installs the Wix Pricing Plans app first (idempotent) — base44 sites may not have it.

// DEFAULT: one call. Creates the plan(s), keeps their ids in memory, and (per plan) wires bookings
// coverage when provided — createPlans then attachBookingsCoverage (2a→2b→2c), in order.
const { plans, coverageAttached, benefitsCreated } = await seed.setupPricingPlans(ctx, {
  plans: [
    { name: "Studio Membership", description: "Unlimited group classes.", price: "20.00",
      type: "recurring", billingCycle: { period: "MONTH", count: 1 },
      perks: ["Unlimited group classes", "10% off workshops"],
      coveredServiceIds: bookingsServiceIds },  // optional — only when this plan covers bookings services
    // …just the plan data. price = decimal STRING; currency is site-derived (don't send it).
    // limited pack instead of unlimited: bookingsCoverage: { serviceIds, creditAmount: 8 }
  ],
});
// A plans-only run (no bookings) just omits coveredServiceIds — STEP 2 is skipped automatically.
```

**Seeding is additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, don't reset. Just add.

## Escape hatch — individual functions
Reach for the functions below only when the one-call `setupPricingPlans` doesn't fit (custom coverage,
step-by-step control). `setupPricingPlans` is built from them, in this order:

```js
const plans = await seed.createPlans(ctx, [
  { name: "Studio Membership", price: "20.00", perks: ["Unlimited group classes"],
    coveredServiceIds: bookingsServiceIds },
]);
// STEP 2 — only when bookings is in the run AND the plan covers services (skip otherwise):
await seed.attachBookingsCoverage(ctx, plans[0].id, plans[0].coveredServiceIds);
// limited pack instead of unlimited: attachBookingsCoverage(ctx, id, ids, { creditAmount: 8 })
```

## Functions
| fn | does |
|---|---|
| `setupPricingPlans(ctx, {plans})` | **DEFAULT** one call: createPlans → per-plan attachBookingsCoverage → `{plans,coverageAttached,benefitsCreated}` |
| `createPlans(ctx, plans)` | one create call per plan (V3 has no bulk) → `[{id,name,coveredServiceIds}]` |
| `attachBookingsCoverage(ctx, planId, serviceIds, {creditAmount?})` | STEP 2: 2a→2b→2c in order → `{itemSetId,serviceIds}` |
| `getProgramDefinition(ctx, planId)` | 2a: READ the auto-created program definition (retry-once on 404) → `programDefinitionId` |
| `createPoolDefinition(ctx, programDefinitionId, {creditAmount?})` | 2b: one pool + one Bookings benefit → `itemSetId` |
| `createBenefitItems(ctx, itemSetId, serviceIds)` | 2c: bulk-create one benefit item per covered service |

Plan `type`: `"recurring"` (default; `billingCycle` defaults to `{MONTH,1}`), `"one-time"`
(bills once then ends; pass `billingCycle: null` for the unlimited one-time), or `"free"`
(amount forced to `"0"` + a per-member-lifetime purchase limit). Amounts are decimal **strings**;
`perks` are display-only bullets; plans default to `visibility: "PUBLIC"` + `buyable: true`.

## Bookings-first dependency
STEP 2 attaches **bookings service ids** to a plan through the Benefit Programs API (the coverage
is NOT a plan field or a perk). Those ids come from the **bookings seed**
(`seeded.bookings.serviceIds[]`), so **seed bookings before pricing-plans** and pass the ids in as
`coveredServiceIds`. A plans-only run (no bookings) stops after `createPlans` — skip STEP 2 entirely.

## Reference
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-pricing-plans.md`.

Read a method's page before writing its call: it carries the exact body shape, the required
permission scope, and the response envelope.
- Install a Wix app onto the site: https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/install-app.md
- Create Plan: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan.md
- Create Pool Definition (benefits): https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pool-definitions/create-pool-definition.md
- Bulk Create Items (benefits): https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/items/bulk-create-items.md
- Get Program Definition By External Id And Namespace: https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/get-program-definition-by-external-id-and-namespace.md
