// What the site collects for: non-archived donation campaigns and their goal progress.
//   node <SKILL_ROOT>/templates/donations/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const DONATIONS_APP_ID = "333b456e-dd48-4d6b-b32b-9fd48d74e163";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns";

await runReader({
  vertical: "donations",
  appId: DONATIONS_APP_ID,
  async read(api, { limit }) {
    const r = await api.call({ path: "/donation-campaigns/v2/donation-campaigns/query", body: { query: { filter: { archived: false }, cursorPaging: { limit } } }, docs: `${D}/query-donation-campaigns` });
    const campaigns = r.donationCampaigns ?? [];
    const metrics = await Promise.all(campaigns.map((c) => api.tryCall({ method: "GET", path: `/donation-campaigns/v2/donation-campaigns/${c.id}/metrics`, docs: `${D}/get-donation-campaign-metrics` })));
    return {
      campaignCount: r.pagingMetadata?.count ?? campaigns.length,
      campaigns: campaigns.map((c, i) => {
        const m = metrics[i]?.currencyMetricsList?.[0];
        return {
          id: c.id, name: c.name, status: c.status ?? null,
          frequencies: c.donationFrequencies ?? [],
          presets: (c.predefinedDonationAmounts ?? []).map((p) => p.price?.formattedAmount ?? p.price?.amount ?? null),
          customAmount: c.customAmountEnabled ? { min: c.customAmountOptions?.minimum?.amount ?? null, max: c.customAmountOptions?.maximum?.amount ?? null } : false,
          goal: c.campaignGoal ? { target: c.campaignGoal.targetAmount?.formattedAmount ?? c.campaignGoal.targetAmount?.amount ?? null, endDate: c.campaignGoal.endDate ?? null } : null,
          raised: m?.totalAmount?.formattedAmount ?? m?.totalAmount?.amount ?? null,
          donationCount: m?.donationCount ?? null,
          comments: c.commentsEnabled === true, askCoverFee: c.askDonorCoverFee === true,
          image: !!c.coverImage,
        };
      }),
    };
  },
});
