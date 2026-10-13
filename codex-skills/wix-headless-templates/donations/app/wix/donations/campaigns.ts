// Campaign reads (Wix Donations, Donation Campaigns) over the SDK — the only file that touches raw
// campaign entities on this transport. Everything it returns is a plain DTO from ./types. The rules
// and mappers live in ./donations-core (shared with the REST twin in templates/donations/rest/);
// this file is the transport only. Copy as-is; extend by adding functions, not by editing these.
//
// The metrics read (raised total, donation count, the site currency) is guarded: a refusal for the
// visitor's token leaves `goal.raised` "" and `options.currency` "" — the page still renders from
// the campaign's own formatted amounts. Whether an anonymous visitor may read metrics is not yet
// verified against a live site.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/query-donation-campaigns.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/get-donation-campaign-metrics.md
import { donationCampaigns } from "@wix/donations";
import { ecommerceSettings } from "@wix/ecom";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { currencyOf, isArchived, rawId, toDetail, toSummary, type Raw } from "./donations-core";
import type { CampaignDetail, CampaignSummary } from "./types";

const campaignsApi = wixModule(donationCampaigns);
const settingsApi = wixModule(ecommerceSettings);

// The metrics list is EMPTY on a campaign nobody has donated to yet, and the campaign entity carries
// formatted amounts but no currency code — so a fresh site would format nothing. The site's currency
// comes from the eCommerce settings then (BUSINESS_INFO), read once per process; "" when refused.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/ecommerce-settings/get-ecommerce-settings.md
let siteCurrencyPromise: Promise<string> | null = null;
function siteCurrency(): Promise<string> {
  siteCurrencyPromise ??= settingsApi
    .getEcommerceSettings(["BUSINESS_INFO"])
    .then((res: Raw) => String(res?.ecommerceSettings?.businessInfo?.currency ?? ""))
    .catch(() => { siteCurrencyPromise = null; return ""; });
  return siteCurrencyPromise;
}

/** The campaign's currency: the metrics' when a donation exists, else the site's. */
async function currencyFor(metrics: Raw[]): Promise<string> {
  return currencyOf(metrics) || (await siteCurrency());
}

async function metricsOf(campaignId: string): Promise<Raw[]> {
  try {
    const res: Raw = await campaignsApi.getDonationCampaignMetrics(campaignId);
    return (res?.currencyMetricsList ?? []) as Raw[];
  } catch {
    return []; // metrics are a nicety — the campaign stays correct without them
  }
}

const isNotFound = (e: unknown): boolean => {
  const err = e as Raw;
  const code = err?.details?.applicationError?.code ?? err?.code;
  const msg = String(err?.message ?? "");
  return code === "NOT_FOUND" || err?.status === 404 || /not.?found|404/i.test(msg);
};

/** List the non-archived campaigns, oldest first, as card-ready DTOs (goal progress joined per campaign). */
export async function fetchCampaigns({ limit = 100 } = {}): Promise<CampaignSummary[]> {
  const res = await campaignsApi.queryDonationCampaigns().eq("archived", false).ascending("_createdDate").limit(limit).find();
  const items = ((res.items ?? []) as Raw[]).filter((raw) => !isArchived(raw));
  const metrics = await Promise.all(items.map((raw) => (raw.campaignGoal ? metricsOf(rawId(raw)) : Promise.resolve([] as Raw[]))));
  const currencies = await Promise.all(metrics.map(currencyFor));
  return items.map((raw, i) => toSummary(raw, metrics[i], currencies[i], imgSrc));
}

/** One campaign by id with its goal progress and form options. Null when not found or archived. */
export async function fetchCampaign(campaignId: string): Promise<CampaignDetail | null> {
  let raw: Raw | undefined;
  try {
    raw = (await campaignsApi.getDonationCampaign(campaignId)) as Raw;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  if (!raw || isArchived(raw)) return null; // an archived campaign is reachable by id but never shows a form
  const metrics = await metricsOf(campaignId);
  return toDetail(raw, metrics, await currencyFor(metrics), imgSrc);
}

/** The Wix widget's default: the first campaign by creation date. Null when the site has none. */
export async function fetchDefaultCampaign(): Promise<CampaignDetail | null> {
  const [first] = await fetchCampaigns({ limit: 1 });
  return first ? fetchCampaign(first.id) : null;
}
