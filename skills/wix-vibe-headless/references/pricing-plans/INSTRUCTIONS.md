
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
- **Plans grid** — `const { plans, nextCursor } = await queryPlans()` — **destructure**: it returns
  an object `{ plans, nextCursor }`, not a bare array, so `queryPlans().map(...)` /
  `(await queryPlans()).map(...)` throws `… is not a function`. Returns PUBLIC plans only; pass
  `nextCursor` back as `cursor` to load the next page, and iterate `plans`. For each plan render
  `name`, `description`, and `perks[].description` as feature bullets. Show a "Subscribe"/"Buy"
  button only when `plan.buyable` is true. See the `pages/Plans.jsx` snippet below for the worked
  listing (destructure + empty state + price + paging).
- **Price** — the amount is at `plan.pricingVariants[0].pricingStrategies[0].flatRate.amount`. It is
  a **decimal string** like `"20.00"` (a *string*, never a number) where `"0"` means the plan is
  **free**. Do not do math on it and do not compare `=== 0` (it's a string) — treat it as
  display-only text and pair it with `plan.currency` (ISO-4217, e.g. `"USD"`). Wix settles the real
  charge, tax, and proration at hosted checkout — never compute a final price yourself.
- **Billing cycle** — for a **recurring** plan the cycle lives at
  `plan.pricingVariants[0].billingTerms.billingCycle` = `{ period: "DAY"|"WEEK"|"MONTH"|"YEAR",
  count }` (e.g. `{ period: "MONTH", count: 1 }` = billed monthly). It is nested under
  `billingTerms` — there is **no** `billingCycle` directly on `pricingVariants[0]`. Free-trial
  length is `plan.pricingVariants[0].freeTrialDays`.
- **Plan image** — `plan.image` is a WixMedia object `{ id, width, height, altText }` with **no
  `.url`**; the `id` is a WixMedia id that must be converted to a URL before it can render. Never
  set `<img src={plan.image}>` or `<img src={plan.image.url}>` (both are `undefined` /
  `[object Object]`). To show it, resolve the WixMedia `id` to a URL per the Wix Media docs (use
  wix-docs), otherwise omit the image / use a placeholder.
- **Plan detail** — `getPlanBySlug(slug)` keyed off the URL slug (or `getPlanById(id)`); returns
  null on miss — show a not-found state, never invent a plan. Render perks, the full price/billing
  summary, free-trial note, and `termsAndConditions` if present.
- **Purchase** — `window.location.href = await checkout(planId, { thankYouPageUrl })`. This
  redirects to Wix-hosted checkout, which logs the member in (or signs them up), collects the
  order form, and takes payment. On success Wix returns to `thankYouPageUrl` with a
  `?planOrderId=<GUID>` query param (and `wixMemberLoggedIn`); on abandon/interrupt it returns to
  `postFlowUrl` (defaults to the current page). Never create the order or build the URL yourself.
- **My plans / confirmation** — `const orders = await getMyPlanOrders({ orderStatuses: ["ACTIVE"] })`
  for the logged-in member's current memberships (omit `orderStatuses` for all of them). It resolves
  to an **array** — `[]` for anonymous visitors (never throws), so show a "log in to see your plans"
  state and wire that log-in via the **members** vertical (`references/members/`) so they can sign in
  on your own UI. Renderable Order fields (confirmed in the JSDoc): `planName`, `status`
  (`DRAFT`/`PENDING`/`ACTIVE`/`PAUSED`/`ENDED`/`CANCELED`), `lastPaymentStatus`, `startDate`,
  `endDate` (date strings — format for display), `freeTrialDays`, `currentCycle`
  (`{ index, startedDate, endedDate }`), and `autoRenewCanceled`. Render only fields the order
  actually returns; for anything not in that list (e.g. the amount paid or next-billing figure) look
  it up in the Orders API reference (wix-docs) — never invent it. After returning from checkout,
  re-fetch (e.g. on mount + `visibilitychange`, or when `planOrderId` is in the URL) to show the new
  order. See the `pages/MyPlans.jsx` snippet below.
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

## Reference snippets (headless — adapt the logic, restyle freely)

The data wiring below (destructure shapes, the exact price/billing-cycle paths, the members-only
checkout redirect, the anonymous `[]` case) is correct and complete — the markup is deliberately
plain. **Copy the logic exactly; restyle the JSX to the brand.** They consume the `src/rest/`
helpers; you don't need to read their source.

**`pages/Plans.jsx`** — the listing (grid + empty state + paging) with the price/billing-cycle read
and the members-only checkout redirect. Note the destructure of `queryPlans()`, the price as a
decimal string (`"0"` = free), and the `billingTerms.billingCycle` nesting.

```jsx
import { useState, useEffect } from "react";
import { queryPlans, checkout } from "@/rest/wix-pricing-plans";

// Display-only — never compute the final charge (Wix settles price, tax, and schedule at checkout).
function readPrice(plan) {
  const v = plan.pricingVariants?.[0];
  const amount = v?.pricingStrategies?.[0]?.flatRate?.amount;   // decimal STRING e.g. "20.00"; "0" = free
  if (amount == null) return null;
  const cycle = v?.billingTerms?.billingCycle;                  // { period, count } for recurring; absent otherwise
  return { amount, isFree: amount === "0", cycle, freeTrialDays: v?.freeTrialDays };
}

function PriceLabel({ plan }) {
  const p = readPrice(plan);
  if (!p) return null;
  if (p.isFree) return <span>Free</span>;
  const per = p.cycle ? ` / ${p.cycle.count} ${p.cycle.period.toLowerCase()}` : "";   // e.g. "/ 1 month"
  return <span>{p.amount} {plan.currency}{per}{p.freeTrialDays ? ` · ${p.freeTrialDays}-day free trial` : ""}</span>;
}

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // NB: destructure — queryPlans returns { plans, nextCursor }, NOT a bare array.
    queryPlans().then(({ plans, nextCursor }) => { setPlans(plans); setCursor(nextCursor); setLoaded(true); });
  }, []);

  const loadMore = () =>
    queryPlans({ cursor }).then(({ plans: more, nextCursor }) => { setPlans((p) => [...p, ...more]); setCursor(nextCursor); });

  async function buy(plan) {
    // members-only, Wix-hosted checkout; on success Wix returns to thankYouPageUrl with ?planOrderId=<GUID>
    window.location.href = await checkout(plan.id, { thankYouPageUrl: `${window.location.origin}/thank-you` });
  }

  if (loaded && plans.length === 0)
    return <p>{/* empty state — no plans yet; tell the user to create plans in their Wix dashboard */}</p>;

  return (
    <div /* restyle */>
      {plans.map((plan) => (
        <div key={plan.id} /* restyle: plan card */>
          {/* plan.image is a WixMedia object { id, width, height, altText } with NO .url — resolve the
              id to a URL (wix-docs) before rendering, or omit; never <img src={plan.image}> */}
          <h3>{plan.name}</h3>
          {plan.description && <p>{plan.description}</p>}
          <PriceLabel plan={plan} />
          <ul>{(plan.perks || []).map((perk) => <li key={perk.id}>{perk.description}</li>)}</ul>
          {plan.buyable && <button onClick={() => buy(plan)}>Subscribe</button>}
        </div>
      ))}
      {cursor && <button onClick={loadMore}>Load more</button>}
    </div>
  );
}
```

**`pages/MyPlans.jsx`** — the member's current memberships and the post-checkout confirmation.
`getMyPlanOrders(...)` resolves to an array (`[]` for anonymous visitors), and the view re-syncs on
`visibilitychange` so a plan bought via hosted checkout shows up on return.

```jsx
import { useState, useEffect, useCallback } from "react";
import { getMyPlanOrders } from "@/rest/wix-pricing-plans";

export default function MyPlans() {
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    // [] for anonymous visitors (no member context) — never throws.
    getMyPlanOrders({ orderStatuses: ["ACTIVE"] }).then((o) => { setOrders(o); setLoaded(true); });
  }, []);

  useEffect(() => {                                   // load once + re-sync on return from hosted checkout
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  if (loaded && orders.length === 0)
    return <p>{/* not a member → "log in to see your plans" (members vertical); member with none → "no active plans" */}</p>;

  return (
    <ul /* restyle */>
      {orders.map((order) => (
        <li key={order.id}>
          <span>{order.planName}</span>
          <span>{order.status}</span>                                  {/* ACTIVE | PAUSED | ENDED | CANCELED | … */}
          {order.startDate && <span>from {new Date(order.startDate).toLocaleDateString()}</span>}
          {order.endDate && <span>until {new Date(order.endDate).toLocaleDateString()}</span>}
        </li>
      ))}
    </ul>
  );
}
```

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
