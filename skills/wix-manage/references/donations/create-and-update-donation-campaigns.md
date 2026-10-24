---
name: "Create and Update Donation Campaigns"
description: Create, inspect, update and archive Wix Donations campaigns, including suggested amounts and impact text, custom limits, giving frequencies, goals, donor notes, fee coverage and imagery.
---
# Create and update Wix Donations campaigns

This is owner-side configuration, not a donation form or a payment API. Confirm the target site and
proposed changes before writing; an explicit request on the selected site is approval for those
changes, not for unrelated configuration. Ask when the target or change is ambiguous.
Reuse existing campaigns when the request is to build
over existing content; do not reseed, change site currency, or invent fundraising claims.

## 1. Check prerequisites and read current state

Use an owner-authorized identity with **Manage Donation Campaigns**, never a browser visitor token.
Keep credentials server-side. `<AUTH>` below is the Authorization header value supplied by the host;
include `wix-site-id: <SITE_ID>` when that authentication mechanism requires site selection.

Check [installed apps](../app-installation/list-installed-apps.md) before
[installing](../app-installation/install-wix-apps.md) Wix Donations
(`333b456e-dd48-4d6b-b32b-9fd48d74e163`) and its eCommerce checkout dependency
(`1380b703-ce81-ff05-f115-39571d94dfcd`). Do not reinstall apps to diagnose an amount-type error.

[Query campaigns](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/query-donation-campaigns):

```bash
curl -sS --fail-with-body -X POST \
  'https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/query' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{"query":{"filter":{"archived":false},"cursorPaging":{"limit":100}}}'
```

Read `donationCampaigns` and `pagingMetadata`; follow `pagingMetadata.cursors.next` when present.
If several campaigns plausibly match, **stop and ask the user which campaign to change**, naming the
matching campaigns in the question. Listing matches without a question is not clarification. Do not
prepare or perform mutations, including app installation, while the target is unresolved; resume with
the chosen campaign only after the user answers. A failed read is not an empty site and must not
trigger a replacement campaign.

## 2. Create only the campaigns requested

[Create campaign](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/create-donation-campaign):

```bash
curl -sS --fail-with-body -X POST \
  'https://www.wixapis.com/donation-campaigns/v2/donation-campaigns' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{"donationCampaign":{
    "name":"Community support",
    "donationFrequencies":["ONE_TIME","MONTH"],
    "predefinedDonationAmounts":[
      {"id":"<GENERATE_PRESET_UUID>","price":{"amount":"25.00"}}
    ],
    "customAmountEnabled":true,
    "customAmountOptions":{"minimum":{"amount":"5.00"}},
    "commentsEnabled":false,
    "askDonorCoverFee":false
  }}'
```

Generate a fresh UUID for each new preset; do not reuse the placeholder. Take the returned
`donationCampaign.id`, then **GET that campaign using the request in §3**. Compare the saved amounts,
preset IDs, frequencies and enabled settings against the request before reporting completion.
The create response alone is not this verification read. If a create times out, query before retrying
it to avoid duplicate campaigns.

| Setting | Contract |
| --- | --- |
| `name` | 1–65 characters; identifies the cause at checkout too. |
| `donationFrequencies` | At least one of `ONE_TIME`, `WEEK`, `MONTH`, `YEAR`. Offer recurring giving only when intended, not as a Pricing Plans substitute. |
| `predefinedDonationAmounts` | Up to 20 unique positive amounts; each entry needs an `id` UUID and `price.amount` as a **decimal string**. Its optional `description` is impact text, ≤200 characters, supplied or approved by the organization. |
| `customAmountEnabled` | When false, at least one preset is required. A custom-only campaign is valid. |
| `customAmountOptions` | Optional `minimum` / `maximum`, each `{ "amount": "5.00" }`; maximum must exceed minimum. Limits do not come from the smallest/largest preset. |
| `campaignGoal` | Optional; requires `targetAmount: { "amount": "20000" }`. Optional ISO `endDate`, `acceptDonationsAfterGoal` (default true), `acceptDonationsAfterEndDate` (default false). Do not invent a target or deadline. |
| `commentsEnabled` | Enables a donor note; does not configure tribute notifications or restricted-fund allocation. |
| `askDonorCoverFee` | Offers optional 2.9% fee coverage, as specified by the [campaign object's fee field](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/donation-campaign-object). It applies to each recurring payment when selected. Do not promise the contribution is free of all provider fees. |
| `coverImage` | A Wix Media image reference, e.g. `{ "id": "<MEDIA_ID>", "altText": "<DESCRIPTION>" }`; use the user's/approved media workflow, not a guessed URL. |

All campaign amounts use the site's default currency. Read the site's currency; change it only when
explicitly requested, through the [currency recipe](../stores/change-store-currency.md).
The campaign has no story/description or slug field: preset `description` is not campaign story copy.
See the [campaign object](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/donation-campaign-object).

## 3. Update with a fresh revision, then verify

[Get campaign](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/get-donation-campaign):

```bash
curl -sS --fail-with-body \
  'https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/<CAMPAIGN_ID>' \
  -H 'Authorization: <AUTH>'
```

[Update campaign](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/update-donation-campaign)
supports partial updates. Carry the current `revision` and change only the requested fields:

```bash
curl -sS --fail-with-body -X PATCH \
  'https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/<CAMPAIGN_ID>' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{"donationCampaign":{"id":"<CAMPAIGN_ID>","revision":"<CURRENT_REVISION>","commentsEnabled":true}}'
```

Preserve preset UUIDs when editing existing presets. **After a successful PATCH, GET the same campaign
again using the request above**, then compare the requested changes and all untouched configuration
against the pre-write snapshot: preset IDs/prices/impact text, frequencies, custom-amount enablement
and bounds, goal and acceptance flags, note enablement, fee coverage, image and archived state. Verify
every setting the user explicitly asked to preserve in the returned data; do not merely say
"everything else is unchanged". Do not treat the PATCH response alone as a verification read or report
success when the read fails. On a revision conflict, reread before reconciling, rather than overwriting
concurrent edits. For a requested archive/unarchive, use this same PATCH with `archived: true` / `false`,
then GET the same ID to verify that flag and preserved configuration; an active-only listing cannot
verify an archive. Archiving hides a campaign and prevents new donations; do not substitute deletion.
`status` is computed by Wix, not writable.

## 4. Read progress, and separate setup from payment readiness

Only when `campaignGoal` exists, call
[Get metrics](https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/get-donation-campaign-metrics):

```bash
curl -sS --fail-with-body \
  'https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/<CAMPAIGN_ID>/metrics' \
  -H 'Authorization: <AUTH>'
```

Read `currencyMetricsList[].currencyCode`, `donationCount`, `totalAmount`. Counts mean successful
donations, not necessarily unique donors. A permission failure or unavailable metrics is not zero
fundraising. `CAMPAIGN_GOAL_NOT_SET` means no goal, not a broken checkout.

Campaign creation, a cart and a redirect session do not prove payment acceptance. For live payments,
check the site's payment-enabled plan and connected provider; recurring giving needs a provider that
supports it. Do not diagnose malformed cart options as a premium problem or claim premium never
matters. [Payment prerequisites](https://support.wix.com/en/article/wix-donations-adding-and-setting-up-wix-donations).

For accepting a donation, use the [Headless donation recipe](../../../wix-headless/references/inline-recipes/how-to-code-donations.md),
not an Editor widget installation. On a Kit build, use the existing Donations seed script rather than
seeding the same campaigns a second time. Report which campaigns changed and which payment setup
remains with the owner.
