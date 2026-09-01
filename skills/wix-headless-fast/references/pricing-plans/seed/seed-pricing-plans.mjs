// Pricing Plans seed — a BUILD-TIME script, never shipped in the app. Run from the project
// root (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/pricing-plans/seed/seed-pricing-plans.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Pricing Plans app if needed,
// creates the plans (Plans V3 — one create call per plan; there is no bulk-create), and —
// only when a plan carries bookings service ids — wires the plan to COVER those services
// through the Benefit Programs API. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "plans": [{ "name", "description"?, "price"? (decimal string; a number is stringified),
//                 "type"?: "recurring"|"one-time"|"free",
//                 "billingCycle"?: { "period": "DAY"|"WEEK"|"MONTH"|"YEAR", "count" } | null,
//                 "perks"?: ["..."], "termsAndConditions"?, "visibility"?, "buyable"?,
//                 "coveredServiceIds"?: ["<bookings service id>"],
//                 "bookingsCoverage"?: { "serviceIds"?, "creditAmount"? } }] }
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Unexpected shapes →
// read the live API reference; authoritative source recipe:
// wix-headless/references/inline-recipes/setup-pricing-plans.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const API = "https://www.wixapis.com";
const PRICING_PLANS_APP_ID = "1522827f-c56c-a5c9-2ac9-00f9e6ae12d3";
const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97"; // coverage providerAppId — NOT the Plans id
const PP_NAMESPACE = "@wix/pricing-plans"; // literal, with the @ and the slash, in every coverage call

export function makeCtx({ cwd = process.cwd() } = {}) {
  const config = JSON.parse(readFileSync(`${cwd}/wix.config.json`, "utf8"));
  const siteId = config.siteId ?? config.projectId;
  if (!siteId) throw new Error("wix.config.json has no siteId — is this a Wix CLI project?");
  const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
    encoding: "utf8",
    cwd,
  }).trim();
  if (!token) throw new Error("The Wix CLI returned no token — run `npx @wix/cli@latest login` first.");
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// billingTerms selects the plan type (recurring | one-time | free). recurring: billingCycle
// {period,count} (default MONTH/1) + ON_PURCHASE + UNTIL_CANCELLED. one-time: endType
// CYCLES_COMPLETED + billingCycleCount 1 (bill once, then ends); an unlimited one-time
// instead sets billingCycle:null + UNTIL_CANCELLED. free: MUST be the no-cycle unlimited
// shape — a $0 variant with a billingCycle is rejected ("Free pricing variant cannot be
// recurring").
function buildBillingTerms(plan) {
  const type = plan.type || "recurring";
  if (type === "free") {
    return { billingCycle: null, startType: "ON_PURCHASE", endType: "UNTIL_CANCELLED" };
  }
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
  // recurring
  const cycle = plan.billingCycle || { period: "MONTH", count: 1 };
  return { billingCycle: cycle, startType: "ON_PURCHASE", endType: "UNTIL_CANCELLED" };
}

// One pricingVariant with one pricingStrategy (schema allows ≤20 but is "currently limited
// to 1"). Amounts are decimal STRINGS ("20.00"); the variant id is a REQUIRED
// client-supplied GUID — omitting it returns 400.
function buildPricingVariant(plan) {
  const free = (plan.type || "recurring") === "free";
  const amount = free ? "0" : String(plan.price);
  return {
    id: randomUUID(),
    name: plan.variantName || "Standard",
    billingTerms: buildBillingTerms(plan),
    pricingStrategies: [{ flatRate: { amount } }],
  };
}

// plain plan -> Plans V3 create body. status:"ACTIVE" is REQUIRED (omitting → 400
// "status value is required"); currency is NOT sent (read-only, site-derived); perks are
// display-only bullets, each with a REQUIRED client-supplied GUID.
function buildPlan(plan) {
  const free = (plan.type || "recurring") === "free";
  return {
    name: plan.name,
    description: plan.description,
    status: "ACTIVE",
    visibility: plan.visibility || "PUBLIC",
    buyable: plan.buyable ?? true,
    buyerCanCancel: plan.buyerCanCancel ?? true,
    ...(plan.termsAndConditions ? { termsAndConditions: plan.termsAndConditions } : {}),
    pricingVariants: [buildPricingVariant(plan)],
    perks: (plan.perks ?? []).map((p) => ({
      id: randomUUID(),
      description: typeof p === "string" ? p : p.description,
    })),
    // free: cap lifetime reuse. Array + maxCount per the SDK schema (PurchaseLimit[]); the
    // recipe's older `{ type, count }` object form predates it.
    ...(free ? { purchaseLimits: [{ type: "PER_MEMBER_LIFETIME", maxCount: 1 }] } : {}),
  };
}

