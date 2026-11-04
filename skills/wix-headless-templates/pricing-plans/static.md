# Pricing plans on a static site

The pages are HTML files at the root of the site. They import the pricing-plans layer from
`/js/wix/`: the plan reads, the purchase call, the access check, and three stores that hold the
state and the rules. Nothing on the screen ships; every element is yours, in the design of the
site. This file shows how to drive the layer. The skeletons show the calls and the fields and
leave the markup to you.

## The layer

`/js/wix/plans.js`: `fetchPlans()`, `fetchPlanBySlug(slug)` (null when the slug resolves to
nothing), `fetchPlanById(id)`, `fetchPlansByIds(ids)`. A plan summary carries `id`, `slug`,
`name`, `description`, `price` (formatted, "Free" when the plan costs nothing), `free`,
`billing` (the cadence in words, "" for a free plan), `duration` (the validity in words, null
when it runs until canceled), `fees` (each with `name` and `amount`, formatted; `[]` when none),
`freeTrialDays` (null when none), `perks`, `buyable`, `imageUrl` (an https URL at 16:9, "" when
none); the plan detail adds `termsAndConditions` (plain text, render pre-wrapped).
`/js/wix/purchase.js`: `purchasePlan(planId, options)` resolves to the URL of the hosted
checkout; the pages reach it through the purchase store. `/js/wix/plan-access.js`:
`hasActiveOrderFor(planIds)`, a member call; the pages reach it through the access store.

Three stores. `createPlansStore()` in `/js/wix/plans-store.js` is the listing: state `plans`
(null while loading, `[]` when there are none or the load failed) and `error`; `start()` loads.
`createPlanPurchaseStore()` in `/js/wix/plan-purchase-store.js`, one per surface with a button:
state `purchasingId` and `error`; `purchase(planId, { thankYouPageUrl, postFlowUrl })` sets
`purchasingId`, then navigates the whole document to the hosted checkout, or records `error` and
rejects. `createPlanAccessStore({ planIds })` in `/js/wix/plan-access-store.js` is the gate:
state `hasAccess`, `loading`, `error`; `check({ loggedIn, loading })` takes the member session
and reads the member's active orders once per session state; a visitor gets no call and no
access. A store owns the rules; a page reads the state and calls the actions and computes
nothing of its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for every store: create it, subscribe a render function, render once, start where the
store has a `start()`. A store calls the listener on every change and not on subscribe, so the
first render is yours. Controls call the store's actions; delegate from the surface's root and
read what to do from the element, so a re-render of the markup keeps the listeners.

```js
import { createPlansStore } from "/js/wix/plans-store.js";
import { createPlanPurchaseStore } from "/js/wix/plan-purchase-store.js";

var plans = createPlansStore();
var purchase = createPlanPurchaseStore();
function render() {
  var list = plans.getState(), p = purchase.getState();
  // read list.plans, list.error, p.purchasingId, p.error; write your markup into the page
}
plans.subscribe(render);
purchase.subscribe(render);
render();
plans.start();
root.addEventListener("click", function (e) {
  var b = e.target.closest("button[data-plan]");
  if (b) purchase.purchase(b.dataset.plan).catch(function () {});
});
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The plan grid

`plans.html` on `createPlansStore()` and a purchase store. From the state, per plan:

- `name`, `price` with `billing` beside it, `duration` when set, every entry of `fees` right
  under the price, `freeTrialDays` when set, `description`, `perks` in order, `imageUrl` when
  set (no empty image box otherwise), and a link to `plan.html?slug=` + `slug`.
- A free plan reads `price` ("Free") with no cadence.
- The button renders only when `buyable`; a plan that is not buyable shows no button. Its words
  follow `free` ("Get started" or "Subscribe"); while `purchasingId` equals the plan it reads a
  redirecting state and every plan's button is disabled.
- `purchase.purchase(plan.id)` from the button; `error` from the purchase store is one message
  for the grid.
- `plans` null is the loading state, `[]` an honest empty state, `error` a short message.
- A recommended tier may be highlighted when the brief names one.

```js
function render() {
  var list = plans.getState(), p = purchase.getState();
  if (list.plans === null) { gridEl.textContent = "Loading…"; return; }
  if (list.error) { gridEl.textContent = list.error; return; }
  var html = "";
  list.plans.forEach(function (plan) {
    var busy = p.purchasingId === plan.id;
    html += "<article><h3>" + esc(plan.name) + "</h3><p>" + esc(plan.price) + " " + esc(plan.billing) + "</p>";
    plan.fees.forEach(function (f) { html += "<p>" + esc(f.name) + " " + esc(f.amount) + "</p>"; });
    if (plan.buyable) {
      html += '<button type="button" data-plan="' + plan.id + '"' + (p.purchasingId ? " disabled" : "") + ">"
        + (busy ? "Redirecting…" : plan.free ? "Get started" : "Subscribe") + "</button>";
    }
    html += '<a href="/plan.html?slug=' + encodeURIComponent(plan.slug) + '">Details</a></article>';
  });
  if (p.error) html += '<p role="alert">' + esc(p.error) + "</p>";
  gridEl.innerHTML = html;
}
```

`esc` escapes `&`, `<`, `>` and `"` in anything that came from the site.

