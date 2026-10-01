// Rentals seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/rentals/seed/seed-rentals.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Rentals app AND the Wix Bookings app
// if needed (an hourly rental with more than one resource answers availability with 401 "Booking app
// not installed" on a Rentals-only site; verified live), creates the
// resource types (idempotent by name) and their resources (idempotent by name within a type; no
// working hours = bookable 24/7, which keeps a multi-day rental to ONE booking), creates the rental
// services ONE AT A TIME with the five values that make a Bookings service a rental (the Rentals
// app id, serviceResources + primaryResourceType, the Rentals form, a duration range), re-reads the
// first one to confirm the range landed, and imports+attaches images. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "currency"?,
//     "resourceTypes": [{ "name": "Kayaks", "resources": ["Kayak 1", "Kayak 2"] }],
//     "rentals": [{ "name", "description", "tagLine"?, "unit": "HOUR"|"DAY", "rate": 25, "min"?, "max"?,
//                   "resourceType": "Kayaks", "resources"?: ["Kayak 1"], "free"?, "requireManualApproval"?,
//                   "imageUrl"? | "imagePath"? | "imagePrompt"? }] }
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Unexpected shapes →
// read the live API reference; every call below carries a docs: line with its reference page.
import { setSiteCurrency } from "../../shared/seed/site.mjs";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";
import { seedSiteId } from "../../shared/seed/site-context.mjs";
import { wixToken } from "../../shared/seed/wix-cli.mjs";

const API = "https://www.wixapis.com";
/** The Wix Rentals app: the service's immutable appId, the catalog filter, the cart's appId. */
export const RENTALS_APP_ID = "ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e";
/** The Rentals default booking form, provisioned by the install with the same id on every site. */
export const RENTALS_FORM_ID = "3a2ea2ce-91f4-4617-ab24-629933c0c31a";
/** The Wix Bookings app: the availability engine behind multi-resource hourly rentals. */
export const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

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
    headers: { Authorization: `Bearer ${ctx.token}`, "wix-site-id": ctx.siteId, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const money = (n, currency) => ({ value: Number(n).toFixed(2), currency: currency ?? "USD" });

// plain rental -> flat Services V2 create object carrying the five rentals values.
//   unit HOUR: min/max in HOURS (0.5 to 24; stored as minutes 30–1440); unit DAY: min/max in DAYS (1–8).
//   rate: per unit; free -> NO_FEE paid in person (the API needs one payment option true).
export function buildRental(r, { resourceTypeId, resourceIds, currency }) {
  if (!resourceTypeId) throw new Error(`rental "${r.name}" names no resource type`);
  if (!resourceIds?.length) throw new Error(`rental "${r.name}": its resource type holds no resources — availability would be permanently empty`);
  const unit = String(r.unit ?? "HOUR").toUpperCase();
  if (unit !== "HOUR" && unit !== "DAY") throw new Error(`rental "${r.name}": unit must be HOUR or DAY`);
  let durationRange;
  if (unit === "DAY") {
    const min = Math.max(1, Math.floor(Number(r.min ?? 1)));
    const max = Math.min(8, Math.max(min, Math.floor(Number(r.max ?? 5))));
    durationRange = { unitType: "DAY", dayOptions: { minDurationInDays: min, maxDurationInDays: max } };
  } else {
    const min = Math.max(30, Math.round(Number(r.min ?? 1) * 60));
    const max = Math.min(1440, Math.max(min, Math.round(Number(r.max ?? 8) * 60)));
    durationRange = { unitType: "HOUR", hourOptions: { minDurationInMinutes: min, maxDurationInMinutes: max } };
  }
  const free = r.free === true || r.rate == null || Number(r.rate) === 0;
  const payment = free
    ? { rateType: "NO_FEE", options: { online: false, inPerson: true } }
    : { rateType: "FIXED", fixed: { price: money(r.rate, currency) }, options: { online: true, inPerson: false } };
  return {
    type: "APPOINTMENT",
    appId: RENTALS_APP_ID, // immutable: a service created without it is a plain Bookings service forever
    name: r.name,
    description: r.description,
    tagLine: r.tagLine,
    defaultCapacity: 1, // one customer per resource at a time; parallel capacity = more resources
    serviceResources: [{ resourceType: { id: resourceTypeId }, resourceIds: { values: resourceIds.slice(0, 100) } }],
    primaryResourceType: resourceTypeId, // availability from the resources, not from staff
    form: { id: RENTALS_FORM_ID },
    onlineBooking: { enabled: true, requireManualApproval: r.requireManualApproval === true, allowMultipleRequests: false },
    schedule: { availabilityConstraints: { durationRange } }, // never with sessionDurations or workingHours
    payment,
    locations: [{ type: "BUSINESS" }],
    // no category (rentals surface through the appId-filtered read), no staffMemberIds (resource-driven)
  };
}

// ---- operations ----------------------------------------------------------------------------------

// Both apps: Rentals owns the services and the dashboard; Bookings is the availability engine. On a
// site with Rentals alone, List Availability Time Slots answers 401 "Booking app not installed / No MS
// context" for an HOURLY rental whose service lists more than one resource (a single-resource hourly
// rental and every daily rental work without it). Installing Bookings fixes it; verified live.
// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installRentalsApp(ctx) {
  for (const appDefId of [RENTALS_APP_ID, BOOKINGS_APP_ID]) {
    try {
      await req(ctx, "/apps-installer-service/v1/app-instance/install", {
        body: { tenant: { tenantType: "SITE", id: ctx.siteId }, appInstance: { appDefId, enabled: true } },
      });
    } catch {
      /* already installed is fine */
    }
  }
}

// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resource-types-v2/query-resource-types.md
export async function queryResourceTypes(ctx) {
  const r = await req(ctx, "/bookings/v2/resources/resource-types/query", { body: { query: { cursorPaging: { limit: 100 } } } });
  return (r.resourceTypes ?? []).map((t) => ({ id: t.id, name: t.name }));
}

// Resource types by name — idempotent (an existing name is reused; a 409 on create re-reads).
// `name` is required, max 40 characters, unique per site.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resource-types-v2/create-resource-type.md
export async function createResourceTypes(ctx, names) {
  const byName = new Map((await queryResourceTypes(ctx)).map((t) => [t.name, t]));
  for (const name of names) {
    if (byName.has(name)) continue;
    try {
      const r = await req(ctx, "/bookings/v2/resources/resource-types", { body: { resourceType: { name: String(name).slice(0, 40) } } });
      byName.set(name, { id: r.resourceType?.id, name });
    } catch (e) {
      if (e.status !== 409) throw e;
      const fresh = (await queryResourceTypes(ctx)).find((t) => t.name === name);
      if (!fresh) throw e;
      byName.set(name, fresh);
    }
  }
  return names.map((n) => byName.get(n));
}

// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resources-v2/query-resources.md
export async function queryResources(ctx, typeId) {
  const r = await req(ctx, "/bookings/v2/resources/query", { body: { query: { filter: { typeId }, cursorPaging: { limit: 100 } } } });
  return (r.resources ?? []).map((x) => ({ id: x.id, name: x.name, typeId: x.typeId ?? typeId }));
}

// Resources of one type by name — idempotent. No workingHoursSchedules: bookable 24/7, so a multi-day
// daily rental stays ONE booking (working hours split it into one booking per day — dashboard work).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resources-v2/create-resource.md
export async function createResources(ctx, typeId, names) {
  const byName = new Map((await queryResources(ctx, typeId)).map((x) => [x.name, x]));
  for (const name of names) {
    if (byName.has(name)) continue;
    const r = await req(ctx, "/bookings/v2/resources", { body: { resource: { name, typeId } } });
    byName.set(name, { id: r.resource?.id, name, typeId });
  }
  return names.map((n) => byName.get(n));
}

// ONE service per call. The bulk endpoint tags the schedule with the Bookings app id, which hides every
// booking from the Rentals calendar — never use it here. A failed create is retried once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/create-service.md
export async function createRental(ctx, service) {
  let r;
  try {
    r = await req(ctx, "/bookings/v2/services", { body: { service } });
  } catch (e) {
    await sleep(1500);
    r = await req(ctx, "/bookings/v2/services", { body: { service } });
  }
  const item = r.service ?? {};
  return {
    id: item.id,
    slug: item.mainSlug?.name ?? slugify(item.name ?? service.name),
    revision: item.revision,
    scheduleId: item.schedule?.id,
    unit: item.schedule?.availabilityConstraints?.durationRange?.unitType ?? null,
  };
}

// Every rental the site holds (the Rentals app's services), for the pre-existing report: a fresh
// Rentals install adds its own sample ("Conference room", $45/hour), and the live listing shows it
// next to the owner's rentals. Reported, never touched: this seed deletes nothing on a site, ever.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
export async function readRentals(ctx) {
  const r = await req(ctx, "/bookings/v2/services/query", { body: { query: { filter: { appId: RENTALS_APP_ID }, paging: { limit: 100 } } } });
  return (r.services ?? []).map((s) => ({ id: s.id, name: s.name, slug: s.mainSlug?.name ?? slugify(s.name) }));
}