// ---- operations ----------------------------------------------------------------------------------

// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installPricingPlansApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: PRICING_PLANS_APP_ID, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}

// Create the plan(s) — Plans V3 has NO bulk-create: one POST per plan. Keep plan.id: the
// frontend orders by it AND it is the coverage externalId.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan.md
export async function createPlans(ctx, plans) {
  const out = [];
  for (const plan of plans) {
    const r = await req(ctx, "/pricing-plans/v3/plans", { body: { plan: buildPlan(plan) } });
    out.push({
      id: r.plan?.id,
      slug: r.plan?.slug,
      name: plan.name,
      coveredServiceIds: plan.coveredServiceIds,
    });
  }
  return out;
}

// ---- bookings coverage via Benefit Programs (SKIP when no bookings in the run) -------------------
// Strictly ordered: plan.id -> programDefinition.id -> itemSetId -> items. Do NOT parallelize.

// 2a: READ the auto-created program definition (the Plans app creates it; you never create
// it). Provisioning is ~immediate but async — retry ONCE after a short backoff, don't loop.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/introduction.md
export async function getProgramDefinition(ctx, planId) {
  const path = `/benefit-programs/v1/program-definitions/by-namespace-and-external-id?externalId=${planId}&namespace=${encodeURIComponent(PP_NAMESPACE)}`;
  try {
    const r = await req(ctx, path, { method: "GET" });
    if (r.programDefinition?.id) return r.programDefinition.id;
  } catch {
    /* fall through to the single insurance retry */
  }
  await sleep(1000);
  const r = await req(ctx, path, { method: "GET" });
  return r.programDefinition?.id;
}

// 2b: create ONE pool definition with EXACTLY ONE benefit naming Bookings as the provider.
// price "0" = unlimited (default; no creditConfiguration). Limited pack: pass creditAmount →
// price "1" + details.creditConfiguration (a SIBLING of benefits[], NOT inside a benefit —
// nesting it 400s with "Price should be 0 when credit pool is not set up").
// docs: https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pool-definitions/create-pool-definition.md
export async function createPoolDefinition(ctx, programDefinitionId, { creditAmount } = {}) {
  const limited = creditAmount != null;
  const details = {
    ...(limited ? { creditConfiguration: { amount: String(creditAmount) } } : {}),
    benefits: [
      {
        benefitKey: randomUUID(),
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

// 2c: bulk-create the benefit items — ONE item per covered service (externalId = bookings
// service id). Up to 100 per call; category is an empty string; namespace/providerAppId
// repeat 2b's values.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/items/bulk-create-items.md
export async function createBenefitItems(ctx, itemSetId, serviceIds) {
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
 * Wire a plan to COVER bookings services (per plan). Runs 2a → 2b → 2c in order.
 * serviceIds come from the BOOKINGS seed — seed bookings first.
 */
export async function attachBookingsCoverage(ctx, planId, serviceIds, { creditAmount } = {}) {
  const programDefinitionId = await getProgramDefinition(ctx, planId);
  if (!programDefinitionId) throw new Error(`No program definition for plan ${planId} — is the Pricing Plans app installed?`);
  const itemSetId = await createPoolDefinition(ctx, programDefinitionId, { creditAmount });
  await createBenefitItems(ctx, itemSetId, serviceIds);
  return { itemSetId, serviceIds };
}

/**
 * ONE-CALL seed: install → create plans (ids kept in memory) → per covering plan, wire
 * bookings coverage (2a → 2b → 2c, strictly ordered). The default path.
 */
export async function setupPricingPlans(ctx, { plans = [] } = {}) {
  await installPricingPlansApp(ctx);
  const created = await createPlans(ctx, plans);
  const coverageAttached = [];
  for (let i = 0; i < created.length; i++) {
    const cov = plans[i].bookingsCoverage || {};
    const serviceIds = cov.serviceIds || created[i].coveredServiceIds;
    if (!serviceIds?.length) continue; // plans-only plan — coverage skipped
    const r = await attachBookingsCoverage(ctx, created[i].id, serviceIds, { creditAmount: cov.creditAmount });
    coverageAttached.push({ planId: created[i].id, ...r });
  }
  return {
    plans: created,
    coverageAttached,
    benefitsCreated: coverageAttached.reduce((n, c) => n + c.serviceIds.length, 0),
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-pricing-plans.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupPricingPlans(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
