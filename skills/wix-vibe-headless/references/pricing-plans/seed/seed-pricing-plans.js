// Pricing-Plans seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Pricing Plans (V3)
// + Benefit Programs request/response mechanics (the client-supplied GUID rule, the string-amount
// rule, the three ordered coverage sub-steps, the @wix/pricing-plans namespace) live here, once.
//
// **NOT yet live-verified — transcribed from setup-pricing-plans.md.**
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/pricing-plans/seed/seed-pricing-plans.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//
//   // Bookings is seeded FIRST — its service ids feed a plan's coverage (see SEED.md).
//   const plans = await seed.createPlans(ctx, [
//     { name: "Studio Membership", description: "Unlimited group classes.", price: "20.00",
//       type: "recurring", billingCycle: { period: "MONTH", count: 1 },
//       perks: ["Unlimited group classes", "10% off workshops"],
//       coveredServiceIds: bookingsServiceIds },   // optional — only when this plan covers bookings
//   ]);
//   // Then, per plan that covers bookings services (STEP 2; skip entirely with no bookings):
//   await seed.attachBookingsCoverage(ctx, plans[0].id, plans[0].coveredServiceIds);
//
// If any call fails with a shape the caller didn't expect, fall back to the wix-docs skill
// (search + read the live Wix API reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-pricing-plans.md.

const { randomUUID } = require("crypto");

const API = "https://www.wixapis.com";
const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97"; // per recipe: providerAppId for coverage
const PRICING_PLANS_APP_ID = "1522827f-c56c-a5c9-2ac9-00f9e6ae12d3"; // installPricingPlansApp installs this before seeding
const PP_NAMESPACE = "@wix/pricing-plans"; // per recipe: literal, with @ and slash, in every 2a–2c call

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [ "text" | { description } ] -> Wix perks[]; each gets a fresh client-supplied GUID (required).
function buildPerks(perks = []) {
  return perks.map((p) => ({
    id: randomUUID(),
    description: typeof p === "string" ? p : p.description,
  }));
}

// billingTerms selects the plan type (recurring | one-time | free). Amounts are decimal STRINGS.
// recurring: billingCycle {period,count} (default MONTH/1) + startType ON_PURCHASE + endType UNTIL_CANCELLED.
// one-time:  endType CYCLES_COMPLETED + cyclesCompletedDetails {billingCycleCount:1} (bill once, then ends);
//            an unlimited one-time instead sets billingCycle:null + endType UNTIL_CANCELLED.
function buildBillingTerms(plan) {
  const type = plan.type || "recurring";
  if (type === "one-time") {
    if (plan.billingCycle === null) {
      return { billingCycle: null, startType: "ON_PURCHASE", endType: "UNTIL_CANCELLED" };
    }
    const cycle = plan.billingCycle || { period: "MONTH", count: 1 };
    return {
      billingCycle: cycle,
      startType: "ON_PURCHASE",
      endType: "CYCLES_COMPLETED",
      cyclesCompletedDetails: { billingCycleCount: 1 },
    };
  }
  // recurring (also the shape a free plan rides on)
  const cycle = plan.billingCycle || { period: "MONTH", count: 1 };
  return { billingCycle: cycle, startType: "ON_PURCHASE", endType: "UNTIL_CANCELLED" };
}

// one pricingVariant with one pricingStrategy (schema allows ≤20 but is "currently limited to 1").
function buildPricingVariant(plan) {
  const free = (plan.type || "recurring") === "free";
  const amount = free ? "0" : String(plan.price);
  return {
    id: randomUUID(), // required, client-supplied GUID — never model-typed
    name: plan.variantName || "Standard",
    billingTerms: buildBillingTerms(plan),
    pricingStrategies: [{ flatRate: { amount } }],
  };
}

// ---- exported operations ----

