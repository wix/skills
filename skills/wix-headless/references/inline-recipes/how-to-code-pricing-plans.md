---
name: "How to Code Pricing Plans"
description: The frontend contract for a Wix Pricing Plans (Plans V3) site — which `@wix/pricing-plans` modules to import, how to list plans for the grid, order a plan for a logged-in member, read the member's own subscriptions, and (the integration) let a member book a Bookings service with their membership. Specifies the *how* (modules + exact calls + the failure modes the docs omit); which plans to render and how the page looks come from the request.
---
**RECIPE**: How to Code a Wix Pricing Plans Frontend (Plans V3 + members + the Bookings-membership integration)

A contract for the **frontend code** of a pricing-plans site: showing the plans grid, subscribing (ordering) a plan, a member's "my subscription" surface, and — when the site also has Bookings — booking a service **with** an active membership. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — which plans to show, how the page looks, and the framework come from the request you're fulfilling.

> **This recipe is for CODING, not seeding.** It assumes a Plans V3 backend already exists (plans created, and — for the integration — bookings services attached to a plan via Benefit Programs; see `setup-pricing-plans.md`). It says nothing about creating plans — only how to read and buy them from frontend code.

> **⚠️ Reading rule — append `.md?apiView=SDK` to every doc link below.** Wix docs render two views: the **bare/REST view shows `id`**, the **`?apiView=SDK` view shows `_id`** — the SDK is what your frontend calls. A surprising field name usually means you're reading the REST view. Discover any shape not pinned here with `SearchWixSDKDocumentation`, not by guessing a URL.

> **⚠️ pricing-plans is a HARD dependency on members.** Ordering a plan and the "my subscription" surface both require a **logged-in member** (browsing the grid is public). So this recipe is always paired with member auth — read the matching **`how-to-code-members-astro.md`** or **`how-to-code-members-non-astro.md`** for the login flow. A logged-in member ordering their own plan needs **no `auth.elevate`** and **no `onBehalf`**.

---

## The modules and the client (read this first)

**⚠️ Two different packages — use the headless one.** The Wix docs surface `checkout.startOnlinePurchase()` / `checkout.createOnlineOrder()` under **`@wix/site-pricing-plans`** — that is the **Wix-site (Velo / `$w` page-code) package**, and `startOnlinePurchase` drives the **Wix Pay frontend UI** that only exists inside a hosted Wix page. **It is NOT the headless path** — do not import `@wix/site-pricing-plans` in a headless frontend. Use **`@wix/pricing-plans`** (the universal/headless SDK), whose `orders.createOnlineOrder` creates the order and leaves payment to a redirect you drive (see *Subscribing*).

| Need | Package | Module / namespace |
|---|---|---|
| List / read plans (the grid) | `@wix/pricing-plans` | `plansV3` (Plans V3 — `queryPlans`, `getPlan`) |
| Order a plan + read a member's orders | `@wix/pricing-plans` | `orders` (`createOnlineOrder`, `memberListOrders`, `memberGetOrder`) |
| Member login / current member | `@wix/members` + `@wix/sdk` auth | see the members recipe (`getCurrentMember`, `loggedIn()`) |
| Book a service with a membership (integration) | `@wix/bookings` + `@wix/ecom` (+ `@wix/redirects`) | `bookings` (`createBooking`), ecom `checkout` (`membershipOptions`) — see *Booking with a membership* |

**Never** import `@wix/site-pricing-plans` in headless code, and don't reach for a V1 `plans`-collection query — Plans V3 (`queryPlans` → `pricingVariants`) is the shape the seed creates.

> **⚠️ The read module is `plansV3`, not `plans`.** In the `@wix/pricing-plans` SDK, `queryPlans`/`getPlan` live on the **`plansV3`** namespace (`import { plansV3, orders } from '@wix/pricing-plans'`). Importing `plans` and calling `plans.queryPlans()` fails to type-check (`Property 'queryPlans' does not exist`). `orders` keeps its own namespace.

