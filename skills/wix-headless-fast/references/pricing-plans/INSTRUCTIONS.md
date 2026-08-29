# Pricing Plans — playbook

The plans machinery ships as files — plan reads (grid + by-slug) and the hosted purchase
redirect, typed end-to-end. **The presentation is yours**: you design and implement the plan
card, the pricing grid, and the plan detail surface on the shipped hooks/DTOs, plus the home
page and the brand. You never write purchase logic; you never skip designing.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read a reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/pricing-plans/types.ts` | the DTOs (`PlanSummary`, `PlanDetail`) — contracts below |
| `wix/pricing-plans/plans.ts` | `fetchPlans`, `fetchPlanBySlug` |
| `wix/pricing-plans/purchase.ts` | `purchasePlan` — the hosted-checkout redirect session lives here |
| `hooks/pricing-plans/usePlans.ts` | plans listing — contract below |
| `hooks/pricing-plans/usePlanPurchase.ts` | the purchase action — contract below |
| `components/pricing-plans/PlansView.tsx` (+ `PlanCard`) · `PlanDetailView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add a Plans nav link there |
| `pages/plans.astro` | SSR pricing grid — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/plans/[slug].astro` | SSR plan detail — **keep the frontmatter** (plain `<title>`/`<meta>` from the DTO: Pricing Plans has no owner-editable SEO item type); swap the island import |

## What you build — the design job

1. **The plan card + pricing grid** — your tier card (name, price + billing cadence, trial
   badge, perks list, Subscribe CTA — only when `buyable`) and grid rhythm (a highlighted
   recommended tier is a classic), with skeletons while loading and an honest empty state —
   on `usePlans` + `usePlanPurchase`.
2. **The plan detail surface** — the full pitch: price block, perks, terms & conditions
   (plain text — render pre-wrap), subscribe CTA — on `usePlanPurchase` (the plan itself
   arrives as an SSR-fetched DTO prop).
3. **The home page** — hero, a featured-plans strip (fetch in frontmatter → your components),
   brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### The contracts your components consume

```ts
// PlanSummary (cards) — display-ready:
// { id, slug, name, description, price /* "$29.00" | "Free" */, free,
//   billing /* "per month" | "every 3 months" | "one-time" | "" (free) */,
//   freeTrialDays: number|null, perks: string[], buyable, imageUrl /* "" when none */ }
// PlanDetail adds: termsAndConditions (plain text; "" when not set).

// usePlans({ initialPlans? }) →
// { plans: PlanSummary[]|null /* null = loading → skeletons */, error }

// usePlanPurchase() →
// { purchase(planId, { thankYouPageUrl?, postFlowUrl? }?): Promise<void>,
//     // resolves as the browser navigates to the Wix-hosted checkout;
//     // rejects with a visitor-facing message — surface it
//   purchasingId,   // plan id in flight (null when idle) — key the CTA spinner off it
//   error }
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   other vertical's layout instead if both are deployed).
2. Write your components under `src/components/pricing-plans/` (new names — don't overwrite
   the references), swap the island imports in `pages/plans.astro` and
   `pages/plans/[slug].astro`. Both islands: `client:load` with the SSR DTO props. **Author
   your surfaces in as few messages as possible** — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/plans` → your grid; `/plans/:slug` → fetch with
`fetchPlanBySlug(slug)` client-side, then your detail surface (null → your not-found state).

## Hard rules

- **Purchase only through the shipped exports** — `usePlanPurchase`/`purchasePlan` own the
  hosted redirect session. Never hand-build a checkout URL, never call
  `orders.createOnlineOrder` (member-only, and it leaves payment unhandled), never mark
  anything paid.
- **Purchasing is members-only, and that's fine as-is**: the hosted flow handles member
  login/signup, the order form, and payment, then returns to your site. Don't build a login
  gate in front of the CTA.
- **No success theater.** Returning from checkout is NOT a success signal — `postFlowUrl` is
  hit on abandon too. Success arrives only at a `thankYouPageUrl` you pass, as
  `?planOrderId=<GUID>`; if you build a thank-you page, read that param — never fake a
  confirmation off the mere return.
- **Prices are display-only.** `price`/`billing` come pre-formatted; never compute a charge,
  discount, or proration — Wix settles price, tax, and schedule at the hosted checkout.
- **Show the Subscribe CTA only when `buyable`** — a PUBLIC plan can be merchant-assigned.
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.
- Live data or an honest empty state — never mock plans, prices, or perks.

## Out of scope (don't improvise these)

Member-gated surfaces — a "my plans" page, the member's orders (`orders.memberListOrders`),
cancel/pause flows, and booking a covered bookings service with a membership — require a
logged-in member session this skill doesn't ship yet. Subscribers manage their plan through
Wix's emails and hosted member flows. If the user asks for a member area, route to
`wix-headless` (members recipes) rather than shipping code that returns nothing for visitors.

## Point the user to their dashboard

Give the owner the dashboard link plus the Pricing Plans page — the deploy step's JSON
printed `dashboardUrl`; append `/pricing-plans` for plan management (edit plans, connect
plans to content, see orders). Taking real payments needs a premium plan + a connected
payment method — mention it.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-pricing-plans.mjs` from the project
root. Seed a tier ladder that exercises the UI (a free tier, a monthly, a yearly or
one-time; 3–4 perks each).

## Verify

- The Pricing Plans APIs return nothing against an **unpublished** site — release before checking plans. (before declaring done)

- [ ] `/plans` renders live plans SSR (view-source shows names) through YOUR components;
      empty catalog shows your honest empty state.
- [ ] Every price shape reads right: free ("Free", no cadence), recurring ("$29.00 per
      month"), one-time; Subscribe renders only on `buyable` plans.
- [ ] A plan page loads by slug and 404s (Astro) / shows not-found (SPA) on a bad slug.
- [ ] Subscribe redirects to the Wix-hosted checkout (login/signup + payment live there).
- [ ] Card/grid/detail/home are YOUR designs on the tokens; data-layer/hook files unedited.
- [ ] Dashboard links handed to the owner.
