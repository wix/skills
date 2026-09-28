// Campaign reads over REST — the twin of app/wix/donations/campaigns.ts. Same exports, same DTOs;
// the rules and mappers come from donations-core (the SAME file the SDK transport uses, deployed
// flat next to this one by deploy.mjs --stack static), so this file is only the transport: one
// fetch with a literal body per function. Every call here runs with the visitor token; the metrics
// read is guarded (a refusal leaves the raised total and the currency "").
// Porting: keep the path, keep the body, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/query-donation-campaigns.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/get-donation-campaign-metrics.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { campaignsQuery, currencyOf, isArchived, rawId, toDetail, toSummary, type Raw } from "./donations-core.js";
import type { CampaignDetail, CampaignSummary } from "./types.js";

const BASE = "/donation-campaigns/v2/donation-campaigns";

// GET /donation-campaigns/v2/donation-campaigns/{id}/metrics → { currencyMetricsList: [{ currencyCode, donationCount, totalAmount }] }
async function metricsOf(campaignId: string): Promise<Raw[]> {
  try {
    const res = await wixRequest<Raw>(`${BASE}/${campaignId}/metrics`, { method: "GET" });
    return (res?.currencyMetricsList ?? []) as Raw[];
  } catch {
    return []; // metrics are a nicety — the campaign stays correct without them
  }
}

/**
 * The non-archived campaigns, oldest first, as card-ready DTOs.
 * POST /donation-campaigns/v2/donation-campaigns/query  { query: { filter: { archived: false }, sort: [{ fieldName: "createdDate", order: "ASC" }], cursorPaging: { limit } } }
 */
export async function fetchCampaigns({ limit = 100 } = {}): Promise<CampaignSummary[]> {
  const res = await wixRequest<Raw>(`${BASE}/query`, { body: { query: campaignsQuery({ limit }) } });
  const items = ((res?.donationCampaigns ?? []) as Raw[]).filter((raw) => !isArchived(raw));
  const metrics = await Promise.all(items.map((raw) => (raw.campaignGoal ? metricsOf(rawId(raw)) : Promise.resolve([] as Raw[]))));
  return items.map((raw, i) => toSummary(raw, metrics[i], currencyOf(metrics[i]), imgSrc));
}

/**
 * One campaign by id with its goal progress and form options; null when not found (404) or archived.
 * GET /donation-campaigns/v2/donation-campaigns/{id}  → { donationCampaign }
 */
export async function fetchCampaign(campaignId: string): Promise<CampaignDetail | null> {
  let raw: Raw | undefined;
  try {
    raw = (await wixRequest<Raw>(`${BASE}/${campaignId}`, { method: "GET" }))?.donationCampaign;
  } catch (e) {
    if (e instanceof WixApiError && e.status === 404) return null;
    throw e;
  }
  if (!raw || isArchived(raw)) return null; // an archived campaign is reachable by id but never shows a form
  const metrics = await metricsOf(campaignId);
  return toDetail(raw, metrics, currencyOf(metrics), imgSrc);
}

/** The Wix widget's default: the first campaign by creation date. Null when the site has none. */
export async function fetchDefaultCampaign(): Promise<CampaignDetail | null> {
  const [first] = await fetchCampaigns({ limit: 1 });
  return first ? fetchCampaign(first.id) : null;
}
