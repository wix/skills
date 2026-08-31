// Rentals seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// A DELTA on seed-bookings.js: Wix Rentals has no APIs of its own, so a rental is a Bookings
// service carrying rentals-specific field values. Everything about the transport, images and
// error handling is the same; only the create order and the service payload differ.
//
// **NOT yet live-verified — transcribed from the Rentals ↔ Bookings API mapping and
// wix-headless/references/inline-recipes/setup-rentals.md, which WAS run end to end.**
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/bookings/seed/seed-rentals.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//
//   await seed.installRentalsApp(ctx);          // installs Rentals — do NOT also install Bookings
//
//   // ORDER IS LOAD-BEARING: resource type → resources → services.
//   const type = await seed.createResourceType(ctx, "Meeting rooms");
//   await seed.createResources(ctx, type.id, ["Room A", "Room B"]);   // capacity = MORE RESOURCES
//   await seed.createRentals(ctx, [
//     { name: "Meeting room, hourly", description: "…", price: 25,
//       resourceTypeId: type.id, unit: "HOUR", min: 60, max: 480 },
//     { name: "Meeting room, daily",  description: "…", price: 180,
//       resourceTypeId: type.id, unit: "DAY",  min: 1,  max: 5 },
//   ]);
//
// ⚠️ THREE THINGS THAT SILENTLY BREAK A RENTAL, all handled below:
//   1. `appId` is IMMUTABLE after create. A service created without it is a plain Bookings
//      service forever — there is no update that turns it into a rental.
//   2. Resources must exist BEFORE the service. A service whose resource type holds no
//      resources has permanently empty availability, with no error anywhere.
//   3. Rental services do NOT use categories. Unlike bookings, do not create or assign one.
//
// Images and the app-install helper are reused from seed-bookings.js — require both.
// Source recipe (authoritative): wix-headless/references/inline-recipes/setup-rentals.md.

const API = "https://www.wixapis.com";

/** The Wix Rentals app. Installing it provisions the Bookings infrastructure it runs on. */
const RENTALS_APP_ID = "ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e";

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

/**
 * Install Wix Rentals. Idempotent.
 * ⚠️ Install Rentals ONLY. It provisions the Bookings infrastructure automatically, so also
 * installing Wix Bookings is redundant.
 */
async function installRentalsApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", {
      body: {
        tenant: { tenantType: "SITE", id: ctx.siteId },
        appInstance: { appDefId: RENTALS_APP_ID, enabled: true },
      },
    });
  } catch {
    /* already installed is fine */
  }
}

/**
 * A resource TYPE — the kind of thing being rented ("Meeting rooms", "Vans", "Cameras").
 * A rental service points at one of these; the individual rentable items live inside it.
 * @returns {Promise<{ id: string, name: string }>}
 */
async function createResourceType(ctx, name) {
  const res = await req(ctx, "/bookings/v2/resources/resource-types", { body: { resourceType: { name } } });
  const type = res?.resourceType ?? {};
  return { id: type.id ?? type._id, name: type.name ?? name };
}

/** Existing resource types, so a re-run reuses one instead of making a duplicate. */
async function queryResourceTypes(ctx) {
  const res = await req(ctx, "/bookings/v2/resources/resource-types/query", { body: { query: {} } });
  return (res?.resourceTypes ?? []).map((t) => ({ id: t.id ?? t._id, name: t.name }));
}

/** Get a resource type by name, creating it only if it isn't there. Additive. */
async function ensureResourceType(ctx, name) {
  const existing = (await queryResourceTypes(ctx)).find((t) => t.name === name);
  return existing ?? createResourceType(ctx, name);
}

/**
 * The individual rentable items inside a type — Room A, Room B, Van 1.
 *
 * ⚠️ PARALLEL CAPACITY COMES FROM MORE RESOURCES, not from a capacity number: two rooms that
 * can be booked at the same time are two resources.
 *
 * ⚠️ Seeded 24/7 on purpose — no `workingHoursSchedules`. A resource with working hours makes a
 * multi-day rental span several bookable windows, which Wix then models as a multi-service
 * group booking instead of one booking. Pass `workingHours` only when the brief names opening
 * hours and you accept that.
 * @returns {Promise<{ id: string, name: string }[]>}
 */
async function createResources(ctx, resourceTypeId, names, { workingHours } = {}) {
  const out = [];
  for (const name of names) {
    const res = await req(ctx, "/bookings/v2/resources", {
      body: {
        resource: {
          name,
          resourceType: { id: resourceTypeId },
          ...(workingHours ? { workingHoursSchedules: workingHours } : {}),
        },
      },
    });
    const r = res?.resource ?? {};
    out.push({ id: r.id ?? r._id, name: r.name ?? name });
  }
  return out;
}

