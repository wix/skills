# Donations on a static site

The pages are HTML files at the root of the site. They import the donations modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path: the
modules, the shipped donate form and goal block, the campaign pages, the rules and the seed.

## The modules

`/js/wix/campaigns.js`: `fetchCampaigns({ limit })` (summaries, up to 100), `fetchCampaign(id)`
(the detail with its donation options, null when the id resolves to nothing),
`fetchDefaultCampaign()`. `/js/wix/donate.js` holds the donation flow, `donationCheckoutUrl` and
`fetchDonationReceipt`; the pages reach it through the store and the form, never directly.
Three stores hold the state: `createCampaignsStore({ initialCampaigns })` in
`/js/wix/campaigns-store.js` (state `campaigns`, null while loading, and `error`; `start()`,
`stop()`), `createDonationStore(campaign, { paths })` in `/js/wix/donation-store.js` (the form's
state, driven by the shipped renderer), and `createReceiptStore(orderId)` in
`/js/wix/receipt-store.js` (state `orderId`, `loading`, `receipt`; `start()`, `stop()`). Each `.js`
opens with its declarations. A store calls a listener on every change and not when it subscribes:
render once after subscribing. The visitor token persists in `localStorage` on its own; never mint
one in a page.

Amounts come formatted: `goal.raised`, `goal.target`, `receipt.amount`, each preset's `label`. The
only computed money is the form's fee preview and button total, and the form computes them.

## The shipped form and goal block

Two renderers ship for this solution, and the page renders them as they are. They decide which
controls appear from the campaign's options at load time, so a dashboard edit reaches the page on
the next load.

`renderDonateForm(root, campaign, { paths, closedMessage })` from `/js/wix/donate-form.js` renders
the donate form of one campaign into `root` and returns `{ store, destroy }`. The controls, each
present only when the campaign has the setting: a frequency picker when `options.frequencies` has
more than one entry, one choice per preset with its impact text, "Other amount" with a text input
when `options.customAmount.enabled`, the cover-fee checkbox when `options.askCoverFee`, a note with
a counter when `options.commentsEnabled`, and the submit button labelled from the store
("Donate $25 Monthly"). When `campaign.acceptsDonations` is false it renders `closedMessage`
instead. `paths` sets where the hosted checkout returns: `thankYou` on success (Wix appends
`?orderId=`) and `campaign` on abandon. `mountDonateForm(root, campaignId, options)` fetches the
campaign first and resolves with the same object, or null when the campaign is not found.

`renderGoalProgress(root, campaign.goal, { compact })` from `/js/wix/goal-progress.js` renders
raised of target, a bar at `percent` (the width capped at 100), the donation count and the time
left; it renders nothing when `goal` is null. `timeLeftLabel(goal)` gives the time-left text on
its own.

The renderers set no styles. The form's classes use the prefix `donate`: `donate-form`,
`donate-fieldset`, `donate-legend`, `donate-choices`, `donate-choice`, `donate-choice--selected`,
`donate-radio`, `donate-choice-label`, `donate-choice-impact`, `donate-custom`,
`donate-custom-label`, `donate-custom-field`, `donate-currency`, `donate-input`, `donate-help`,
`donate-error`, `donate-fee`, `donate-fee-label`, `donate-checkbox`, `donate-note`,
`donate-note-label`, `donate-optional`, `donate-textarea`, `donate-counter`, `donate-actions`,
`donate-submit`, `donate-secure`, `donate-closed`; the `<form>` carries `data-state` ("open",
"closed", "submitting"). The goal block's classes use the prefix `goal`: `goal`, `goal-figures`,
`goal-amounts`, `goal-raised`, `goal-target`, `goal-percent`, `goal-bar`, `goal-bar-fill`,
`goal-meta`, `goal-count`, `goal-time-left`.