/**
 * Create the plan(s). Plans V3 has NO bulk-create — one create call per plan.
 * @param plans [{ name, description?, price,           // price = decimal string ("20.00"); ignored for free
 *   type?: "recurring"|"one-time"|"free",              // default "recurring"
 *   billingCycle?: { period: "DAY"|"WEEK"|"MONTH"|"YEAR", count } | null,  // default { MONTH, 1 }
 *   perks?: ["..."] | [{ description }],               // display-only bullets (no functional effect)
 *   visibility?, buyable?,                             // default "PUBLIC" / true (public + orderable)
 *   coveredServiceIds? }]                              // metadata for attachBookingsCoverage; not sent here
 * @returns [{ id, name, coveredServiceIds }]  (id = plan.id — orders by it AND is the coverage externalId)
 */
async function createPlans(ctx, plans) {
  const out = [];
  for (const plan of plans) {
    const free = (plan.type || "recurring") === "free";
    const body = {
      plan: {
        name: plan.name,
        description: plan.description,
        status: "ACTIVE", // REQUIRED — omitting returns 400 "status value is required"
        visibility: plan.visibility || "PUBLIC",
        buyable: plan.buyable ?? true,
        buyerCanCancel: plan.buyerCanCancel ?? true,
        pricingVariants: [buildPricingVariant(plan)],
        perks: buildPerks(plan.perks),
        // free: cap lifetime reuse (older maxPurchasesPerBuyer is deprecated — prefer purchaseLimits)
        ...(free ? { purchaseLimits: { type: "PER_MEMBER_LIFETIME", count: 1 } } : {}),
      },
    };
    const r = await req(ctx, "/pricing-plans/v3/plans", { body });
    out.push({ id: r.plan?.id, name: plan.name, coveredServiceIds: plan.coveredServiceIds });
  }
  return out;
}

// ---- STEP 2: bookings coverage via Benefit Programs API (SKIP when no bookings in the run) ----
// Strictly ordered: plan.id -> programDefinition.id -> itemSetId -> items. Do NOT parallelize.

// 2a: READ the auto-created program definition (the Plans app creates it; you never create it).
// Provisioning is ~immediate but async — retry ONCE after a short backoff on 404/empty, don't loop.
async function getProgramDefinition(ctx, planId) {
  const path = `/benefit-programs/v1/program-definitions/by-namespace-and-external-id?externalId=${planId}&namespace=${encodeURIComponent(PP_NAMESPACE)}`;
  try {
    const r = await req(ctx, path, { method: "GET" });
    if (r.programDefinition?.id) return r.programDefinition.id;
  } catch {
    // fall through to the single insurance retry
  }
  await sleep(1000);
  const r = await req(ctx, path, { method: "GET" });
  return r.programDefinition?.id;
}

// 2b: create ONE pool definition with EXACTLY ONE benefit naming Bookings as the provider.
// price "0" = unlimited (default; no creditConfiguration). Limited pack: pass creditAmount ->
// price "1" + details.creditConfiguration (SIBLING of benefits[], NOT inside a benefit).
async function createPoolDefinition(ctx, programDefinitionId, { creditAmount } = {}) {
  const limited = creditAmount != null;
  const details = {
    ...(limited ? { creditConfiguration: { amount: String(creditAmount) } } : {}),
    benefits: [
      {
        benefitKey: randomUUID(), // freshly generated random UUID you supply
        displayName: "Bookings sessions",
        providerAppId: BOOKINGS_APP_ID,
        price: limited ? "1" : "0",
      },
    ],
  };
  const r = await req(ctx, "/benefit-programs/v1/pool-definitions", {
    body: {
      poolDefinition: {
        namespace: PP_NAMESPACE,
        displayName: "Bookings benefit",
        programDefinitionIds: [programDefinitionId],
        details,
      },
      cascade: "IMMEDIATELY",
    },
  });
  // itemSetId lives at poolDefinition.details.benefits[i].itemSetId — one benefit here, so [0].
  return r.poolDefinition?.details?.benefits?.[0]?.itemSetId;
}

