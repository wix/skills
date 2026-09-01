# Pricing Plans — seeding

Seed by **running `seed-pricing-plans.mjs` with a plan file** — don't hand-write the REST
calls. The script mints its own site token via the Wix CLI (logged-in session +
`wix.config.json` required), installs the Pricing Plans app if needed, and creates everything
in the right order.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/pricing-plans/seed/seed-pricing-plans.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3 plans** — a tier ladder
the grid can render (e.g. free / monthly / yearly), each with 3–4 perks; together they
exercise every price shape the UI handles. Plans have no seedable images (the owner adds one
per plan in the dashboard).

```json
{
  "plans": [
    { "name": "Community", "type": "free",
      "description": "Get a taste — member perks, zero commitment.",
      "perks": ["Member-only newsletter", "Community events access"] },
    { "name": "Studio Membership", "price": "29.00",
      "type": "recurring", "billingCycle": { "period": "MONTH", "count": 1 },
      "description": "The full experience, month to month.",
      "perks": ["Unlimited group classes", "10% off workshops", "Priority booking"] },
    { "name": "Annual Pass", "price": "290.00",
      "type": "recurring", "billingCycle": { "period": "YEAR", "count": 1 },
      "description": "Two months free, billed yearly.",
      "perks": ["Everything in Studio Membership", "2 guest passes", "Annual member gift"] }
  ]
}
```

- `type` — `"recurring"` (default; `billingCycle` defaults to `{ "period": "MONTH", "count": 1 }`),
  `"one-time"` (bills once, then ends; `billingCycle: null` makes it never expire), or
  `"free"` (amount forced to `"0"` + a per-member-lifetime purchase limit).
- `price` — a decimal string (`"29.00"`; a number is stringified). Currency is site-derived —
  never sent.
- `perks` — display-only bullets on the plan card; they grant nothing by themselves.
- `termsAndConditions` (plain text), `visibility` (`"PUBLIC"`), `buyable` (`true`) — optional
  overrides. A `buyable: false` plan renders without a subscribe CTA (merchant-assigned).

## Covering bookings services (only when bookings is also seeded)

A plan can COVER bookings services — members then book them with the membership. The link
goes through the Benefit Programs API, not the plan object, keyed by the **bookings seed's
service ids** — so seed bookings FIRST, then pass the ids:

```json
{ "name": "Studio Membership", "price": "29.00",
  "perks": ["Unlimited group classes"],
  "coveredServiceIds": ["<bookings service id>", "…"] }
```

Unlimited coverage is the default; a limited pack (e.g. 8 sessions) instead uses
`"bookingsCoverage": { "serviceIds": [...], "creditAmount": 8 }`. A plans-only run just
omits both — coverage is skipped automatically.

**Seeding is additive — never delete or overwrite existing content**; ask first if a cleanup
seems needed.

## Escape hatch — individual functions
`setupPricingPlans` composes exported steps — `installPricingPlansApp`, `createPlans`,
`attachBookingsCoverage` (and its `getProgramDefinition`, `createPoolDefinition`,
`createBenefitItems` sub-steps), plus `makeCtx()` — import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; the
authoritative source recipe is `wix-headless/references/inline-recipes/setup-pricing-plans.md`.
