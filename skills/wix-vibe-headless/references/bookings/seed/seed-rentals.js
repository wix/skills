// Rentals seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// A DELTA on seed-bookings.js: Wix Rentals has no APIs of its own, so a rental is a Bookings
// service carrying rentals-specific field values. Everything about the transport, images and
// error handling is the same; only the create order and the service payload differ.
//
// Live-verified end to end on fresh headless sites (install → resource type → resources → service →
// time-slots → end-options).
//
// Usage (build-time exec_tool) — prefer `setupRentals`, which runs the whole flow in the one order
// that works and threads the resource ids into each service for you:
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/bookings/seed/seed-rentals.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//   await seed.setupRentals(ctx, {
//     resourceTypeName: "Meeting rooms",
//     resources: ["Room A", "Room B"],                              // capacity = MORE RESOURCES
//     rentals: [
//       { name: "Meeting room, hourly", description: "…", price: 25, unit: "HOUR", min: 60, max: 480 },
//       { name: "Meeting room, daily",  description: "…", price: 180, unit: "DAY",  min: 1,  max: 5 },
//     ],
//   });
//   // Calling the steps by hand instead? ORDER IS LOAD-BEARING (resource type → resources → service),
//   // and each rental spec must carry `resourceTypeId` AND `resourceIds` (the ids from createResources).
//
// What a bookable rental needs, and setupRentals sets every one:
//   1. `appId` on the service at create time (it is immutable, so set it here rather than later).
//   2. Resources created before the service, and their ids listed in `serviceResources[].resourceIds`.
//   3. No category — a rental is surfaced by its `appId`, not by a Bookings category.
//
// Images are reused from seed-bookings.js — require both.
// Source recipe: wix-headless/references/inline-recipes/setup-rentals.md.

const API = "https://www.wixapis.com";

/** The Wix Rentals app — adds resource types and duration ranges on top of Bookings. */
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
 * Install Wix Rentals. Idempotent. Rentals provisions the Bookings infrastructure it runs on, so a
 * rental's availability comes from a Rentals-only install — Wix Bookings does not need to be added.
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
          // Link the resource to its type with a top-level `typeId` (a bare GUID).
          typeId: resourceTypeId,
          ...(workingHours ? { workingHoursSchedules: workingHours } : {}),
        },
      },
    });
    const r = res?.resource ?? {};
    out.push({ id: r.id ?? r._id, name: r.name ?? name });
  }
  return out;
}

/** The Wix Rentals default booking form. Provisioned by the Rentals app; the id is the same on every site. */
const RENTALS_FORM_ID = "3a2ea2ce-91f4-4617-ab24-629933c0c31a";

/**
 * Build one rental service payload.
 *
 * Field values that MAKE it a rental (all required together):
 *   type: "APPOINTMENT"          — rentals are always appointment-typed
 *   appId: RENTALS_APP_ID        — immutable after create
 *   durationRange                — replaces sessionDurations; the two are mutually exclusive
 *   serviceResources +           — which resource type AND which resources supply availability
 *   primaryResourceType
 *
 * Hourly bounds are MINUTES (30–1440); daily bounds are DAYS (1–8). One service = one unit
 * type: to rent the same room by the hour AND by the day, create two services.
 * @param {object} s  spec + `resourceTypeId` and `resourceIds` (the ids from createResources).
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
    defaultCapacity: 1,
    // Use the Wix Rentals default booking form so checkout collects contact details.
    form: { id: RENTALS_FORM_ID },
    // Make the rental bookable online.
    onlineBooking: { enabled: true, requireManualApproval: false, allowMultipleRequests: false },
    // A rental is priced as a RATE per unit of time — the number below is per hour or per day,
    // and Wix multiplies it by the length the customer picks.
    payment: {
      rateType: "FIXED",
      fixed: { price: { value: String(s.price ?? 0), currency: s.currency ?? "USD" } },
      options: { online: true, inPerson: false },
    },
    schedule: { availabilityConstraints: { durationRange } },
    // Name the resource type AND its concrete resource ids — availability comes from the listed ids.
    serviceResources: [{ resourceType: { id: s.resourceTypeId }, resourceIds: { values: s.resourceIds ?? [] } }],
    // The resource type as a bare GUID string, and one of the types named in serviceResources above.
    primaryResourceType: s.resourceTypeId,
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
    if (!svc.primaryResourceType) problems.push(`${name}: no primaryResourceType — availability will be empty`);
    if (!svc.serviceResources?.some((sr) => sr.resourceIds?.values?.length))
      problems.push(`${name}: serviceResources carry no resourceIds — availability will be empty`);
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
  // Every rental service must list the concrete resource ids, or its availability is empty (see buildRental).
  const resourceIds = created.map((c) => c.id);
  const services = await createRentals(ctx, rentals.map((r) => ({ ...r, resourceTypeId: type.id, resourceIds })));
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
