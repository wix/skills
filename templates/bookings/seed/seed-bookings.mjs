// Bookings seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/bookings/seed/seed-bookings.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Bookings app if needed,
// resolves the staff resources (polling — a fresh install provisions the owner async; extra staff
// named in the plan are created), creates extra business locations and booking policies the plan
// asks for, creates categories (idempotent by name) and services (bulk; APPOINTMENT + CLASS +
// COURSE mixed; FIXED / VARIED / CUSTOM / NO_FEE pricing, deposits, manual approval), schedules
// CLASS sessions and the weekly recurring sessions of classes and courses, and imports+attaches
// images. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "currency"?, "staff"?: ["Name"], "locations"?: [{ "name", "timeZone", "address"? }],
//     "services": [{ "type": "APPOINTMENT"|"CLASS"|"COURSE", "name", "description", "tagLine"?,
//                    "price"? (number | { "from": number }), "priceText"?, "free"?, "deposit"?, "payInFull"?,
//                    "duration"? (APPOINTMENT, minutes), "capacity"?, "waitlist"?, "maxParticipants"?,
//                    "requireManualApproval"?, "conferencing"?, "staff"? (name | [names]), "location"? (name),
//                    "category"? (name), "imageUrl"? | "imagePath"? | "imagePrompt"?,
//                    "sessions"?: [{ "start", "end", "capacity"? }],            // CLASS: one-off sessions, local "YYYY-MM-DDThh:mm:ss"
//                    "weekly"?: { "days": ["MONDAY"], "time": "18:00", "duration": 60, "start", "end" } }] }  // CLASS or COURSE: recurring
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Unexpected shapes →
// read the live API reference; every call below carries a docs: line with its reference page.
import { setSiteCurrency } from "../../shared/seed/site.mjs";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";
import { seedSiteId } from "../../shared/seed/site-context.mjs";
import { wixToken } from "../../shared/seed/wix-cli.mjs";

const API = "https://www.wixapis.com";
const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const money = (n, currency) => ({ value: String(n), currency: currency ?? "USD" });

// plain service -> flat Services V2 create object.
//   price: number -> FIXED; { from } -> VARIED (defaultPrice); priceText -> CUSTOM; omitted / free -> NO_FEE.
//   deposit -> payment.options.deposit + the rate's deposit amount; payInFull -> fullUpfrontPaymentAllowed.
//   FIXED/VARIED pay online; CUSTOM/NO_FEE pay in person (the API needs one option true even for NO_FEE).
function buildService(s) {
  const isAppointment = s.type === "APPOINTMENT";
  const varied = s.price != null && typeof s.price === "object";
  const custom = !varied && typeof s.priceText === "string" && s.priceText.trim();
  const free = !varied && !custom && (s.free === true || s.price == null);
  const deposit = s.deposit != null && Number(s.deposit) > 0 ? { deposit: money(s.deposit, s.currency), fullUpfrontPaymentAllowed: s.payInFull === true } : {};
  let payment;
  if (free) payment = { rateType: "NO_FEE", options: { online: false, inPerson: true } };
  else if (custom) payment = { rateType: "CUSTOM", custom: { description: s.priceText.trim() }, options: { online: false, inPerson: true } };
  else if (varied) payment = { rateType: "VARIED", varied: { defaultPrice: money(s.price.from, s.currency), ...deposit }, options: { online: true, inPerson: false, deposit: !!deposit.deposit } };
  else payment = { rateType: "FIXED", fixed: { price: money(s.price, s.currency), ...deposit }, options: { online: true, inPerson: false, deposit: !!deposit.deposit } };
  const out = {
    type: s.type,
    name: s.name,
    description: s.description,
    tagLine: s.tagLine,
    defaultCapacity: s.capacity ?? (isAppointment ? 1 : undefined),
    onlineBooking: { enabled: true, requireManualApproval: s.requireManualApproval === true, allowMultipleRequests: false },
    payment,
    category: { id: s.categoryId }, // mandatory for live-site visibility
    // A named business location by id; otherwise the default business location. Never OWNER_BUSINESS on the services endpoint.
    locations: [s.locationId ? { type: "BUSINESS", business: { id: s.locationId } } : { type: "BUSINESS" }],
    ...(s.conferencing === true ? { conferencing: { enabled: true } } : {}),
    ...(s.bookingPolicyId ? { bookingPolicy: { id: s.bookingPolicyId } } : {}),
  };
  if (isAppointment) {
    out.schedule = { availabilityConstraints: { sessionDurations: [s.duration ?? 60] } }; // classes and courses: no sessionDurations
    out.staffMemberIds = s.staffMemberIds; // resourceId(s) — non-empty or MISSING_APPOINTMENT_RESOURCES
  }
  return out;
}