## The plan page

`plan.html?slug=…` resolves the slug with `fetchPlanBySlug`; null shows only the not-found
state. In the first screen, on a phone too: `name`, `price` with `billing`, the fees, the button.
Fees sit between the price and the button and are never hidden; `perks` and
`termsAndConditions` come after the button. `imageUrl` is a 16:9 band when set. Set
`document.title` and the meta description from `name` and `description` once the plan loads.
The button is the grid's button on a purchase store of its own: `purchase.purchase(plan.id)`.

```js
import { fetchPlanBySlug } from "/js/wix/plans.js";
import { createPlanPurchaseStore } from "/js/wix/plan-purchase-store.js";

var plan = await fetchPlanBySlug(new URLSearchParams(location.search).get("slug"));
var purchase = createPlanPurchaseStore();
function render(p) {
  if (!plan) { root.textContent = "This plan is not available."; return; }
  // name, price and billing, fees, the button from plan.buyable and p.purchasingId, p.error,
  // then perks and termsAndConditions
}
purchase.subscribe(render);
render(purchase.getState());
```

## The purchase

`purchase(planId)` creates the hosted checkout session and leaves the page for it. The hosted
flow handles member login or signup, the order form and payment, then returns. Returning is not
a success: the default return is the current page, reached after a completed, abandoned or
interrupted flow alike. Success arrives only at a `thankYouPageUrl` you pass, with
`?planOrderId=<GUID>` appended. Build `thanks.html` only if it reads that parameter and shows a
real confirmation; otherwise omit the option and Wix shows its own thank-you page.

```js
purchase.purchase(plan.id, { thankYouPageUrl: location.origin + "/thanks.html", postFlowUrl: location.href })
  .catch(function () {});
```

## Gated content

A page for plan holders needs the members layer installed beside this one: its login replaces
the visitor token with the member's, so `hasActiveOrderFor` runs as the member with no extra
wiring. The gate is `createPlanAccessStore({ planIds })` with the ids of the plans that unlock
the page (from the seed output or a slug lookup), fed the session from the member store through
`check`. From the two states: either `loading` renders a placeholder; `loggedIn` false renders a
link to `login.html?returnTo=` + the path; `hasAccess` false renders a link to the plans, with
the access store's `error` when set; `hasAccess` true renders the content, kept out of the page
until then. Without the members layer there is no session and nothing to gate on: do not ship a
gate then.

```js
import { createPlanAccessStore } from "/js/wix/plan-access-store.js";
import { subscribeMember, getMemberState } from "/js/wix/member-store.js";

var access = createPlanAccessStore({ planIds: PLAN_IDS });
function render() {
  var m = getMemberState(), a = access.getState();
  if (m.loading || a.loading) { gatedEl.innerHTML = '<p aria-hidden="true"></p>'; return; }
  if (!m.loggedIn) {
    gatedEl.innerHTML = '<p><a href="/login.html?returnTo=' + encodeURIComponent(location.pathname) + '">Log in</a></p>';
    return;
  }
  if (!a.hasAccess) { gatedEl.innerHTML = '<p><a href="/plans.html">See the plans</a></p>' + (a.error ? "<p>" + esc(a.error) + "</p>" : ""); return; }
  gatedEl.replaceChildren(contentTemplate.content.cloneNode(true));
}
subscribeMember(function (m) { access.check({ loggedIn: m.loggedIn, loading: m.loading }); render(); });
access.subscribe(render);
access.check({ loggedIn: getMemberState().loggedIn, loading: getMemberState().loading });
render();
```

`PLAN_IDS` is the list of plan ids from the seed output; `contentTemplate` is a `<template>`
holding the content for plan holders.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/plans.html`, `/plan.html?slug=…`, `/thanks.html` when it exists, `/login.html` from the
members layer when content is gated. A link to a folder gives the visitor a 404 page. Write the
pages' scripts as files of their own and keep each file small; a page's code travels as text in
the upload call.

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
- Live data or an honest empty state; nothing the merchant did not supply; no Wix ids or
  technical words in visible text.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

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
