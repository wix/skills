// Donations seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/donations/seed/seed-donations.mjs plan.json
//
// It mints its own site token via the Wix CLI, sets the site currency when the plan names one,
// installs the eCom platform and the Wix Donations app if needed, creates the campaigns (one create
// call per campaign), verifies each is readable, then imports and attaches cover images in a second
// pass. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "currency"?: "USD",
//     "campaigns": [{ "name" (1-65 chars),
//                     "frequencies"?: ["ONE_TIME"|"WEEK"|"MONTH"|"YEAR"] (1-4, default ["ONE_TIME"]),
//                     "presets"?: [{ "amount" (decimal string), "impact"? (≤200 chars) }] (≤20),
//                     "customAmount"?: { "enabled", "min"?, "max"? },
//                     "goal"?: { "target", "endDate"?, "acceptAfterGoal"?, "acceptAfterEndDate"? },
//                     "comments"?: false, "askCoverFee"?: false,
//                     "imageUrl"? | "imagePath"? | "imagePrompt"? }] }
//
// Seeding is ADDITIVE and idempotent — a non-archived campaign with the same name is reused, never
// duplicated; nothing is deleted or overwritten. Unexpected shapes → read the live API reference;
// every call below carries a docs: line with its reference page.
import { setSiteCurrency } from "../../shared/seed/site.mjs";
import { resolveItemImages } from "../../shared/seed/images.mjs";
import { seedSiteId } from "../../shared/seed/site-context.mjs";
import { wixToken } from "../../shared/seed/wix-cli.mjs";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const API = "https://www.wixapis.com";
export const DONATIONS_APP_ID = "333b456e-dd48-4d6b-b32b-9fd48d74e163";
export const ECOM_PLATFORM_APP_ID = "1380b703-ce81-ff05-f115-39571d94dfcd"; // Checkout & Orders — a donation is an eCom checkout
const CAMPAIGNS = "/donation-campaigns/v2/donation-campaigns";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns";
const FREQUENCIES = ["ONE_TIME", "WEEK", "MONTH", "YEAR"];

export function makeCtx({ cwd = process.cwd() } = {}) {
  // The content site: the config's site, or the parent on a migration preview (site-context.mjs stops
  // a seed there unless --allow-parent is passed after the user confirmed).
  const siteId = seedSiteId({ cwd, argv: process.argv });
  const token = wixToken(siteId, cwd);
  return { token, siteId };
}

async function req(ctx, path, { method = "POST", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "wix-site-id": ctx.siteId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (v) => ({ amount: String(v) }); // amounts are decimal STRINGS in the site currency

// ---- plan → create body ----------------------------------------------------------------------------

// The rules the API enforces (the create call rejects otherwise): name 1-65 chars; 1-4 frequencies;
// ≤20 presets, each with a REQUIRED client-supplied GUID id and a ≤200-char description; when the
// custom amount is off at least one preset. Defaults when the plan says nothing: one-time only, no
// note, no fee prompt; a campaign with no presets gets the custom amount enabled with no limits.
export function buildCampaign(c) {
  if (!c.name || c.name.length > 65) throw new Error(`campaign name must be 1-65 chars: "${c.name ?? ""}"`);
  const frequencies = (c.frequencies?.length ? c.frequencies : ["ONE_TIME"]).map((f) => String(f).toUpperCase());
  for (const f of frequencies) if (!FREQUENCIES.includes(f)) throw new Error(`"${c.name}": unknown frequency "${f}" — one of ${FREQUENCIES.join(", ")}`);
  if (frequencies.length > 4) throw new Error(`"${c.name}": at most 4 frequencies`);
  const presets = (c.presets ?? []).map((p) => {
    const amount = typeof p === "object" ? p.amount : p;
    const impact = typeof p === "object" ? p.impact ?? p.description : undefined;
    if (impact && impact.length > 200) throw new Error(`"${c.name}": impact text over 200 chars`);
    return { id: randomUUID(), price: money(amount), ...(impact ? { description: impact } : {}) };
  });
  if (presets.length > 20) throw new Error(`"${c.name}": at most 20 preset amounts`);
  const custom = c.customAmount ?? (presets.length ? { enabled: false } : { enabled: true });
  const customEnabled = custom.enabled !== false;
  if (!customEnabled && !presets.length) throw new Error(`"${c.name}": needs a preset amount or customAmount.enabled`);
  const body = {
    name: c.name,
    donationFrequencies: frequencies,
    predefinedDonationAmounts: presets,
    customAmountEnabled: customEnabled,
    commentsEnabled: c.comments === true,
    askDonorCoverFee: c.askCoverFee === true,
  };
  if (customEnabled && (custom.min != null || custom.max != null)) {
    body.customAmountOptions = {
      ...(custom.min != null ? { minimum: money(custom.min) } : {}),
      ...(custom.max != null ? { maximum: money(custom.max) } : {}),
    };
  }
  if (c.goal?.target != null) {
    body.campaignGoal = {
      targetAmount: money(c.goal.target),
      ...(c.goal.endDate ? { endDate: c.goal.endDate } : {}),
      ...(c.goal.acceptAfterGoal != null ? { acceptDonationsAfterGoal: c.goal.acceptAfterGoal } : {}),
      ...(c.goal.acceptAfterEndDate != null ? { acceptDonationsAfterEndDate: c.goal.acceptAfterEndDate } : {}),
    };
  }
  return body;
}

// ---- operations ------------------------------------------------------------------------------------

// Idempotent: re-installing an already-installed app returns 200. eCom first — a donation is an eCom
// checkout; whether installing Donations provisions eCom by itself is not verified, so both go in.
// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installApp(ctx, appDefId) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId, enabled: true },
    } });
    return true;
  } catch (e) {
    return `not installed here (${String(e.message).slice(0, 160)}) — the owner can add Wix Donations from the dashboard's App Market`;
  }
}