/**
 * Build one rental service payload.
 *
 * Field values that MAKE it a rental (all four are required together):
 *   type: "APPOINTMENT"          — rentals are always appointment-typed
 *   appId: RENTALS_APP_ID        — immutable after create
 *   durationRange                — replaces sessionDurations; the two are mutually exclusive
 *   serviceResources +           — which resource type supplies availability
 *   primaryResourceType
 *
 * Hourly bounds are MINUTES (30–1440); daily bounds are DAYS (1–8). One service = one unit
 * type: to rent the same room by the hour AND by the day, create two services.
 */
function buildRental(s) {
  const unit = s.unit === "DAY" ? "DAY" : "HOUR";
  const durationRange =
    unit === "DAY"
      ? { unitType: "DAY", dayOptions: { minDurationInDays: s.min ?? 1, maxDurationInDays: s.max ?? 5 } }
      : { unitType: "HOUR", hourOptions: { minDurationInMinutes: s.min ?? 60, maxDurationInMinutes: s.max ?? 480 } };

  return {
    type: "APPOINTMENT",
    appId: RENTALS_APP_ID,
    name: s.name,
    description: s.description ?? "",
    ...(s.tagLine ? { tagLine: s.tagLine } : {}),
    hidden: false,
    // A rental is priced as a RATE per unit of time — the number below is per hour or per day,
    // and Wix multiplies it by the length the customer picks.
    payment: {
      rateType: "FIXED",
      fixed: { price: { value: String(s.price ?? 0), currency: s.currency ?? "USD" } },
      options: { online: true, inPerson: false },
    },
    schedule: { availabilityConstraints: { durationRange } },
    // Without serviceResources the create fails MISSING_APPOINTMENT_RESOURCES, and the error
    // text sends you to check the resource type's contents — a dead end, since it fails even
    // when the type is fully populated. The docs' Create Service parameter list omits it.
    serviceResources: [{ resourceType: { id: s.resourceTypeId } }],
    primaryResourceType: { id: s.resourceTypeId },
    locations: [{ type: "BUSINESS" }],
  };
}

/**
 * Create rental services. Additive — an existing service with the same name is left alone.
 * @returns {Promise<{ id: string, name: string, unit: string, revision: string }[]>}
 */
async function createRentals(ctx, rentals) {
  const existing = await req(ctx, "/bookings/v2/services/query", {
    body: { query: { filter: { appId: RENTALS_APP_ID } } },
  }).catch(() => ({ services: [] }));
  const byName = new Map((existing.services ?? []).map((s) => [s.name, s]));

  const out = [];
  for (const spec of rentals) {
    const already = byName.get(spec.name);
    if (already) {
      out.push({
        id: already.id ?? already._id,
        name: already.name,
        unit: already.schedule?.availabilityConstraints?.durationRange?.unitType ?? null,
        revision: already.revision,
        created: false,
      });
      continue;
    }
    const res = await req(ctx, "/bookings/v2/services", { body: { service: buildRental(spec) } });
    const svc = res?.service ?? {};
    out.push({
      id: svc.id ?? svc._id,
      name: svc.name ?? spec.name,
      unit: svc.schedule?.availabilityConstraints?.durationRange?.unitType ?? null,
      revision: svc.revision,
      created: true,
    });
  }
  return out;
}

/**
 * Read the rentals back and confirm each one is actually a rental. A service created without
 * `appId` or without `durationRange` still returns 200 — it is simply a plain Bookings service
 * from then on, permanently, and this is the only check that catches it.
 * @returns {Promise<{ ok: boolean, problems: string[] }>}
 */
async function verifyRentals(ctx, expectedNames) {
  const res = await req(ctx, "/bookings/v2/services/query", {
    body: { query: { filter: { appId: RENTALS_APP_ID } } },
  });
  const live = new Map((res?.services ?? []).map((s) => [s.name, s]));
  const problems = [];
  for (const name of expectedNames) {
    const svc = live.get(name);
    if (!svc) {
      problems.push(`${name}: not returned by an appId-filtered query — it was not created as a rental`);
      continue;
    }
    if (!svc.schedule?.availabilityConstraints?.durationRange) {
      problems.push(`${name}: no durationRange — created as a plain service, and appId is immutable`);
    }
    if (!svc.primaryResourceType?.id) problems.push(`${name}: no primaryResourceType — availability will be empty`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The whole rentals seed, in the one order that works.
 * @param {object} ctx
 * @param {{ resourceTypeName: string, resources: string[], rentals: object[] }} plan
 */
async function setupRentals(ctx, { resourceTypeName, resources = [], rentals = [] }) {
  await installRentalsApp(ctx);
  const type = await ensureResourceType(ctx, resourceTypeName);
  const created = await createResources(ctx, type.id, resources);
  const services = await createRentals(ctx, rentals.map((r) => ({ ...r, resourceTypeId: type.id })));
  const check = await verifyRentals(ctx, rentals.map((r) => r.name));
  return { resourceType: type, resources: created, services, ...check };
}

module.exports = {
  RENTALS_APP_ID,
  installRentalsApp,
  createResourceType,
  queryResourceTypes,
  ensureResourceType,
  createResources,
  buildRental,
  createRentals,
  verifyRentals,
  setupRentals,
};