// ---- operations ----------------------------------------------------------------------------------

// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installBookingsApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: BOOKINGS_APP_ID, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}

// staffMemberIds takes resourceId, NOT the staff id.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/query-staff-members.md
export async function queryStaff(ctx) {
  const r = await req(ctx, "/bookings/v1/staff-members/query", {
    body: { query: {}, fields: ["RESOURCE_DETAILS"] },
  });
  return (r.staffMembers ?? []).map((m) => ({ resourceId: m.resourceId, id: m.id, name: m.name }));
}

// A fresh install provisions the default "Business Owner" resource ASYNC — poll until it lands.
export async function queryStaffWithRetry(ctx, { tries = 15, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const s = await queryStaff(ctx);
      if (s.length) return s;
    } catch (e) {
      lastErr = e;
    }
    if (i < tries - 1) await sleep(delayMs);
  }
  if (lastErr) throw lastErr;
  return [];
}

// Extra staff members by name — idempotent (an existing name is reused). The response carries the
// resourceId the services need; a missing one is polled from the query.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/create-staff-member.md
export async function createStaff(ctx, names, existing) {
  const byName = new Map(existing.map((m) => [m.name, m]));
  for (const name of names) {
    if (byName.has(name)) continue;
    const r = await req(ctx, "/bookings/v1/staff-members", { body: { staffMember: { name }, fields: ["RESOURCE_DETAILS"] } });
    const m = r.staffMember ?? {};
    byName.set(name, { id: m.id, name, resourceId: m.resourceId ?? m.resource?.id });
  }
  const missing = [...byName.values()].filter((m) => !m.resourceId);
  if (missing.length) {
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      const fresh = await queryStaff(ctx);
      for (const m of missing) m.resourceId = fresh.find((f) => f.id === m.id || f.name === m.name)?.resourceId;
      if (missing.every((m) => m.resourceId)) break;
    }
  }
  return [...byName.values()];
}

// Extra business locations by name — idempotent. `timeZone` is required by the API; the address is
// what the plan supplies (formattedAddress, city, country).
// docs: https://dev.wix.com/docs/api-reference/business-management/locations/list-locations.md
// docs: https://dev.wix.com/docs/api-reference/business-management/locations/create-location.md
export async function createLocations(ctx, locations) {
  const existing = await req(ctx, "/locations/v1/locations", { method: "GET" });
  const byName = new Map((existing.locations ?? []).map((l) => [l.name, { id: l.id, name: l.name, default: l.default === true }]));
  for (const loc of locations) {
    if (!loc?.name || byName.has(loc.name)) continue;
    if (!loc.timeZone) throw new Error(`location "${loc.name}" needs a timeZone (IANA, e.g. "Europe/Berlin")`);
    const r = await req(ctx, "/locations/v1/locations", { body: { location: { name: loc.name, timeZone: loc.timeZone, address: loc.address ?? { formattedAddress: loc.name } } } });
    byName.set(loc.name, { id: r.location?.id, name: loc.name, default: false });
  }
  return [...byName.values()];
}

// A booking policy per service that asks for a waitlist or a participants cap; the service references it by id.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policies/create-booking-policy.md
export async function createBookingPolicy(ctx, s) {
  const r = await req(ctx, "/bookings/v1/booking-policies", { body: { bookingPolicy: {
    name: `${s.name} policy`,
    ...(s.waitlist != null ? { waitlistPolicy: { enabled: true, capacity: Number(s.waitlist) } } : {}),
    ...(s.maxParticipants != null ? { participantsPolicy: { maxParticipantsPerBooking: Number(s.maxParticipants) } } : {}),
  } } });
  return r.bookingPolicy?.id;
}

// Every service needs a category.id or it's invisible on the live site. Idempotent by name.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/create-category.md
export async function createCategories(ctx, names) {
  const existing = await req(ctx, "/bookings/v2/categories/query", { body: { query: {} } });
  const byName = new Map((existing.categories ?? []).map((c) => [c.name, { id: c.id, name: c.name }]));
  const out = [];
  for (const name of names) {
    let cat = byName.get(name);
    if (!cat) {
      const r = await req(ctx, "/bookings/v2/categories", { body: { category: { name } } });
      cat = { id: r.category?.id, name };
      byName.set(name, cat);
    }
    out.push(cat);
  }
  return out;
}