export async function installDonationsApps(ctx) {
  return { ecom: await installApp(ctx, ECOM_PLATFORM_APP_ID), donations: await installApp(ctx, DONATIONS_APP_ID) };
}

// A non-archived campaign with this exact name, when one exists (`name` is filterable).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/query-donation-campaigns.md
export async function findCampaignByName(ctx, name) {
  const r = await req(ctx, `${CAMPAIGNS}/query`, { body: { query: { filter: { name, archived: false }, cursorPaging: { limit: 1 } } } });
  return r.donationCampaigns?.[0] ?? null;
}

// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/get-donation-campaign.md
export async function getCampaign(ctx, id) {
  return (await req(ctx, `${CAMPAIGNS}/${id}`, { method: "GET" })).donationCampaign;
}

// Create, then verify the campaign reads back (the read side can lag the write by a moment — retry
// the GET a few times, never the POST). Reuses an existing campaign of the same name.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/create-donation-campaign.md
export async function createCampaign(ctx, plan) {
  const existing = await findCampaignByName(ctx, plan.name).catch(() => null);
  if (existing?.id) return { id: existing.id, name: existing.name, status: existing.status, created: false };
  const r = await req(ctx, CAMPAIGNS, { body: { donationCampaign: buildCampaign(plan) } });
  const id = r.donationCampaign?.id;
  if (!id) throw new Error(`Campaign "${plan.name}" was not created — no id returned.`);
  let verified = null;
  for (let attempt = 0; attempt < 4 && !verified; attempt++) {
    verified = await getCampaign(ctx, id).catch(() => null);
    if (!verified) await sleep(1000 * (attempt + 1));
  }
  return { id, name: plan.name, status: verified?.status ?? r.donationCampaign?.status ?? null, created: true, verified: !!verified };
}

export async function createCampaigns(ctx, campaigns) {
  const out = [];
  for (const c of campaigns) out.push({ ...(await createCampaign(ctx, c)), plan: c });
  return out;
}

// Attach a Wix Media file as the cover image. The Image object's shape follows the SDK's transforms
// ({ id, url, height, width, altText }); whether the update needs a field mask is not verified live,
// so a plain PATCH is tried first and one with an explicit mask second. Revision comes from a fresh
// GET (an optimistic-locking field).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/update-donation-campaign.md
export async function setCampaignCoverImage(ctx, { campaignId, id, url, height = 1024, width = 1024, altText }) {
  const current = await getCampaign(ctx, campaignId);
  const donationCampaign = { id: campaignId, revision: current.revision, coverImage: { id, url, height, width, ...(altText ? { altText } : {}) } };
  try {
    return await req(ctx, `${CAMPAIGNS}/${campaignId}`, { method: "PATCH", body: { donationCampaign } });
  } catch (first) {
    if (first.status !== 400) throw first;
    return req(ctx, `${CAMPAIGNS}/${campaignId}`, { method: "PATCH", body: { donationCampaign, fieldMask: { paths: ["coverImage"] } } });
  }
}

/**
 * ONE-CALL seed: site currency (if named) → install eCom + Donations → one create per campaign
 * (verified) → images in a second pass. The default path.
 */
export async function setupDonations(ctx, { campaigns = [], currency } = {}) {
  if (!campaigns.length) throw new Error("plan.campaigns is empty — nothing to seed");
  // Before any campaign exists: every amount is stored in the site currency.
  if (currency) await setSiteCurrency(ctx, currency);
  const installed = await installDonationsApps(ctx);
  const created = await createCampaigns(ctx, campaigns);

  // Pass 2 — images: resolve (upload a local file / import by url / generate by prompt) in one
  // parallel wave, then attach. Failures leave the campaign text-only; the exit never depends on them.
  const wanted = created.filter((c) => c.created && (c.plan.imageUrl || c.plan.imagePath || c.plan.imagePrompt));
  const files = await resolveItemImages(ctx, wanted.map((c) => ({
    url: c.plan.imageUrl,
    path: c.plan.imagePath,
    prompt: c.plan.imagePrompt,
    displayName: `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "campaign"}.png`,
  })));
  let imagesAttached = 0;
  const imageErrors = [];
  for (let i = 0; i < wanted.length; i++) {
    if (!files[i]) continue;
    try {
      await setCampaignCoverImage(ctx, { campaignId: wanted[i].id, id: files[i].id, url: files[i].url, altText: wanted[i].name });
      imagesAttached++;
    } catch (e) {
      imageErrors.push(`${wanted[i].name}: ${String(e.message).slice(0, 200)}`); // never block on an image
    }
  }

  const recurring = created.some((c) => (c.plan.frequencies ?? []).some((f) => String(f).toUpperCase() !== "ONE_TIME"));
  return {
    installed,
    campaigns: created.map(({ id, name, status, created: isNew, verified }) => ({ id, name, status, created: isNew, ...(isNew ? { verified } : {}) })),
    imagesAttached,
    ...(imageErrors.length ? { imageErrors } : {}),
    // Completing a donation needs a premium plan + a connected payment method in the dashboard —
    // not a seeding failure; surface it to the owner.
    notes: [
      "Taking real donations requires a premium plan and a connected payment method in the dashboard; until then the hosted checkout refuses the payment.",
      ...(recurring ? ["Recurring frequencies (WEEK/MONTH/YEAR) also need a payment provider that supports recurring payments."] : []),
    ],
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-donations.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupDonations(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