To style, in the page's stylesheet on the same tokens as the rest of the page:
`donate-submit` is the one primary button. The presets and frequencies are chips;
`donate-choice--selected` (also `aria-pressed="true"`) is the chosen one, and the radio inside
each choice, `donate-radio`, can be visually hidden when the label carries the look. An input with
an error has `aria-invalid="true"` with the text in `donate-error` under it, both hidden until they
apply. `donate-submit[disabled]` with `aria-busy="true"` is the button while submitting;
`donate-secure` is the line under it. `goal-bar` is the track and `goal-bar-fill` the fill: the
fill has only its width, so give both a height and a background. Scope the rules to these classes.

## The campaigns index

`donate.html` lists the campaigns on `createCampaignsStore()`: one render function that reads
`getState()`, called from `subscribe`, then `start()`. A card shows `imageUrl` (when not ""),
`name`, the goal block in its compact form, and a link to the campaign page. A campaign whose
`status` is "goalReached" or "expired", or whose `acceptsDonations` is false, reads "Goal reached"
or "Ended" instead of "Donate".

```html
<div id="campaigns" class="campaign-grid"><p class="campaign-loading">Loading…</p></div>
```

```js
import { createCampaignsStore } from "/js/wix/campaigns-store.js";
import { renderGoalProgress } from "/js/wix/goal-progress.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const grid = document.querySelector("#campaigns");
const campaignUrl = (c) => `/campaign.html?id=${encodeURIComponent(c.id)}`;
const store = createCampaignsStore();

function renderIndex(s) {
  if (s.campaigns === null) { grid.innerHTML = `<p class="campaign-loading">Loading…</p>`; return; }
  if (s.error && s.campaigns.length === 0) { grid.innerHTML = `<p class="campaign-error" role="alert">${esc(s.error)}</p>`; return; }
  if (s.campaigns.length === 0) { grid.innerHTML = `<p class="campaign-empty">No campaigns yet.</p>`; return; }
  grid.innerHTML = s.campaigns.map((c) => `
    <article class="campaign-card" data-status="${c.status}">
      ${c.imageUrl ? `<img class="campaign-cover" src="${c.imageUrl}" alt="">` : ""}
      <h3 class="campaign-name">${esc(c.name)}</h3>
      <div class="campaign-goal" data-id="${c.id}"></div>
      <a class="campaign-link" href="${campaignUrl(c)}">${c.acceptsDonations ? "Donate" : c.status === "goalReached" ? "Goal reached" : "Ended"}</a>
    </article>`).join("");
  for (const c of s.campaigns) renderGoalProgress(grid.querySelector(`.campaign-goal[data-id="${c.id}"]`), c.goal, { compact: true });
}
store.subscribe(renderIndex);
renderIndex(store.getState());
store.start();
```

## The campaign page

`campaign.html?id=…` reads the id, calls `fetchCampaign`, and renders its not-found state when
the result is null, with nothing else on the page. Otherwise it shows the cover, `name`, the
story, the goal block and the form. The story is the site's own copy, written from the brief: the
campaign entity carries no description. `document.title` is set from `name`.

```html
<article id="campaign" hidden>
  <img class="campaign-cover" alt="" hidden>
  <h1 class="campaign-name"></h1>
  <div class="campaign-goal"></div>
  <section class="campaign-story"></section>
  <div class="campaign-form"></div>
</article>
<p id="campaign-missing" hidden>This campaign is not available.</p>
```

```js
import { fetchCampaign } from "/js/wix/campaigns.js";
import { renderDonateForm } from "/js/wix/donate-form.js";
import { renderGoalProgress } from "/js/wix/goal-progress.js";

const id = new URLSearchParams(location.search).get("id") ?? "";
const page = document.querySelector("#campaign");
const campaign = id ? await fetchCampaign(id) : null;
if (!campaign) {
  document.querySelector("#campaign-missing").hidden = false;
} else {
  document.title = campaign.name;
  const cover = page.querySelector(".campaign-cover");
  if (campaign.imageUrl) { cover.src = campaign.imageUrl; cover.hidden = false; }
  page.querySelector(".campaign-name").textContent = campaign.name;
  renderGoalProgress(page.querySelector(".campaign-goal"), campaign.goal);
  // The story is the page's own copy, written for this cause.
  page.querySelector(".campaign-story").innerHTML = `<p>Every gift goes to the work this campaign exists for.</p>`;
  renderDonateForm(page.querySelector(".campaign-form"), campaign, {
    paths: { thankYou: "/thank-you.html", campaign: `/campaign.html?id=${encodeURIComponent(id)}` },
    closedMessage: "This campaign is no longer accepting donations.",
  });
  page.hidden = false;
}
```