// Bulk-create services (APPOINTMENT + CLASS + COURSE mixed). Run AFTER staff, locations, policies + categories.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-create-services.md
export async function createServices(ctx, services) {
  const body = { services: services.map(buildService), returnEntity: true };
  const r = await req(ctx, "/bookings/v2/bulk/services/create", { body });
  return (r.results ?? []).map((res, i) => {
    const item = res.item ?? {};
    return {
      id: item.id ?? res.itemMetadata?.id,
      slug: item.mainSlug?.name ?? slugify(item.name ?? services[i]?.name),
      revision: item.revision,
      type: item.type ?? services[i]?.type,
      scheduleId: item.schedule?.id,
      success: res.itemMetadata?.success ?? false,
      error: res.itemMetadata?.error,
    };
  });
}

// Calendar Events V3, bulk: one-off CLASS sessions and the weekly recurring (MASTER) sessions of
// classes and courses. start/end are LOCAL wall-clock "YYYY-MM-DDThh:mm:ss" (no Z), today-or-future.
// A recurring event repeats WEEKLY on ONE weekday (the API takes a single day per event) until `until`.
// docs: https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-create-event.md
// docs: https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/create-event.md
export async function scheduleEvents(ctx, events) {
  const body = {
    events: events.map((s) => ({
      event: {
        scheduleId: s.scheduleId,
        type: s.type ?? "CLASS",
        start: { localDate: s.start },
        end: { localDate: s.end },
        resources: [{ id: s.resourceId, permissionRole: "WRITER" }], // non-empty + WRITER, else UNKNOWN_ROLE
        ...(s.capacity != null ? { totalCapacity: s.capacity } : {}),
        ...(s.day ? { recurrenceRule: { frequency: "WEEKLY", interval: 1, days: [s.day], until: { localDate: s.until } } } : {}),
      },
    })),
  };
  const r = await req(ctx, "/calendar/v3/bulk/events/create", { body });
  return (r.results ?? []).map((res) => ({
    id: res.itemMetadata?.id,
    success: res.itemMetadata?.success ?? false,
    error: res.itemMetadata?.error,
  }));
}
export const scheduleClassSessions = scheduleEvents;

