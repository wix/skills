# Pricing plans on a static site

The pages are HTML files at the root of the site. They import the pricing-plans modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path: the
modules, the plan grid, the plan page, the purchase, gated content, routes, rules, the owner's
links and the seed.

## The modules

`/js/wix/plans.js`: `fetchPlans()`, `fetchPlanBySlug(slug)`, `fetchPlanById(id)`,
`fetchPlansByIds(ids)`. A plan summary carries `id`, `slug`, `name`, `description`, `price`,
`free`, `billing` (the cadence in words), `duration` (the validity, null when open-ended),
`fees` (`name`, `amount`), `freeTrialDays`, `perks`, `buyable`, `imageUrl`; the plan detail adds
`termsAndConditions`. Every price comes formatted. `/js/wix/purchase.js`: `purchasePlan(planId,
options)` resolves to the URL of the hosted checkout; the pages call it through the purchase
store. `/js/wix/plan-access.js`: `hasActiveOrderFor(planIds)`, a member call; the pages use it
through the access store.

Three stores hold the state and the rules. `createPlansStore()` in `/js/wix/plans-store.js`:
state `plans` (null while loading, an empty array when there are none) and `error`; `start()`
loads. `createPlanPurchaseStore()` in `/js/wix/plan-purchase-store.js`, one per page: state
`purchasingId` and `error`; `purchase(planId, { thankYouPageUrl, postFlowUrl })` sets
`purchasingId`, then navigates the document to the hosted checkout, or records `error`.
`createPlanAccessStore({ planIds })` in `/js/wix/plan-access-store.js`: state `hasAccess`,
`loading`, `error`; `check({ loggedIn, loading })` reads the member's active orders once per
session state. A store calls a listener on every change and not when it subscribes: render once
after subscribing. The visitor token persists in `localStorage` on its own; never mint one in a
page.

## The plan grid

`plans.html` renders every plan as a card: `name`, `price` with `billing` beside it and
`duration` when set, every fee right under the price, `freeTrialDays` when set, `perks`, and
the call to action. A free plan reads "Free" with no cadence. The call to action renders only
for a `buyable` plan; a plan that is not buyable shows no button. The label is "Get started"
for a free plan and "Subscribe" otherwise; while `purchasingId` equals the plan it reads
"Redirecting…" and is disabled. A recommended tier may be highlighted when the brief names one.
`plans` null is the loading state, an empty array an honest empty state, `error` a short message.

```html
<div id="plans"></div>
```

