# Donations on a static site

The pages are HTML files at the root of the site. They import the donations layer from
`/js/wix/`: the campaign reads, the donation flow, and three stores that hold the state and the
rules of giving. Nothing on the screen ships; every element is yours, in the design of the site.
This file shows how to drive the layer. The skeletons show the calls and the fields and leave the
markup to you.

## The layer

`/js/wix/campaigns.js`: `fetchCampaigns({ limit })` (summaries, up to 100), `fetchCampaign(id)`
(the detail with its donation options; null when the id resolves to nothing),
`fetchDefaultCampaign()`. `/js/wix/donate.js` holds `donationCheckoutUrl` and
`fetchDonationReceipt`; the pages reach them through the stores.

Three stores: `createCampaignsStore({ initialCampaigns })` in `/js/wix/campaigns-store.js` for
the index, `createDonationStore(campaign, { paths })` in `/js/wix/donation-store.js` for one
campaign's donate flow, and `createReceiptStore(orderId)` in `/js/wix/receipt-store.js` for the
thank-you page. The donation store owns the rules: which amount is in play, the fee and the total,
the button's label, validation and its messages, the hosted checkout and its redirect. A page
reads the state and calls the actions; it computes nothing of its own. Amounts come formatted:
`goal.raised`, `goal.target`, each preset's `label`, the store's `feeLabel`, `totalLabel` and
`buttonLabel`, `receipt.amount`.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for every store: create it, subscribe a render function, render once, start where the
store has a `start()`. A store calls the listener on every change and not on subscribe, so the
first render is yours. Controls call the store's actions; delegate from the surface's root and
read what to do from the element, so a re-render keeps the listeners.

```js
import { createCampaignsStore } from "/js/wix/campaigns-store.js";

var store = createCampaignsStore();
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The campaigns index

`donate.html` on `createCampaignsStore()`. The state: `campaigns` (null while the first load is
in flight: a loading state, not an empty one) and `error`. A campaign summary carries `id`,
`name`, `status` ("collecting", "goalReached", "expired"), `acceptsDonations`, `imageUrl` ("" when
none) and `goal` (null when the campaign has none). A card shows the cover when present, the
name, the goal block, and a link to the campaign page that reads "Donate" when `acceptsDonations`,
else "Goal reached" or "Ended" by `status`.

```js
function render(s) {
  if (s.campaigns === null) { grid.textContent = "Loading…"; return; }
  if (s.error && !s.campaigns.length) { grid.textContent = s.error; return; }
  var html = "";
  s.campaigns.forEach(function (c) {
    html += '<article><h3>' + esc(c.name) + "</h3>" + goalBlock(c.goal)
      + '<a href="/campaign.html?id=' + encodeURIComponent(c.id) + '">'
      + (c.acceptsDonations ? "Donate" : c.status === "goalReached" ? "Goal reached" : "Ended") + "</a></article>";
  });
  grid.innerHTML = html || "No campaigns yet.";
}
```

`esc` escapes `&`, `<`, `>` and `"` in anything that came from the API.

## The goal block

`campaign.goal` is the whole input; a campaign without a goal shows no block. The fields:
`raised` and `target` (formatted money), `percent` (Wix's rounding, may pass 100: cap the bar's
width at 100 and show the number as it is), `donationCount`, `reached`, and the deadline:
`endDate` (null when none), `ended`, `lastDay`, `daysLeft`, `hoursLeft`. The time left reads
nothing without `endDate`, "Ended" when `ended`, the hours on the `lastDay`, else the days. The
bar is a track and a fill; the fill carries the width, the stylesheet gives both a height and a
background. The numbers `raisedAmount` and `targetAmount` serve `aria-valuenow` and
`aria-valuemax`, never the visible text.

```js
function goalBlock(g) {
  if (!g) return "";
  var left = !g.endDate ? "" : g.ended ? "Ended" : g.lastDay ? g.hoursLeft + " hours left" : g.daysLeft + " days left";
  return '<p>' + esc(g.raised) + " raised of " + esc(g.target) + "</p>"
    + '<div role="progressbar" aria-valuenow="' + g.raisedAmount + '" aria-valuemax="' + g.targetAmount + '">'
    + '<div style="width:' + Math.min(100, g.percent) + '%"></div></div>'
    + "<p>" + g.percent + "% · " + g.donationCount + " donations" + (left ? " · " + left : "") + "</p>";
}
```

## The campaign page

`campaign.html?id=…` reads the id and calls `fetchCampaign`. Null is the not-found state, with
nothing else on the page. Otherwise the page shows the cover, `name`, the story, the goal block
and the donate flow, and sets `document.title` from `name`. The story is the site's own copy,
written from the brief: the campaign entity carries no description.

The donate flow is `createDonationStore(campaign, { paths })`. `paths` names where the hosted
checkout returns: `thankYou` on success (Wix appends `?orderId=`) and `campaign` on abandon,
both files of this site. The store has no `start()`.

`campaign.options` decides which controls exist, so a dashboard edit reaches the page on the next
load:

- `frequencies` (`value`, `label`): a picker only when there is more than one; the first is the
  default. `setFrequency(value)`.
- `presets` (`amount`, `label`, `impact`): one choice per preset with its label and impact text;
  the first is the default. `selectPreset(amount)`. The chosen one is the state's `presetAmount`
  while `customMode` is false.
