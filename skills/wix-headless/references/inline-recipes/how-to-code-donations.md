---
name: "How to Code Donations"
description: Read Wix Donations campaigns and accept one-time or recurring donations through Cart V2 and a Headless redirect session. Covers numeric cart amounts, omitted one-time frequency, donor selections, misleading catalog errors and staged verification; does not create campaigns or prescribe hosting.
---
# Accept a donation on a Headless site

Use existing Wix Donations campaigns; setup/editing belongs to
[the management recipe](../../../wix-manage/references/donations/create-and-update-donation-campaigns.md).
Read the [donor-experience guidance](experience-donations.md) when building
the UI. Resolve sibling links locally when installed; otherwise read the same repository path under
`https://www.wix.com/skills/`. This contract is independent of framework and hosting.

## 1. Read the campaign as the donor will

Use one visitor identity per browser session; reuse the existing auth/transport. A public OAuth client
ID is not a secret; API keys, app secrets and owner tokens never belong in the browser. Confirm the
client targets the supplied content site. Do not require donor login or provision a replacement site.

| Need | REST call and minimal body | SDK equivalent |
| --- | --- | --- |
| Discover campaigns | `POST https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/query` · `{ "query": { "filter": { "archived": false }, "cursorPaging": { "limit": 100 } } }` | `donationCampaigns.queryDonationCampaigns().eq('archived', false).limit(100).find()` |
| Campaign detail | `GET https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/<ID>` | `donationCampaigns.getDonationCampaign(id)` |
| Goal metrics, only with a goal and permitted access | `GET https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/<ID>/metrics` | `donationCampaigns.getDonationCampaignMetrics(id)` |

REST returns `donationCampaigns` / `donationCampaign`; SDK queries return `items`, SDK entities use
`_id`. Continue query paging with the returned cursor. Resolve detail routes from live IDs, not a
seed-time list; missing/archived campaigns are unavailable, not a fallback to the first campaign.
Offer giving only when `status === 'COLLECTING'` and not archived. Reaching a goal does not close a
campaign if it allows further donations. A refused query is an error, not an empty campaign list.

Render from `donationFrequencies`, `predefinedDonationAmounts[].price` and `.description`,
`customAmountEnabled` / `customAmountOptions`, `commentsEnabled`, `askDonorCoverFee`, and optional
`campaignGoal`. Currency is the site's default; use formatted API values or a verified currency code,
never assume USD. A metrics failure must not invent a raised total, donor count or currency.
Campaign story copy is site-authored; the entity has no story or slug.

Carry an explicitly chosen giving frequency through discovery and campaign links to the form, but
only when that campaign offers it. Retain later donor edits. Keep a short-lived, site/visitor/campaign-
scoped draft (preset/custom amount, cadence, fee, note) across refresh and checkout abandonment; notes
never belong in query strings or logs. Restore and revalidate against live settings before allowing
checkout. Do not clear the draft merely because a return URL was visited; see the shared experience
reference for recovery and accessible form requirements. This is UI state, not an extra Wix API.

Docs: [query](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/query-donation-campaigns),
[get](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/get-donation-campaign),
[metrics and permissions](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/get-donation-campaign-metrics).
For SDK shapes read their `.md?apiView=SDK` views. Modules: `donationCampaigns` from `@wix/donations`,
`cartV2` from `@wix/ecom`, `redirects` from `@wix/redirects`, on the project's existing SDK client or
ambient auth. REST-only projects do not install an SDK just for this flow.

## 2. Build the catalog reference correctly

**Campaign prices are decimal strings; cart `options.amount` must be a JSON number.** Convert and
validate before the request. `ONE_TIME` belongs to the campaign/UI enum; **omit `frequency` from
the cart options for one-time giving**. Only `WEEK`, `MONTH`, `YEAR` are recurring cart values.

```js
const amount = Number(selectedAmount);
if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive donation amount.');
// Before this: validate against the selected campaign's presets/custom limits and offered frequency.
const catalogItems = [{
  quantity: 1,
  catalogReference: {
    appId: '333b456e-dd48-4d6b-b32b-9fd48d74e163',
    catalogItemId: campaignId,
    options: {
      amount,
      ...(frequency !== 'ONE_TIME' ? { frequency } : {}),
      ...(askDonorCoverFee && donorOptedIn ? { donorCoveringFees: true } : {}),
    },
  },
}];
```

Validate a nonempty amount first: `Number('')` is zero, not a donor selection. Honor the campaign's
allowed choices. Put an enabled donor message in `cart.note` (Cart V2 limit 1,000 characters), not
invented catalog options. Fee coverage adds the documented 2.9% **through the flag**; send the base
donation amount, not a locally inflated amount plus the flag. Recurring coverage applies per charge.
Do not create custom-priced items to bypass campaign rules.
[Donation catalog-reference contract](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/e-commerce-integration-with-donation-campaigns).

