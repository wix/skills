
# Wix Pricing Plans Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and this vertical's `references/pricing-plans/wix-pricing-plans.js`. Copy **both** into your app's `src/rest/` side by side — the helper does `import { wixApiRequest } from "./wix-client.js"`, so they must land in the same folder.

Builds a real, client-only Wix pricing-plans / membership front end. The browser talks to Wix
directly over a public `WIX_CLIENT_ID`. Never mock plans; never hand-build a `/checkout` or
purchase URL — purchasing always goes through the Wix-hosted **redirect-session** (which also
handles member login and payment).

## When to use
- User wants a "Plans & Pricing", membership, or subscription page on a Wix site.
- User asks to "connect Wix pricing plans" or sell memberships / subscriptions / paid plans.
- Replacing placeholder/mock plans with live Wix data.
- Adding a plan detail page, a buy/subscribe button, or a "my plans" area over existing plans.

## Prerequisites
1. A Wix site with **Pricing Plans installed and at least one plan created** (this skill does
   NOT provision — it's read-only over the plans the merchant added in the dashboard).
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the Wix
   Business Manager surfaces a copyable prompt with the id filled in — see the router `SKILL.md`). Paste
   it into `src/rest/wix-client.js` in place of the placeholder. It is a buyer-facing credential
   (it only mints anonymous visitor tokens), **not** a secret, so hardcoding/committing it is fine.
3. **Purchasing a plan is members-only and uses Wix-hosted checkout.** The hosted flow handles
   member login/signup + the order form + payment, then returns to your site. The deployed app
   domain must be allow-listed on the OAuth client for that return to work — this is a **separate
   Wix setup flow the user completes later**, out of this skill's scope. If the return fails
   before that setup is done, that's expected; flag it and continue.
4. To actually charge for paid plans, the site needs a payment method connected and (where
   applicable) tax/business-address configured in the Wix dashboard. Free plans work without this.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the page's UI however the project
wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only adjust
import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to the
  id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh token is
  persisted to localStorage; after a hosted checkout the same identity returns as a logged-in
  member. Do not re-mint anonymously per load.
- `src/rest/wix-pricing-plans.js` — exports:
  - **Plans:** `queryPlans`, `getPlanById`, `getPlanBySlug`
  - **Purchase:** `checkout`
  - **Member:** `getMyPlanOrders`

The Plan and Order shapes are documented as JSDoc comments at the top of `wix-pricing-plans.js`.
Read them before building the UI — pricing has several models (recurring subscription,
single-payment-for-duration, single-payment-unlimited, free, plus free trials) and the JSDoc
shows exactly how to read price, cycle, and trial for display.

## How to wire it (UI is the project's choice)
- **Plans grid** — `queryPlans()` for the listing (PUBLIC plans only); pass `nextCursor` back as
  `cursor` to load the next page. For each plan render `name`, `description`, `perks[].description`
  as feature bullets, and the price from `pricingVariants[0]` (see the JSDoc "Reading the price"
  notes: `pricingStrategies[0].flatRate.amount` + plan `currency`, plus `billingCycle` for
  recurring and `freeTrialDays` for trials). Show a "Subscribe"/"Buy" button only when
  `plan.buyable` is true.
- **Plan detail** — `getPlanBySlug(slug)` keyed off the URL slug (or `getPlanById(id)`); returns
  null on miss — show a not-found state, never invent a plan. Render perks, the full price/billing
  summary, free-trial note, and `termsAndConditions` if present.
- **Purchase** — `window.location.href = await checkout(planId, { thankYouPageUrl })`. This
  redirects to Wix-hosted checkout, which logs the member in (or signs them up), collects the
  order form, and takes payment. On success Wix returns to `thankYouPageUrl` with a
  `?planOrderId=<GUID>` query param (and `wixMemberLoggedIn`); on abandon/interrupt it returns to
  `postFlowUrl` (defaults to the current page). Never create the order or build the URL yourself.
- **My plans / confirmation** — `getMyPlanOrders()` for the logged-in member's purchases; filter
  with `{ orderStatuses: ["ACTIVE"] }` for current memberships. After returning from checkout,
  re-fetch (e.g. on mount + `visibilitychange`, or when `planOrderId` is in the URL) to show the
  new order. Returns `[]` for anonymous visitors — show a "log in to see your plans" state, and wire
  that log-in via the **members** vertical (`references/members/`) so they can sign in on your own UI.
- **Empty state** — if `queryPlans()` returns no plans, show an empty state telling the user to
  create plans in their Wix dashboard. Never invent plans.

## Hard rules (do not violate)
- ✅ Purchase ONLY via `checkout()` (`/headless/v1/redirect-session` with `paidPlansCheckout`),
  then redirect to `redirectSession.fullUrl`.
- ❌ Never hand-build a checkout, purchase, or `/plans-checkout` URL; never call create-order
  directly from the client to "skip" the hosted flow.
- ❌ Never mock plans — render live Wix data or the empty state.
- ❌ Never invent perks, prices, trials, testimonials, or member counts. Render only what the
  plan object returns; empty perks → no feature list.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ Treat plan objects as display-only — never compute the final charge; Wix settles price, tax,
  proration, and schedule during hosted checkout.
- ✅ Show the buy button only when `plan.buyable` is true; otherwise the plan is merchant-assigned.
- The engine fails loudly on purpose: `checkout()` throws if it can't create the redirect session.
  A green path means it really reached Wix-hosted checkout — don't swallow these.

## Beyond the snippets
The snippets cover the common plans paths. If you hit a use case they don't cover, make the call
yourself with `wixApiRequest` — but look up the exact endpoint, HTTP method, and request body in
the **official Wix API reference** first; never guess:
- Pricing Plans API reference: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans.md
- Orders (cancel / pause / resume a member's order, price preview): https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders.md
- Headless redirect session (login, logout, other checkouts): https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md

Common genuine gaps and where to look:
- **Cancel / pause / resume** a member's subscription → Orders API (`request-cancellation`,
  `pause-order`, `resume-order`). Gate on `plan.buyerCanCancel`.
- **Member login / logout** outside of a purchase → use the **members** vertical
  (`references/members/INSTRUCTIONS.md`) for *custom* login (email+password / Google / Facebook / SSO)
  on your own UI — so a member can log in *before* subscribing and see "my plans" without going through
  a purchase. Pair it with this vertical whenever plans need a real account surface.
- **Coupons / custom start date** at purchase → covered by the hosted checkout; for a fully
  custom flow see Create Online Order in the Orders reference.

Keep the snippets as the default for everything they already do; reach for the API reference only
for the gap.

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the pricing plans content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For pricing plans data those pages are:
- **Pricing Plans** — `https://manage.wix.com/dashboard/{metaSiteId}/pricing-plans` (`Dashboard → Pricing Plans`) → **+ Create Plan** (set the name, pricing model, perks, and connect the plan to the content/services it unlocks)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Plans list renders live data; price, billing cycle, and free trial read correctly across
      pricing models (recurring, single-payment, free)
- [ ] Plan detail loads by slug and shows a not-found state on a bad slug
- [ ] Buy button shown only for `buyable` plans
- [ ] Purchase redirects via redirect-session `fullUrl` (no hand-built URL) and reaches
      Wix-hosted login + payment
- [ ] On return, the new order appears via `getMyPlanOrders()` (and a "log in" state shows for
      anonymous visitors)
- [ ] Empty state shown when `queryPlans()` returns no plans
- [ ] No mock plans, perks, or prices anywhere
- [ ] Told the user at least once that they can continue setting up their plans in the dashboard and provided deep links.