- `customAmount.enabled`: an "Other amount" choice that calls `selectCustom()`, and a text field
  calling `setCustomAmount(text)` on input, shown while `customMode`; `minLabel` and `maxLabel`
  give the limits for the placeholder or a help line. `currency` names the unit.
- `askCoverFee`: a checkbox calling `setCoverFee(checked)`, labelled with the state's `feeLabel`
  once an amount is in play.
- `commentsEnabled`: a note field calling `setNote(text)`, with `commentMaxLength` as its limit and
  a counter from `note.length`.
- The submit reads `buttonLabel` ("Donate $25 Monthly"), "Redirecting…" while `submitting`, and
  calls `donate()`.

From the state: `amount`, `fee`, `total`, `totalLabel` for a summary line; `valid`; `showErrors`
turns true after the first `donate()`, and only then do `messages` show, each under its field
(`amount`, `customAmount`, `frequency`, `note`), the field marked `aria-invalid`. `error` is the
last checkout failure, shown by the submit. `available` is `campaign.acceptsDonations`; when false,
the page shows a closed message in place of the controls and nothing else of the flow.
`donate()` validates, then starts the hosted checkout; when it resolves the browser is leaving, or
`messages` are showing. It rejects, with `error` set, when the checkout could not start.

```js
import { createDonationStore } from "/js/wix/donation-store.js";

var store = createDonationStore(campaign, { paths: { thankYou: "/thank-you.html", campaign: "/campaign.html?id=" + encodeURIComponent(campaign.id) } });
form.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.frequency) store.setFrequency(b.dataset.frequency);
  else if (b.dataset.preset) store.selectPreset(Number(b.dataset.preset));
  else if ("custom" in b.dataset) store.selectCustom();
  else if ("donate" in b.dataset) store.donate().catch(function () {});
});
form.addEventListener("input", function (e) {
  if (e.target.name === "customAmount") store.setCustomAmount(e.target.value);
  else if (e.target.name === "note") store.setNote(e.target.value);
  else if (e.target.name === "coverFee") store.setCoverFee(e.target.checked);
});
function render(s) {
  if (!s.available) { form.textContent = "This campaign is no longer accepting donations."; return; }
  // your controls from campaign.options, selected from s.frequency, s.presetAmount, s.customMode;
  // the submit reads s.buttonLabel or "Redirecting…"; s.showErrors && s.messages[field] under a field
}
store.subscribe(render);
render(store.getState());
```

Rebuild the text of a field only when its value changed and it does not hold the focus, so typing
in the custom amount or the note keeps the caret.

## The thank-you page

`thank-you.html` is where the hosted checkout returns after a payment, with `?orderId=` appended.
`createReceiptStore(orderId)` with the id from the URL; the state: `orderId` ("" on a direct
visit), `loading`, `receipt` (null when there was no id or the order could not be read). A receipt
carries `orderNumber`, `donorFirstName`, `donorLastName`, `amount` (formatted) and `paid`
(anything else reads as pending, never "paid"). Three states: loading, a receipt with its facts,
and a plain thank-you without order facts. The page never invents an amount, a name or a payment.

```js
import { createReceiptStore } from "/js/wix/receipt-store.js";

var store = createReceiptStore(new URLSearchParams(location.search).get("orderId") || "");
store.subscribe(function (s) {
  if (s.loading) { box.textContent = "One moment…"; return; }
  var r = s.receipt;
  box.innerHTML = r
    ? "<h1>Thank you" + (r.donorFirstName ? ", " + esc(r.donorFirstName) : "") + ".</h1><p>Your " + (r.paid ? "donation" : "pledge") + " of " + esc(r.amount) + " is order " + esc(r.orderNumber) + ".</p>"
    : "<h1>Thank you for your gift.</h1><p>A receipt is on its way to your email.</p>";
});
store.start();
```

## The home page

The hero, a featured campaign strip and the brand story. The strip takes
`fetchCampaigns({ limit: 1 })` or `fetchDefaultCampaign()`: the name, the goal block, and a link
to the campaign page.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/donate.html`, `/campaign.html?id=…`, `/thank-you.html`. A link to a folder gives the visitor a 404
page. Every page declares its charset in the head; the host sends none. The `paths` given to the
donation store point at these files, so the hosted checkout returns to them. Keep each page's script
small; a page's code travels as text in the upload call.

## Rules

- Donating goes through the donation store: it owns the checkout line and the hosted redirect.
  The page never builds a checkout URL, creates an order or marks anything paid.
- The controls follow `campaign.options` and the closed state follows `available`; the page
  decides neither.
- Amounts are display-only, as the layer formats them. Progress renders only from `goal`; a
  campaign without one shows none.
- The thank-you page reads the order when it can and shows a plain thank-you otherwise.
- The story copy is the site's; the campaign data is the API's. No fabricated figures,
  beneficiaries or urgency; live data or an honest empty state.
- Browsing and donating need no login; the visitor session is already there.
- Render form inputs once; a render touches their values, the button and the error, not the inputs.
- Every control on the page has a rule in the stylesheet; the submit is the one primary action,
  the presets and frequencies are chips with a selected state, the rest compact.

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