**Auth / client — framework split** (same split as every other coding recipe):
- **Astro (Wix-managed):** auth is ambient — call `plansV3` / `orders` directly from server components / `src/pages/api/*`. Member identity rides on the call automatically after login (`how-to-code-members-astro.md`). **No `createClient`, no `OAuthStrategy`, no `clientId`.** A member reading their own orders needs **no `auth.elevate`**.
- **Non-Astro (Vite/React/Vue/static):** build one manual client and reuse it — the **same** `OAuthStrategy` client the members/visitor flow already builds (don't make a second one). After the member-login handshake sets member tokens on it, `orders.*` runs as that member:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { plansV3, orders } from '@wix/pricing-plans';
  const client = createClient({ modules: { plansV3, orders }, auth: OAuthStrategy({ clientId: /* public OAuth id */ }) });
  ```

> **The connected site must be PUBLISHED** — the Pricing Plans APIs return nothing / error against an unpublished site and don't work in preview (same precondition as member login). Publish before testing.

---

## The features (build the ones the site needs)

Each subsection is self-contained — build only what the site uses.

### Listing plans for the grid (public, and the `_id` rule)

```js
const { items } = await plansV3.queryPlans()
  .eq('visibility', 'PUBLIC')
  .find();                                    // items[] of Plan
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans.md?apiView=SDK>

- **The grid read is public** — a visitor token lists `PUBLIC` plans; no login needed just to browse.
- **⚠️ Entity id is `_id`, not `id`** — `plan._id` is what you order by and key React lists on. (`plan.id` is `undefined` in SDK code — you're reading the REST view if you see `id`.)
- **⚠️ Price lives in `pricingVariants[]`, NOT a top-level `price`.** Read the amount from `plan.pricingVariants[0].pricingStrategies[0].flatRate.amount` (a **decimal string** — parse before math) and the cycle from `plan.pricingVariants[0].billingTerms.billingCycle` (`{ period: "MONTH", count: "1" }`). A free plan has no `flatRate` amount; a one-time plan has different `billingTerms` (see the seed recipe). `plan.currency` is the site's currency — format from it, don't assume USD.
- **Show only `buyable` plans with a buy button.** `visibility: "PUBLIC"` can still be `buyable: false` (assign-only) — render those without a subscribe action, or filter them out.
- **Perks** for the plan card are `plan.perks[]` (each `{ _id, description }`) — display-only text. (`queryPlans` returns them; if a summary trims them, `plansV3.getPlan(planId)` returns the full object.)

### Subscribing (ordering) a plan — login-gated

Ordering is a **member** action. Gate the subscribe button on `client.auth.loggedIn()` (non-Astro) / a resolved member (Astro) and bounce anonymous users into the login flow first (members recipe). Then:

```js
const { order } = await orders.createOnlineOrder(planId);   // planId = plan._id; logged-in member ⇒ no onBehalf
// order.status: "DRAFT" (payment not yet made) | "ACTIVE" (free plan — already applied)
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/create-online-order.md?apiView=SDK>

- **⚠️ A logged-in member needs no `onBehalf`** — the order is created on their behalf from the member identity. `onBehalf.memberId` is only for an app/admin identity ordering *for* someone (and needs elevation) — don't reach for it in a normal member flow.
- **⚠️ `DRAFT` ≠ subscribed.** `createOnlineOrder` **orders but does not pay** — a paid plan comes back `status: "DRAFT"` and is not active until payment completes. Do not show "you're subscribed" off the `createOnlineOrder` return for a paid plan.
- **Free plan:** returns `status: "ACTIVE"` (`lastPaymentStatus: "NOT_APPLICABLE"`) directly — no payment step; render success immediately. **Branch on the plan being free** (no `flatRate` amount / total `0`) to skip the redirect below.
- **⚠️ Paid plan — the payment redirect handoff is the one piece not pinned by the docs for headless.** The all-in-one `startOnlinePurchase` that completes payment is the **site-package** method (above), unavailable headless; the headless `createOnlineOrder` returns a `DRAFT` order carrying a `wixPayOrderId`, and the member must be sent to a hosted payment flow to complete it. **⚠️ VERIFY IN A LIVE BUILD:** confirm the exact headless redirect — whether you pass the order to `@wix/redirects` `createRedirectSession({ paymentCheckout: { … } })`, or a pricing-plans-specific redirect — before shipping the paid path. Do not assert a specific call here until a real build confirms it. (The `origin`/`postFlowUrl` allowlist + `https`-host rules from `how-to-code-a-store.md`/`how-to-code-bookings.md` apply to whatever redirect is used.) The **free-plan** path above is fully client-only and needs no redirect.
- **⚠️ SCOPE — the frontend's job ends at `createOnlineOrder` + the payment redirect. STOP THERE.** Do **NOT** try to *complete or activate* the purchase from code: don't connect a payments provider (`payments/v1/wix-payments-account/connect`), don't `PATCH`/update-plan to force a state, don't call mark-as-paid, and don't hunt for an "admin way to activate the order" or to "enable payments for a $0 order." Payment completing (a paid order flipping `DRAFT → ACTIVE`) happens **out-of-band** on Wix's hosted flow / by the merchant configuring payments — it is **not** a frontend step, and chasing it is a rabbit hole (it burns the run and ships nothing extra). A **free** plan already returns `ACTIVE` with no payment; a **paid** plan is `DRAFT` until the member pays through the redirect. If the site has **no payment provider configured**, that's a **site-setup precondition** (like the events paid-ticket precondition) — surface it, don't try to fix it in code.

### The member's "my subscription" surface — login-gated

```js
// the logged-in member's own orders:
const res = await orders.memberListOrders();       // filtered: orders.memberListOrders({ planIds, orderStatuses, paymentStatuses, limit, offset })
// ⚠️ member-scoped reads are memberListOrders / memberGetOrder — there is NO `orders.listOrders`/`getOrder` (those are the admin `managementListOrders`/`managementGetOrder`, server/elevate only).
// ⚠️ filter args are TOP-LEVEL limit/offset, NOT a nested `paging` object.
// each order: { _id, planId, subscriptionId, status, lastPaymentStatus, startDate, endDate, currentCycle, planName, pricing, planPrice }
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/introduction.md?apiView=SDK>

- **⚠️ Login required — returns nothing for an anonymous visitor.** Gate this surface behind auth; don't render "my subscription" for a logged-out user.
- **"Currently active" = `status === "ACTIVE"` AND now is within `startDate`…`endDate`.** A `CANCELED` order can still be within its paid period until `endDate`; `autoRenewCanceled: true` means it won't renew but may still be active now. Don't treat `CANCELED` as "no access" without checking the date window.
- Same **no-`auth.elevate`** rule: a member reading their own orders is authorized under the member token. Listing *all* members' orders is the admin/elevate axis (server-only) — not this.

### Booking a service with a membership (the integration — only when the site also has Bookings)

This is the payoff of the seed's STEP 2: a member who holds a plan that **covers** a service books it **with the membership** instead of paying per booking. Build the normal Bookings flow from **`how-to-code-bookings.md`** (list services → pick a slot → collect the form → `createBooking` → ecom cart/checkout); the membership is a **delta on that flow**, not a separate path:

1. **Require login** — membership payment resolves against the member identity (a covered service booked anonymously just falls back to pay-per-booking).
2. **On `createBooking`, set `selectedPaymentOption: "MEMBERSHIP"`** (instead of `ONLINE`/`OFFLINE`). Enum values: `ONLINE`, `OFFLINE`, **`MEMBERSHIP`** (pay with a pricing plan), `MEMBERSHIP_OFFLINE`. Doc: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md?apiView=SDK>
3. **The booking still rides the ecom checkout** (Bookings is an ecom catalog, appId `13d21c63-b5ec-5912-8397-c3a5ddb27a97`) — the membership is applied **on the checkout**, not on the booking object. The eligible plan surfaces on the **ecom Checkout** entity's `membershipOptions`:
   - `membershipOptions.eligibleMemberships[]` — the member's plans that can cover the line item (each `{ _id, appId, name, credits }`).
   - apply one via `checkout.updateCheckout(...)` setting `membershipOptions.selectedMemberships.memberships = [{ _id, appId, lineItemIds: [<booking line item id>] }]`. When the membership covers the full price, `payNow` drops to `0`.
   Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/checkout/checkout/get-checkout.md?apiView=SDK>
4. **⚠️ Do NOT call `confirmBooking`** — for a membership payment Wix **auto-confirms** the booking on redemption (the same "no confirmBooking" rule as `how-to-code-bookings.md`; the membership drives confirmation).

- **⚠️ Eligibility / coverage is a LIVE read, never a hardcoded plan→service map.** A new eligible plan, or a service newly added to a plan's coverage in the backoffice, **must be honored with no code change** — so never freeze the seed-time `{ planId → serviceIds }` map into the frontend. **Preferred:** read `checkout.membershipOptions.eligibleMemberships` — the plans that can cover *this* line item, computed server-side from live coverage. (It's tagged "reserved for internal use" in the schema, so **VERIFY IN A LIVE BUILD** whether a headless member token reads it client-side.) **Fallback if that field comes back empty for a member token:** list the member's active orders (`orders.memberListOrders`, `status: ACTIVE` within the date window) and match each `planId` against the plan's **live** Benefit-Program coverage (query the program's items — the same API `setup-pricing-plans.md` STEP 2 wrote to — at request time; do **not** read a coverage map baked into code). Set `selectedPaymentOption: "MEMBERSHIP"` + `selectedMemberships` from whichever read succeeds.
- **⚠️ A `MEMBERSHIP` booking on a service the plan does NOT cover fails at checkout** (unless `skipSelectedPaymentOptionValidation`, which needs elevation — don't use in a member flow). Only offer "book with membership" for services actually covered by one of the member's active plans; otherwise fall back to the normal paid booking (`how-to-code-bookings.md`).
- **Credit/session plans:** for a limited (non-unlimited) plan, `eligibleMemberships[].credits.remaining` matters — `0` remaining is not eligible. An unlimited plan (seed `price:"0"`) has no credit ceiling.

### Out of scope (do not build these)
- **Completing/activating payment from code** — connecting a payments account, marking orders paid, forcing an order `ACTIVE`, "activating" a subscription server-side. Payment is the member's hosted-flow step or a merchant dashboard/config task, never frontend code (see the SCOPE callout under *Subscribing*).
- **Configuring which services a plan covers** — that coverage is wired at seed time via Benefit Programs (`setup-pricing-plans.md` STEP 2); the frontend only *reads/uses* it, it doesn't create or edit it.
- **Cancelling / pausing / refunding a subscription, and dunning/renewal management** — post-purchase lifecycle beyond a read-only "my subscription" view is the hosted member area / dashboard, not this build.
- **Offline orders** (`createOfflineOrder` / mark-as-paid) — a merchant/admin flow, not a member-facing frontend one.

---

## Conclusion
A correct Pricing Plans frontend:
- imports **`@wix/pricing-plans`** (`plansV3`, `orders`) — **never** `@wix/site-pricing-plans` (its `startOnlinePurchase` is Wix-site page-code, not headless);
- lists the grid publicly with **`plansV3.queryPlans().eq('visibility','PUBLIC')`**, reads **`plan._id`** and price from **`pricingVariants[].pricingStrategies[].flatRate.amount`** (decimal string) — never a top-level `price` — and only shows a buy button on `buyable` plans;
- treats **subscribe and my-subscription as login-gated** (the hard members dependency), orders with **`orders.createOnlineOrder(planId)`** (no `onBehalf`, no elevate), renders free plans as `ACTIVE` immediately, and drives paid plans through a payment redirect (**exact headless redirect to be confirmed in a live build**) — and **stops at the redirect**: no payments-account connect, no order activation / mark-as-paid from code (see *Out of scope*);
- for the Bookings integration, books a covered service by setting **`selectedPaymentOption: "MEMBERSHIP"`** on `createBooking`, applies the membership on the **ecom checkout** (`membershipOptions`), never calls `confirmBooking`, and falls back to matching the member's active-order `planId`s to the service's coverage when the checkout eligibility field isn't readable client-side.