// The range is a newer field; a silently dropped one yields a service that books as a fixed slot.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/get-service.md
export async function confirmDurationRange(ctx, serviceId) {
  const r = await req(ctx, `/bookings/v2/services/${serviceId}`, { method: "GET" });
  return r.service?.schedule?.availabilityConstraints?.durationRange?.unitType ?? null;
}

export { importImage } from "../../shared/seed/images.mjs";

// Writes under media.mainMedia + media.coverMedia (writing media.image 200s but silently drops).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service.md
export async function attachRentalImage(ctx, it) {
  return req(ctx, `/bookings/v2/services/${it.serviceId}`, {
    method: "PATCH",
    body: { service: { id: it.serviceId, revision: it.revision, media: { mainMedia: { image: it.image }, coverMedia: { image: it.image } } } },
  });
}

/**
 * ONE-CALL seed: install → resource types → resources → services one at a time → confirm the range →
 * images, ids threaded in memory. The default path.
 */
export async function setupRentals(ctx, { resourceTypes = [], rentals = [], currency } = {}) {
  // Before any service exists: a service's rate is stored in the site currency.
  if (currency) await setSiteCurrency(ctx, currency);
  await installRentalsApp(ctx);

  const typeNames = [...new Set([...resourceTypes.map((t) => t.name), ...rentals.map((r) => r.resourceType)].filter(Boolean))];
  if (!typeNames.length) throw new Error("the plan names no resource types — a rental needs the things it rents");
  const types = await createResourceTypes(ctx, typeNames);
  const typeByName = new Map(types.map((t) => [t.name, t]));

  const resourcesByType = new Map();
  for (const t of resourceTypes) {
    const type = typeByName.get(t.name);
    const names = [...new Set((t.resources ?? []).filter(Boolean))];
    resourcesByType.set(t.name, names.length ? await createResources(ctx, type.id, names) : await queryResources(ctx, type.id));
  }
  for (const name of typeNames) if (!resourcesByType.has(name)) resourcesByType.set(name, await queryResources(ctx, typeByName.get(name).id));

  const created = [];
  const errors = [];
  for (const r of rentals) {
    const type = typeByName.get(r.resourceType);
    const pool = resourcesByType.get(r.resourceType) ?? [];
    const chosen = Array.isArray(r.resources) && r.resources.length ? pool.filter((x) => r.resources.includes(x.name)) : pool;
    try {
      created.push(await createRental(ctx, buildRental(r, { resourceTypeId: type?.id, resourceIds: chosen.map((x) => x.id), currency })));
    } catch (e) {
      errors.push(`${r.name}: ${e.message}`);
      created.push(null);
    }
  }

  const first = created.find(Boolean);
  const durationRangeConfirmed = first ? await confirmDurationRange(ctx, first.id) : null;

  // What the site lists that this run did not create and the plan does not name (the install's own
  // sample, an earlier seed, the owner's work). The closing message names it with the dashboard link.
  const createdIds = new Set(created.filter(Boolean).map((c) => c.id));
  const planNames = new Set(rentals.map((r) => r.name));
  let preexisting = [];
  try {
    preexisting = (await readRentals(ctx)).filter((s) => !createdIds.has(s.id) && !planNames.has(s.name));
  } catch (e) {
    console.error(`rentals read failed (skipping the pre-existing check): ${String(e.message).slice(0, 120)}`);
  }

  // Pass 2 — images: resolve (import by url / generate by prompt) in one parallel wave, then attach.
  // Failures leave the rental text-only; the seed's exit never depends on images.
  const files = await resolveItemImages(ctx, created.map((c, i) => ({
    url: rentals[i]?.imageUrl,
    path: rentals[i]?.imagePath,
    prompt: rentals[i]?.imagePrompt,
    displayName: `${c?.slug || "rental"}.png`,
  })));
  let imagesAttached = 0;
  for (let i = 0; i < created.length; i++) {
    if (!files[i] || !created[i]?.id) continue;
    try {
      await attachRentalImage(ctx, { serviceId: created[i].id, revision: created[i].revision, image: { id: files[i].id, url: files[i].url, width: 1024, height: 1024 } });
      imagesAttached++;
    } catch {
      /* never block on image failure — the rental stays text-only */
    }
  }

  return {
    rentals: created.filter(Boolean),
    resourceTypes: types.map((t) => ({ ...t, resources: resourcesByType.get(t.name) ?? [] })),
    durationRangeConfirmed,
    preexisting,
    errors,
    imagesAttached,
    dashboardUrl: `https://manage.wix.com/dashboard/${ctx.siteId}/rentals`,
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-rentals.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupRentals(ctx, plan)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length || (result.rentals.length && !result.durationRangeConfirmed)) process.exit(1);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
