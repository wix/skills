// Public REST only. Configure the public client id in the shared wix-config.js.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/e-commerce-integration-with-donation-campaigns
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session
import * as wixClient from './wix-client.js';

export const DONATIONS_APP_ID = '333b456e-dd48-4d6b-b32b-9fd48d74e163';
const CAMPAIGNS = '/donation-campaigns/v2/donation-campaigns';
const RECURRING = ['WEEK', 'MONTH', 'YEAR'];
const request = (path, options = {}) => {
  if (wixClient.WIX_API_SUPPORTS_STRICT_PAYMENT_ERRORS !== true) {
    const error = new Error('Donations needs the updated Wix transport. Re-run the Donations deploy step; for a customized src/rest/wix-client.js, merge strict payment-error support from the shared transport before retrying.');
    error.code = 'DONATIONS_TRANSPORT_UPGRADE_REQUIRED';
    throw error;
  }
  return wixClient.wixApiRequest(path, { ...options, throwOnPaymentRequired: true });
};

/** Raw REST campaigns; page until nextCursor is null. Failures never become an empty result. */
export async function queryDonationCampaigns({ limit = 100, cursor } = {}) {
  const data = await request(`${CAMPAIGNS}/query`, { body: {
    query: { filter: { archived: false }, cursorPaging: { limit, ...(cursor ? { cursor } : {}) } },
  } });
  return { campaigns: data.donationCampaigns ?? [], nextCursor: data.pagingMetadata?.cursors?.next ?? null };
}

/** null only for an absent/archived campaign; authorization and transport errors propagate. */
export async function getDonationCampaign(id) {
  try {
    const { donationCampaign } = await request(`${CAMPAIGNS}/${encodeURIComponent(id)}`, { method: 'GET' });
    return donationCampaign && !donationCampaign.archived ? donationCampaign : null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/** Call only for a campaign with a goal. A failed read must not be displayed as zero fundraising. */
export async function getDonationCampaignMetrics(id) {
  const data = await request(`${CAMPAIGNS}/${encodeURIComponent(id)}/metrics`, { method: 'GET' });
  return data.currencyMetricsList ?? [];
}

/** Pure, independently testable conversion from a live campaign and donor selection to Cart V2. */
export function donationCartBody(campaign, { amount: chosen, frequency = 'ONE_TIME', coverFee = false, note = '' } = {}) {
  if (!campaign?.id || campaign.archived || campaign.status !== 'COLLECTING') {
    throw new Error('This campaign is not accepting donations.');
  }
  if ((typeof chosen !== 'string' && typeof chosen !== 'number') || String(chosen).trim() === '') {
    throw new Error('Enter a positive donation amount.');
  }
  const amount = Number(chosen);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive donation amount.');
  if (!['ONE_TIME', ...RECURRING].includes(frequency) || !campaign.donationFrequencies?.includes(frequency)) {
    throw new Error('Choose a frequency offered by this campaign.');
  }
  const isPreset = campaign.predefinedDonationAmounts?.some(preset => Number(preset.price?.amount) === amount);
  if (!isPreset) {
    if (!campaign.customAmountEnabled) throw new Error('Choose one of the suggested amounts.');
    const { minimum, maximum } = campaign.customAmountOptions ?? {};
    if (minimum && amount < Number(minimum.amount)) throw new Error(`The minimum donation is ${minimum.formattedAmount ?? minimum.amount}.`);
    if (maximum && amount > Number(maximum.amount)) throw new Error(`The maximum donation is ${maximum.formattedAmount ?? maximum.amount}.`);
  }
  if (coverFee && !campaign.askDonorCoverFee) throw new Error('Fee coverage is not offered by this campaign.');
  const message = String(note).trim();
  if (message && !campaign.commentsEnabled) throw new Error('Notes are not enabled for this campaign.');
  if (message.length > 1000) throw new Error('Keep your note within 1,000 characters.');
  return {
    cart: { source: { channelType: 'WEB' }, ...(message ? { note: message } : {}) },
    catalogItems: [{ quantity: 1, catalogReference: {
      appId: DONATIONS_APP_ID,
      catalogItemId: campaign.id,
      options: { amount, ...(frequency !== 'ONE_TIME' ? { frequency } : {}), ...(coverFee ? { donorCoveringFees: true } : {}) },
    } }],
  };
}

/** Read current settings → one standalone Cart V2 → one hosted session. Never merges the current cart. */
export async function donationCheckoutUrl(campaignId, selection, {
  origin = typeof window !== 'undefined' ? window.location.origin : '',
  campaignPath = `/donate/${encodeURIComponent(campaignId)}`,
  thankYouPath = '/donate/thank-you',
} = {}) {
  const site = new URL(origin);
  if (!['https:', 'http:'].includes(site.protocol)) throw new Error('A valid site origin is required.');
  const back = new URL(campaignPath, site.origin);
  const thanks = new URL(thankYouPath, site.origin);
  if (back.origin !== site.origin || thanks.origin !== site.origin) throw new Error('Checkout callbacks must use this site origin.');
  let stage = 'campaign';
  let cartId;
  try {
    const campaign = await getDonationCampaign(campaignId);
    const body = donationCartBody(campaign, selection);
    stage = 'cart';
    const result = await request('/ecom/v2/carts', { body });
    cartId = result.cart?.id;
    if (!cartId) throw new Error('Checkout could not start: no cart id returned.');
    stage = 'redirect';
    const session = await request('/_api/redirects-api/v1/redirect-session', { body: {
      ecomCheckout: { checkoutId: cartId },
      callbacks: { postFlowUrl: back.href, thankYouPageUrl: thanks.href },
    } });
    const url = session.redirectSession?.fullUrl;
    if (!url) throw new Error('Checkout could not start: no redirect URL returned.');
    return url;
  } catch (error) {
    // Preserve the original HTTP status/body; stage and known cart id let the caller diagnose safely.
    error.stage = stage;
    if (cartId) error.cartId = cartId;
    throw error;
  }
}