const pad2 = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// `weekly: { days, time, duration, start, end }` → one MASTER event per weekday, starting on the first
// such weekday on/after `start`, repeating until the end of `end`.
export function weeklyEvents(plan, { scheduleId, resourceId, type }) {
  const w = plan.weekly;
  if (!w || !Array.isArray(w.days) || !w.days.length || !w.start || !w.end) return [];
  const [hh, mm] = String(w.time ?? "09:00").split(":").map(Number);
  const minutes = Number(w.duration ?? 60);
  return w.days.map((day) => {
    const wanted = WEEKDAYS.indexOf(String(day).toUpperCase());
    if (wanted < 0) throw new Error(`weekly.days: unknown weekday "${day}"`);
    const first = new Date(`${w.start}T00:00:00`);
    while (first.getDay() !== wanted) first.setDate(first.getDate() + 1);
    const startAt = new Date(first.getFullYear(), first.getMonth(), first.getDate(), hh || 0, mm || 0);
    const endAt = new Date(startAt.getTime() + minutes * 60_000);
    const fmt = (d) => `${localDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
    return { scheduleId, resourceId, type, start: fmt(startAt), end: fmt(endAt), day: String(day).toUpperCase(), until: `${w.end}T23:59:59`, capacity: plan.capacity };
  });
}

// Bookings binds a service image by Wix Media file ID — an external url must be imported
// first; a plan `imagePrompt` is generated (Wix AI, 1 credit) then imported. Both live in the
// shared util (parallel, resilient, never blocks the seed).
export { importImage } from "../../shared/seed/images.mjs";

// Writes under media.mainMedia + media.coverMedia (writing media.image 200s but silently drops).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service.md
export async function attachServiceImage(ctx, it) {
  return req(ctx, `/bookings/v2/services/${it.serviceId}`, {
    method: "PATCH",
    body: {
      service: {
        id: it.serviceId,
        revision: it.revision,
        media: { mainMedia: { image: it.image }, coverMedia: { image: it.image } },
      },
    },
  });
}

/**
 * ONE-CALL seed: install → resolve staff (poll) + extra staff → extra locations → policies →
 * categories → services → CLASS sessions + weekly recurring sessions → images, ids threaded in
 * memory. The default path.
 */
export async function setupBookings(ctx, { services = [], staff = [], locations = [], staffResourceId, currency } = {}) {
  // Before any service exists: a service's price is stored in the site currency.
  if (currency) await setSiteCurrency(ctx, currency);
  await installBookingsApp(ctx);

  let allStaff = await queryStaffWithRetry(ctx);
  const wantedStaff = [...new Set([...staff, ...services.flatMap((s) => (Array.isArray(s.staff) ? s.staff : s.staff ? [s.staff] : []))].filter(Boolean))];
  if (wantedStaff.length) allStaff = await createStaff(ctx, wantedStaff, allStaff);
  const resourceId = staffResourceId ?? allStaff[0]?.resourceId;
  if (!resourceId) throw new Error("No staff resource resolved — Bookings provisioning may still be in progress; re-run the seed.");
  const resourceByName = new Map(allStaff.map((m) => [m.name, m.resourceId]));
  const staffIdsFor = (s) => {
    const names = Array.isArray(s.staff) ? s.staff : s.staff ? [s.staff] : [];
    const ids = names.map((n) => resourceByName.get(n)).filter(Boolean);
    return ids.length ? ids : [resourceId];
  };

  const allLocations = locations.length ? await createLocations(ctx, locations) : [];
  const locationByName = new Map(allLocations.map((l) => [l.name, l.id]));
  for (const s of services) if (s.location && !locationByName.has(s.location)) throw new Error(`service "${s.name}" names location "${s.location}" — add it to the plan's "locations"`);

  const policyIds = new Map();
  for (const s of services) if (s.waitlist != null || s.maxParticipants != null) policyIds.set(s.name, await createBookingPolicy(ctx, s));

  const catNames = [...new Set(services.map((s) => s.category).filter(Boolean))];
  const cats = catNames.length ? await createCategories(ctx, catNames) : await createCategories(ctx, ["Services"]);
  const catIdByName = new Map(cats.map((c) => [c.name, c.id]));
  const defaultCatId = cats[0]?.id;

  const created = await createServices(ctx, services.map((s) => ({
    ...s,
    currency: s.currency,
    categoryId: (s.category ? catIdByName.get(s.category) : undefined) ?? defaultCatId,
    locationId: s.location ? locationByName.get(s.location) : undefined,
    bookingPolicyId: policyIds.get(s.name),
    staffMemberIds: s.staffMemberIds ?? (s.type === "APPOINTMENT" ? staffIdsFor(s) : undefined),
  })));

  const events = [];
  created.forEach((c, i) => {
    const plan = services[i];
    if (!c.scheduleId || !plan) return;
    const staffResource = staffIdsFor(plan)[0];
    if (c.type === "CLASS" && Array.isArray(plan.sessions)) {
      for (const ses of plan.sessions) events.push({ scheduleId: c.scheduleId, resourceId: staffResource, type: "CLASS", start: ses.start, end: ses.end, capacity: ses.capacity ?? plan.capacity });
    }
    if (c.type === "CLASS" || c.type === "COURSE") events.push(...weeklyEvents(plan, { scheduleId: c.scheduleId, resourceId: staffResource, type: c.type }));
  });
  const scheduled = events.length ? await scheduleEvents(ctx, events) : [];

  // Pass 2 — images: resolve (import by url / generate by prompt) in one parallel wave, then
  // attach. Failures leave the service text-only; the seed's exit never depends on images.
  const files = await resolveItemImages(ctx, created.map((c, i) => ({
    url: services[i]?.imageUrl,
    path: services[i]?.imagePath,
    prompt: services[i]?.imagePrompt,
    displayName: `${c?.slug || "service"}.png`,
  })));
  let imagesAttached = 0;
  for (let i = 0; i < created.length; i++) {
    if (!files[i] || !created[i]?.id) continue;
    try {
      await attachServiceImage(ctx, {
        serviceId: created[i].id,
        revision: created[i].revision,
        image: { id: files[i].id, url: files[i].url, width: 1024, height: 1024 },
      });
      imagesAttached++;
    } catch {
      /* never block on image failure — the service stays text-only */
    }
  }

  return {
    services: created,
    categories: cats,
    staff: allStaff,
    locations: allLocations,
    resourceId,
    sessionsScheduled: scheduled.filter((s) => s.success).length,
    sessionErrors: scheduled.filter((s) => !s.success).map((s) => s.error).filter(Boolean),
    imagesAttached,
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-bookings.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupBookings(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