## 3. Create a fresh Cart V2, then a redirect session

Use the same visitor identity throughout. Keep this separate from the shopper's current merchandise
cart. New Cart V2 flows have **no separate Create Checkout call**; the returned cart ID is the ID
handed to `ecomCheckout.checkoutId`. Do not mix in the V1 create-checkout-from-cart step.
[Cart V2 migration](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/migration-guide).

| Step | REST request | Result |
| --- | --- | --- |
| Create cart | `POST https://www.wixapis.com/ecom/v2/carts` · `{ "cart": { "source": { "channelType": "WEB" } }, "catalogItems": [...] }` (the numeric reference above; optional `cart.note`) | `cart.id` |
| Inspect calculated totals during verification | `POST https://www.wixapis.com/ecom/v2/carts/<CART_ID>/calculate` · `{}` | `cart` and `summary`; inspect the donation line, currency, calculated amounts and issues |
| Create redirect session | `POST https://www.wixapis.com/_api/redirects-api/v1/redirect-session` · `{ "ecomCheckout": { "checkoutId": "<CART_ID>" }, "callbacks": { "postFlowUrl": "<ORIGIN>/donate/<ID>", "thankYouPageUrl": "<ORIGIN>/donate/thank-you" } }` | `redirectSession.fullUrl` |

SDK: `cartV2.createCart({ cart: { source: { channelType: 'WEB' }, ...(note ? { note } : {}) }, catalogItems })`
returns a cart with `_id`; pass it to `redirects.createRedirectSession` with the same body as above.
Navigate the **full document** to the exact returned URL (`window.location.assign(fullUrl)`), not an
SPA router, iframe, guessed checkout URL or manually created order.

Use actual, reachable callback routes on the deployed origin; the external origin must be allowed
on the OAuth client. `postFlowUrl` is also used on abandonment: it is not a paid signal. A success
callback may carry `orderId`; confirm order/payment state through an authorized read before stating
that a donation was paid. Never grant owner access just to populate a public thank-you page.

Docs: [create cart](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart),
[calculate](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/calculate-cart),
[redirect session](https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session).
On a Kit build, call its shipped `donationCheckoutUrl` / form instead of rebuilding this sequence.

## 4. Diagnose the failed stage, not a guessed cause

- `ITEM_NOT_FOUND_IN_CATALOG`: first inspect the exact donation app ID, campaign ID, **numeric**
  `options.amount`, and one-time frequency omission. Check the campaign on the same site/identity.
  The error alone is not proof of a missing campaign, a missing app, or a premium requirement.
- Keep status, application error code/body and failing stage available to the developer, with tokens,
  checkout-session URLs and donor data redacted. Give the donor a recoverable inline message. Never
  replace every error with an unexplained generic failure or convert failures to empty/success states.
- Keep the form disabled while creating the cart/session. Do not run both add-to-current-cart and
  donate handlers on the same action. Do not silently retry cart creation after a timeout or redirect
  failure; inspect/reuse the known cart when possible rather than duplicating the action.
- Distinguish API handoff from payment acceptance. Cart/session creation can succeed before live
  payments are enabled. A payments-capable plan and connected, eligible provider are separate
  go-live checks; recurring donations also need recurring support. Do not hardcode either “premium
  is never required” or “every checkout error means upgrade”.
  [Payment setup](https://support.wix.com/en/article/wix-donations-adding-and-setting-up-wix-donations).

## 5. Verify before handoff

For a build accepting donations, run a bounded API smoke test with an **anonymous visitor token**,
not the owner's token: read a real campaign → create a cart with one numeric donation line → calculate
and inspect it → create the redirect session. Use the exact requests above with `curl --fail-with-body`,
`Authorization: <VISITOR_TOKEN>` and `Content-Type: application/json`; mint that identity, when needed,
with `POST https://www.wixapis.com/oauth2/token`, body
`{ "clientId": "<PUBLIC_CLIENT_ID>", "grantType": "anonymous" }` → `access_token` / `refresh_token`.
Confirm permission for this test before creating its cart; do not seed or mutate campaigns to make
the test pass. Stop at the failing stage and preserve the sanitized response; never loop blind retries.

Check one-time and an offered recurring selection, custom bounds and correction, fee on/off when
offered, and notes when enabled. Local/mocked checks do not prove live API permissions. In a browser,
check discovery and form first screens at desktop, 390px and 320px widths, plus keyboard/error behavior.
Follow a monthly entry through cause selection; confirm its cadence, then cancel/back from checkout
and refresh to verify the donor's choices survive without implying payment. Confirm hosted checkout
shows the intended cause, amount, currency and cadence; a resized desktop viewport alone does not
verify the mobile checkout. **Do not submit a payment** without
explicit authorization for that transaction and amount. Handoff states which levels passed (API,
hosted checkout, payment/return), what was blocked, and which setup remains; no mandatory report file.