## The thank-you page

`thank-you.html` is where the hosted checkout returns after a payment, with `?orderId=` appended.
The page reads the order on `createReceiptStore(orderId)` and has three states: loading, a
receipt with `orderNumber`, `donorFirstName`, `amount` and `paid`, and a thank-you without order
facts when `orderId` is "" or the read returns null. A visitor who abandons the checkout returns to
the campaign page, so this page is reached only on the success redirect; even so, it never invents
an amount, a name or "paid".

```html
<section id="thanks"><p>Thank you.</p></section>
```

```js
import { createReceiptStore } from "/js/wix/receipt-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const box = document.querySelector("#thanks");
const store = createReceiptStore(new URLSearchParams(location.search).get("orderId") ?? "");

function renderThanks(s) {
  if (s.loading) { box.innerHTML = `<p>One moment…</p>`; return; }
  const r = s.receipt;
  if (!r) { box.innerHTML = `<h1>Thank you for your gift.</h1><p>A receipt is on its way to your email.</p>`; return; }
  box.innerHTML = `
    <h1>Thank you${r.donorFirstName ? `, ${esc(r.donorFirstName)}` : ""}.</h1>
    <p>Your ${r.paid ? "donation" : "pledge"} of ${esc(r.amount)} is order ${esc(r.orderNumber)}.</p>`;
}
store.subscribe(renderThanks);
renderThanks(store.getState());
store.start();
```

## The home page

The hero, a featured campaign strip and the brand story. The strip takes
`fetchCampaigns({ limit: 1 })`: the name, the goal block, and a link to the campaign page.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/donate.html`, `/campaign.html?id=…`, `/thank-you.html`. A link to a folder gives the visitor a
404 page. The `paths` given to the form point at these files, so the hosted checkout returns to
them.

## Rules

- Donating goes through the shipped form and the stores; they own the checkout line and the hosted
  redirect. The page never builds a checkout URL, creates an order or marks anything paid.
- The thank-you page reads the order when it can and shows a plain thank-you otherwise.
- Amounts are display-only, as the modules format them. Progress renders only from `goal`; a
  campaign without one shows none.
- The form is the shipped renderer; it alone decides which controls appear and when a campaign
  is closed.
- The story copy is the site's; the campaign data is the API's. No fabricated figures,
  beneficiaries or urgency; live data or an honest empty state.
- Browsing and donating need no login; the visitor session is already there.

## Verify before the close

Follow the anonymous smoke test in the published recipe
`https://www.wix.com/skills/wix-headless/references/inline-recipes/how-to-code-donations.md`
(section 5): a campaign read, one cart, calculated totals, a redirect session, on one visitor. A
session URL is proof of the handoff, not of a payment. Report the API check, the hosted checkout
and the payment separately.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `app/333b456e-dd48-4d6b-b32b-9fd48d74e163`
(campaigns and settings), `ecom-platform/orders-list` (every donation is an order),
`wix-cashier/payments` (connect a payment method); the plan upgrade is
`https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Real donations need a connected payment
method and a payments-capable plan; recurring frequencies also need a provider that supports
recurring payments. Until then the hosted checkout tells the visitor the site cannot accept
payments yet. Give the links in the close.

## Seeding

Per `seed/SEED.md` and `seed/seed-donations.mjs`: a plain-data plan, run in the script's order
with its waits. It installs what the site needs, creates the campaigns, verifies each reads back
and attaches a cover image to each. Seed one approved cause unless the brief names several; the
amounts, the custom-giving rules and the recurring settings are the owner's choices, and a goal or
deadline appears only when the brief gives one. Read what the site already holds first; a campaign
that was there before the seed is named in the close with the dashboard link, and nothing on the
site is deleted.