// 2c: bulk-create the benefit items — ONE item per covered service (externalId = bookings service id).
// Up to 100 items per call; category is an empty string; namespace/providerAppId repeat 2b's values.
async function createBenefitItems(ctx, itemSetId, serviceIds) {
  return req(ctx, "/benefit-programs/v1/bulk/items/create", {
    body: {
      items: serviceIds.map((externalId) => ({
        namespace: PP_NAMESPACE,
        category: "",
        providerAppId: BOOKINGS_APP_ID,
        itemSetId,
        externalId,
      })),
      returnEntity: true,
    },
  });
}

/**
 * Wire a plan to COVER bookings services (STEP 2, per plan). Runs 2a -> 2b -> 2c in order.
 * @param planId          plan.id from createPlans
 * @param serviceIds      bookings service ids (seeded.bookings.serviceIds[]) the plan should cover
 * @param creditAmount?   session-count for a limited pack; omit for the default unlimited ("0") case
 * @returns { itemSetId, serviceIds }  — keep as seed-time linkage (bookingsCoverage[planId])
 */
async function attachBookingsCoverage(ctx, planId, serviceIds, { creditAmount } = {}) {
  const programDefinitionId = await getProgramDefinition(ctx, planId);
  const itemSetId = await createPoolDefinition(ctx, programDefinitionId, { creditAmount });
  await createBenefitItems(ctx, itemSetId, serviceIds);
  return { itemSetId, serviceIds };
}

/**
 * DEFAULT one-call path — create plan(s) and, per plan, wire bookings coverage when provided.
 * One call; created plan ids stay in memory so coverage never needs hand-threading of plan.id.
 * Order: createPlans (all plans) -> per covering plan attachBookingsCoverage (2a->2b->2c, in order).
 * The program definition is provisioned asynchronously ~1s after the plan; the retry-once-after-
 * backoff on its 404 lives in getProgramDefinition and is preserved via attachBookingsCoverage.
 * @param plan { plans: [{ ...createPlans fields (name, description?, price, type?, billingCycle?,
 *   perks?, visibility?, buyable?),
 *   coveredServiceIds?,                                    // bookings service ids this plan covers
 *   bookingsCoverage?: { serviceIds?, creditAmount? } }] } // richer coverage; creditAmount = limited pack
 * @returns { plans: [{id,name,coveredServiceIds}], coverageAttached: [{planId,itemSetId,serviceIds}], benefitsCreated }
 */
// Install the Wix Pricing Plans app before seeding — base44 sites aren't guaranteed to have it (no
// separate Setup step here, unlike the wix-headless recipe). Idempotent: re-installing returns 200.
async function installPricingPlansApp(ctx) {
  return req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
    tenant: { tenantType: "SITE", id: ctx.siteId },
    appInstance: { appDefId: PRICING_PLANS_APP_ID, enabled: true },
  } });
}

async function setupPricingPlans(ctx, { plans = [] } = {}) {
  await installPricingPlansApp(ctx);
  const created = await createPlans(ctx, plans); // ids kept in memory
  const coverageAttached = [];
  for (let i = 0; i < created.length; i++) {
    const cov = plans[i].bookingsCoverage || {};
    const serviceIds = cov.serviceIds || created[i].coveredServiceIds;
    if (!serviceIds?.length) continue; // plans-only plan — skip STEP 2
    const r = await attachBookingsCoverage(ctx, created[i].id, serviceIds, { creditAmount: cov.creditAmount });
    coverageAttached.push({ planId: created[i].id, ...r });
  }
  const benefitsCreated = coverageAttached.reduce((n, c) => n + c.serviceIds.length, 0);
  return { plans: created, coverageAttached, benefitsCreated };
}

module.exports = {
  setupPricingPlans, installPricingPlansApp,
  createPlans,
  attachBookingsCoverage,
  getProgramDefinition, createPoolDefinition, createBenefitItems,
};
