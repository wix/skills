# Wix Donations — client-only REST

Connect the existing site's campaigns to the donor UI. No SDK, backend, Editor widget or replacement
site. The public `WIX_CLIENT_ID` and shared visitor transport select the content site; never put owner
credentials in the app. Do not gate donating behind member login.

Read [How to Code Donations](../../../wix-headless/references/inline-recipes/how-to-code-donations.md)
for the exact contract/troubleshooting/verification, and
[Donations experience](../../../wix-headless/references/inline-recipes/experience-donations.md) for the donor journey.
If a sibling skill is absent, read the same path under `https://www.wix.com/skills/`.

## Shipped helper, presentation yours

Copy `app/` and `../shared/app/` into the app's `src/` (the platform deploy step does this for you).
The added file is `src/rest/wix-donations.js`; the shared transport/config stay shared with any other
vertical. Keep the existing theme and routing system; this vertical ships no page or provider.
On an existing app, deploy upgrades only the exact unmodified legacy transport. If it reports a
customized/incompatible transport, merge the shared transport's strict-error support and capability
export into that file before retrying; do not overwrite custom auth or silently ignore the warning.

| Export | Returns / behavior |
| --- | --- |
| `queryDonationCampaigns({ limit?, cursor? })` | `{ campaigns, nextCursor }`; raw REST entities, IDs are `id`. Continue paging; do not hardcode seed IDs. |
| `getDonationCampaign(id)` | The raw campaign, or null for missing/archived. Other failures throw. |
| `getDonationCampaignMetrics(id)` | `currencyMetricsList`; call only with a goal. A denied/unavailable read is not zero fundraising. |
| `donationCartBody(campaign, selection)` | Validates the choice and creates the numeric, one-time-omitting Cart V2 body; does not call Wix. |
| `donationCheckoutUrl(id, selection, { origin?, campaignPath?, thankYouPath? }?)` | Rereads the campaign, creates a standalone cart, then a redirect session. Returns the hosted URL; does not navigate or mark anything paid. Errors retain `status`, `body`, `stage`, and a known `cartId`. |

`selection` is `{ amount, frequency: 'ONE_TIME'|'WEEK'|'MONTH'|'YEAR', coverFee, note }`.
Use fields from the actual campaign: `predefinedDonationAmounts[].price` (decimal string amounts,
formatted display values), preset `.description` (impact), `donationFrequencies`,
`customAmountEnabled` / `customAmountOptions`, `commentsEnabled`, `askDonorCoverFee`, optional
`campaignGoal`. There is no campaign story or slug field. Keep story copy in the site, not in fake data.

## Wire the donor surfaces

Build the cause-led home/navigation, `/donate` discovery (or the single cause's form), a campaign
route `/donate/:id`, and `/donate/thank-you` in the existing router. Make direct links/refresh work;
wire the static thank-you route before a catch-all ID route. Unknown/archived is a real not-found
state. Active status is `COLLECTING`; a reached goal does not necessarily stop collection.

The presentation owns giving-intent routing and short-lived per-campaign draft recovery, as defined
in the shared recipe: preserve choices through discovery, refresh and checkout cancellation. The
helper does not persist a form. Save before leaving, restore/revalidate on return, and keep notes out
of URLs and logs; do not infer completion or clear a draft from the callback alone.

The form offers configured frequencies/presets/custom bounds, impact text, optional note and optional
fee choice. Explain the recurring commitment and fee beside the action. Fee coverage is the catalog's
2.9% option, not an arbitrary surcharge; the helper sends the base amount and flag. Render prices in
the verified site currency; do not assume `$` because the API amount is a string. Preserve validation
and choices, disable repeated submits, and show a recoverable inline failure without leaking raw donor
data. Use a distinct loading, empty and failed-query state. Source real progress only where readable.

```js
import { donationCheckoutUrl } from '@/rest/wix-donations';

// In the form's one submit handler, after client validation; pending blocks repeat activation.
setPending(true);
try {
  const url = await donationCheckoutUrl(campaign.id, { amount, frequency, coverFee, note });
  window.location.assign(url); // full document, exact URL — not the app router
} catch (error) {
  console.error('Donation checkout failed', { // safe diagnostic fields; original response is error.body
    stage: error.stage, status: error.status,
    code: error.body?.details?.applicationError?.code ?? error.body?.code,
  });
  setError('We could not open checkout. Please check your selection and try again.');
} finally {
  setPending(false);
}
```

Use your host's actual paths/origin in the optional callback parameters when these routes differ.
The deployed origin must be allowed on the OAuth client. The return page cannot claim payment from
`orderId` alone; if an authorized order read is unavailable, acknowledge without amount/name/paid
claims. Donor history and subscription management are not shipped here; do not invent controls.

## Completion

Follow the integration recipe's anonymous API smoke test and verify desktop/phone form states and
the hosted checkout's cause/amount/cadence before calling the flow complete. API creation is not a
paid donation. Do not take a real payment without explicit authorization. Report setup/verification
limits, including payment-enabled plan/provider and allowed origins; do not explain an
`ITEM_NOT_FOUND_IN_CATALOG` away as premium or reinstall apps before checking the option types.

Campaign changes require owner authorization and the [management recipe](../../../wix-manage/references/donations/create-and-update-donation-campaigns.md).
Preserve existing campaigns when only connecting the front. The canonical campaign dashboard route
is the app-ID fallback: `https://manage.wix.com/dashboard/<SITE_ID>/app/333b456e-dd48-4d6b-b32b-9fd48d74e163`.