```js
import { createPlansStore } from "/js/wix/plans-store.js";
import { createPlanPurchaseStore } from "/js/wix/plan-purchase-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const plans = createPlansStore();
const purchase = createPlanPurchaseStore();
const grid = document.querySelector("#plans");

grid.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-plan]");
  if (b) purchase.purchase(b.dataset.plan).catch(() => {});
});

export function planCard(p, s) {
  const busy = s.purchasingId === p.id;
  return `<article class="plan${p.free ? " plan--free" : ""}">
    ${p.imageUrl ? `<img src="${p.imageUrl}" alt="" loading="lazy">` : ""}
    <h3>${esc(p.name)}</h3>
    <p class="price">${p.free ? "Free" : `${esc(p.price)} <span class="billing">${esc(p.billing)}</span>`}</p>
    ${p.duration ? `<p class="duration">${esc(p.duration)}</p>` : ""}
    ${p.fees.map((f) => `<p class="fee">${esc(f.name)} ${esc(f.amount)}</p>`).join("")}
    ${p.freeTrialDays ? `<p class="trial">${p.freeTrialDays}-day free trial</p>` : ""}
    ${p.description ? `<p class="description">${esc(p.description)}</p>` : ""}
    <ul class="perks">${p.perks.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
    ${p.buyable ? `<button type="button" class="primary" data-plan="${p.id}" ${busy || s.purchasingId ? "disabled" : ""}>${busy ? "Redirecting…" : p.free ? "Get started" : "Subscribe"}</button>` : ""}
    <a class="details" href="/plan.html?slug=${encodeURIComponent(p.slug)}">Details</a>
  </article>`;
}

function render() {
  const { plans: list, error } = plans.getState();
  const s = purchase.getState();
  if (list === null) { grid.innerHTML = `<p class="loading">Loading plans…</p>`; return; }
  if (error) { grid.innerHTML = `<p class="error" role="alert">${esc(error)}</p>`; return; }
  if (list.length === 0) { grid.innerHTML = `<p class="empty">No plans are on offer right now.</p>`; return; }
  grid.innerHTML = list.map((p) => planCard(p, s)).join("") + (s.error ? `<p class="error" role="alert">${esc(s.error)}</p>` : "");
}
plans.subscribe(render);
purchase.subscribe(render);
render();
plans.start();
```

## The plan page

`plan.html?slug=…` resolves the slug with `fetchPlanBySlug`; null shows only the not-found state.
In the first screen, on a phone too: `name`, `price` with `billing`, the fees, the call to
action. Fees sit between the price and the button and are never hidden; `perks` and
`termsAndConditions` come after the button. A plan without an image renders no empty image box;
the image is a 16:9 band. Set `document.title` and the meta description from `name` and
`description`. The button is the same card button above, on a purchase store of its own:
`purchase.purchase(plan.id)`.

## The purchase

`purchase(planId)` creates the hosted checkout session and leaves the page for it. The hosted flow
handles member login or signup, the order form and payment, then returns. Returning is not a
success: the default return is the current page, reached after a completed, abandoned or
interrupted flow alike. Success arrives only at a `thankYouPageUrl` you pass, with
`?planOrderId=<GUID>` appended. Build `thanks.html` only if it reads that parameter and shows a
real confirmation; otherwise omit the option and Wix shows its own thank-you page.

```js
purchase.purchase(plan.id, { thankYouPageUrl: `${location.origin}/thanks.html`, postFlowUrl: location.href }).catch(() => {});
```

## Gated content

A page for plan holders needs the members modules installed beside these: their login replaces
the visitor token with the member's, so `hasActiveOrderFor` runs as the member with no extra
wiring. The gate is the access store with the ids of the plans that unlock the page (from the seed
output or a slug lookup); `check` takes the session from the member store. A visitor gets the
login link, a member without an active order gets the plans, a member with one gets the content.
Without the members modules there is no session and nothing to gate on: do not ship a gate then.

```html
<div id="gated"><p class="loading">Checking your access…</p></div>
<template id="members-content"><!-- the content for plan holders --></template>
```

```js
import { createPlanAccessStore } from "/js/wix/plan-access-store.js";
import { subscribeMember, getMemberState } from "/js/wix/member-store.js";

const PLAN_IDS = ["<plan id from the seed output>"];
const access = createPlanAccessStore({ planIds: PLAN_IDS });
const gated = document.querySelector("#gated");

function render() {
  const m = getMemberState(), a = access.getState();
  if (m.loading || a.loading) { gated.innerHTML = `<p class="loading">Checking your access…</p>`; return; }
  if (!m.loggedIn) { gated.innerHTML = `<p>Members only. <a href="/login.html?returnTo=${encodeURIComponent(location.pathname)}">Log in</a> to continue.</p>`; return; }
  if (!a.hasAccess) { gated.innerHTML = `<p>This page is for plan holders. <a href="/plans.html">See the plans</a>.</p>${a.error ? `<p class="error">${a.error}</p>` : ""}`; return; }
  gated.replaceChildren(document.querySelector("#members-content").content.cloneNode(true));
}
subscribeMember((m) => { access.check({ loggedIn: m.loggedIn, loading: m.loading }); render(); });
access.subscribe(render);
access.check({ loggedIn: getMemberState().loggedIn, loading: getMemberState().loading });
render();
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/plans.html`, `/plan.html?slug=…`, `/thanks.html` when it exists, `/login.html` from the
members modules when content is gated. A link to a folder gives the visitor a 404 page.

## Rules

- The purchase goes through the purchase store and `purchasePlan`; the hosted session is the
  only checkout. Never create an order yourself.
- Purchasing is for members, and the hosted flow handles that; no login gate in front of the
  button.
- Returning from checkout is not a success; success is `?planOrderId=` on the thank-you page.
- Prices, cadence, duration and fees are display strings; no totals, discounts or proration
  computed on the page. Fees show with the price, never summed into it, never hidden.
- Access is the access store's answer: an active order for one of the plans, read for the
  logged-in member. Never inferred from `loggedIn` alone, a return URL or anything stored on the
  page.
- The button renders only for a `buyable` plan.
- Live data or an honest empty state; nothing the merchant did not supply.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `pricing-plans` (the plans, with
purchases as a tab), `pricing-plans/new`, `pricing-plans/new-order`, `pricing-plans/settings`,
`wix-cashier/payments` (connect a payment method); the plan upgrade is
`https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Real payments need a connected payment
method and a premium plan; until then hosted checkout tells the visitor the store cannot accept
online payments yet. Give both links in the close.

## Seeding

Per `seed/SEED.md` and `seed/seed-pricing-plans.mjs`: a plain-data plan, run in the script's
order with its waits. Seed a tier ladder that exercises the pages (a free tier, a monthly with
`freeTrialDays`, a yearly or one-time, three or four perks each) unless the brief says otherwise.
The seed output carries the plan ids a gated page needs.
