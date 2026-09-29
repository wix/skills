# Pricing Plans — seeding

Seed by **running `seed-pricing-plans.mjs` with a plan file** — don't hand-write the REST
calls. The script mints its own site token via the Wix CLI (logged-in session +
`wix.config.json` required), installs the Pricing Plans app if needed, and creates everything
in the right order.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/templates/pricing-plans/seed/seed-pricing-plans.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3 plans** — a tier ladder
the grid can render (e.g. free / monthly with a trial / yearly with a setup fee), each with 3–4
perks; together they exercise every price shape the UI handles (free, cadence, trial badge, fee
line). Plans have no seedable images (the owner adds one per plan in the dashboard).

```json
{
  "plans": [
    { "name": "Community", "type": "free",
      "description": "Get a taste — member perks, zero commitment.",
      "perks": ["Member-only newsletter", "Community events access"] },
    { "name": "Studio Membership", "price": "29.00",
      "type": "recurring", "billingCycle": { "period": "MONTH", "count": 1 },
      "freeTrialDays": 14,
      "description": "The full experience, month to month.",
      "perks": ["Unlimited group classes", "10% off workshops", "Priority booking"] },
    { "name": "Annual Pass", "price": "290.00",
      "type": "recurring", "billingCycle": { "period": "YEAR", "count": 1 },
      "setupFee": { "name": "Registration fee", "amount": "25.00" },
      "description": "Two months free, billed yearly.",
      "perks": ["Everything in Studio Membership", "2 guest passes", "Annual member gift"] }
  ]
}
```

- `type` — `"recurring"` (default; `billingCycle` defaults to `{ "period": "MONTH", "count": 1 }`),
  `"one-time"` (bills once, then ends; `billingCycle: null` makes it never expire), or
  `"free"` (amount forced to `"0"` + a per-member-lifetime purchase limit).
- `price` — a decimal string (`"29.00"`; a number is stringified). Currency is site-derived —
  never sent per plan.
- `currency` — 3-letter ISO code at the top of the plan, set **only when the brief names one**: a
  sentence about currency, or a price written with its unit ("9 dollars", "$9", "€20"). Do **not**
  infer it from a language, a country, or an address. The seed sets the site to it before creating
  anything, because prices are stored in the site currency at create time; a new site starts in the
  currency of the account that created it, not the business's.
- `freeTrialDays` — days before the first charge (a number, up to 999), on a paid plan; the card
  shows "14-day free trial". Omit for none.
- `setupFee` — `{ "name", "amount" }`: one additional fee charged with the first payment, shown
  with the price ("+ €25.00 Registration fee"). `fees` is the array form (up to 5). Amounts are
  decimal strings in the site currency, like `price`. Only when the brief names a fee — never invent one.
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

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For pricing plans, each plan the
user lists is one entry. Its name becomes `name`; a price with a billing period becomes `price`
with `type: "recurring"` and the matching `billingCycle`; a price paid once becomes
`type: "one-time"`; no price means `type: "free"`; a list of features or benefits becomes `perks`;
the description becomes `description`; a trial ("first two weeks free") becomes `freeTrialDays`; a
one-off joining/registration/setup charge becomes `setupFee`. A price with no period is a question
for the user.

## Escape hatch — individual functions
`setupPricingPlans` composes exported steps — `installPricingPlansApp`, `createPlans`,
`attachBookingsCoverage` (and its `getProgramDefinition`, `createPoolDefinition`,
`createBenefitItems` sub-steps), plus `makeCtx()` — import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; every call the script
makes carries a `docs:` line with its reference page.
