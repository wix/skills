// Bookings seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Bookings
// request/response mechanics (the flat Services-V2 payload, the resourceId-vs-staff-id trap,
// the category-visibility invariant, the { event: {…} } session wrapper, the silent media.image
// drop) live here, once.
//
// **NOT yet live-verified — transcribed from setup-bookings.md.**
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44 (generic: use $TOKEN)
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/bookings/seed/seed-bookings.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//
//   await seed.installBookingsApp(ctx);                          // if the site doesn't have Wix Bookings yet
//
//   // ORDER MATTERS: resolve a staff resource (STEP 1) and a category (STEP 2) BEFORE services (STEP 3).
//   const staff = await seed.queryStaffWithRetry(ctx);           // polls: fresh install provisions the owner async
//   const resourceId = staff[0].resourceId;                      // NB: resourceId, NOT staff id
//   const cats = await seed.createCategories(ctx, ["Our Services"]);
//   const services = await seed.createServices(ctx, [
//     { type: "APPOINTMENT", name: "Consultation", description: "…", tagLine: "…",
//       price: 75, duration: 60, categoryId: cats[0].id, staffMemberIds: [resourceId] },
//     { type: "CLASS", name: "Morning Yoga", description: "…", capacity: 20,
//       price: 20, categoryId: cats[0].id },
//   ]);
//   // STEP 4 (CLASS only): needs each class's returned scheduleId.
//   await seed.scheduleClassSessions(ctx, services.filter(s => s.type === "CLASS").map(s => ({
//     scheduleId: s.scheduleId, resourceId, start: "2026-08-10T09:00:00", end: "2026-08-10T10:00:00", capacity: 20,
//   })));
//   // optional — import the image url to Wix Media first (bookings binds by file id), then patch (revision-checked).
//   // const file = await seed.importImage(ctx, imageUrl); // → { id, url } (Wix Media file id + wixstatic url)
//   // await seed.attachServiceImage(ctx, { serviceId: s.id, revision: s.revision, image: { id: file.id, url: file.url, width: 1024, height: 1024 } });
//
// If any call fails with a shape the caller didn't expect, or you need an operation this module
// doesn't cover, fall back to the wix-docs skill (search + read the live Wix API reference) —
// never guess. Source recipe (authoritative): wix-headless/references/inline-recipes/setup-bookings.md.

const API = "https://www.wixapis.com";
// Wix Bookings app id (from the recipe's "API surfaces" note).
const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

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

// name -> url slug fallback when item.mainSlug.name is absent (lowercase, non-alphanumerics -> hyphens, dedupe)
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// plain service -> flat Services V2 create object. price omitted / free:true -> NO_FEE.
// sessionDurations is APPOINTMENT-only; staffMemberIds is required-non-empty for APPOINTMENT, omitted for CLASS.
function buildService(s) {
  const isAppointment = s.type === "APPOINTMENT";
  const free = s.free === true || s.price == null;
  const out = {
    type: s.type,
    name: s.name,
    description: s.description,
    tagLine: s.tagLine,
    defaultCapacity: s.capacity ?? (isAppointment ? 1 : undefined), // required for ALL types
    onlineBooking: { enabled: true, requireManualApproval: false, allowMultipleRequests: false },
    payment: free
      ? { rateType: "NO_FEE", options: { online: false, inPerson: true } }
      : {
          rateType: "FIXED",
          fixed: { price: { value: String(s.price), currency: s.currency ?? "USD" } }, // value is a STRING; site currency wins
          options: { online: true, inPerson: false },
        },
    category: { id: s.categoryId }, // mandatory for live-site visibility
    locations: [{ type: "BUSINESS" }], // never OWNER_BUSINESS on the services endpoint
  };
  if (isAppointment) {
    out.schedule = { availabilityConstraints: { sessionDurations: [s.duration] } }; // APPOINTMENT only, minutes
    out.staffMemberIds = s.staffMemberIds; // resourceId(s) from STEP 1 — non-empty or MISSING_APPOINTMENT_RESOURCES
  }
  return out;
}

// ---- exported operations ----

async function installBookingsApp(ctx) {
  return req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
    tenant: { tenantType: "SITE", id: ctx.siteId },
    appInstance: { appDefId: BOOKINGS_APP_ID, enabled: true },
  } });
}

// The default "Business Owner" is a RESOURCE, not a service — it won't appear here.
async function listServices(ctx) {
  const r = await req(ctx, "/bookings/v2/services/query", { body: { query: { paging: { limit: 100 } } } });
  return (r.services ?? []).map((s) => ({ id: s.id, name: s.name }));
}

// STEP 1: resolve staff resources. Returns [{ resourceId, id, name }].
// ⚠️ staffMemberIds takes resourceId, NOT the staff id — read staffMember.resourceId.
async function queryStaff(ctx) {
  const r = await req(ctx, "/bookings/v1/staff-members/query", {
    body: { query: {}, fields: ["RESOURCE_DETAILS"] },
  });
  return (r.staffMembers ?? []).map((m) => ({ resourceId: m.resourceId, id: m.id, name: m.name }));
}

// installBookingsApp → provisioning is async (Wix signals completion via the App-Instance-Installed
// webhook, which an exec script can't receive). The default "Business Owner" resource isn't queryable
// in the same tick, so queryStaff returns [] (or throws "Business schedule not found") until it lands.
// Poll so the one-call path resolves the owner instead of failing APPOINTMENT services with
// MISSING_APPOINTMENT_RESOURCES. Already-provisioned sites return on the first try (no added latency).
async function queryStaffWithRetry(ctx, { tries = 10, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { const s = await queryStaff(ctx); if (s.length) return s; }
    catch (e) { lastErr = e; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  if (lastErr) throw lastErr; // never provisioned → surface the real error rather than a silent []
  return [];
}

// STEP 1 (optional): create named staff when the request names stylists/providers. staff: [{ name, description }].
// ⚠️ Omit email/phone unless you have a real value — V1 rejects empty strings. Returns [{ resourceId, id, name }].
async function createStaff(ctx, staff) {
  const out = [];
  for (const m of staff) {
    const body = { staffMember: { name: m.name, description: m.description } };
    const r = await req(ctx, "/bookings/v1/staff-members", { body });
    out.push({ resourceId: r.staffMember?.resourceId, id: r.staffMember?.id, name: r.staffMember?.name });
  }
  return out;
}

// STEP 2: query existing categories (to reuse one created earlier this run). Returns [{ id, name }].
async function queryCategories(ctx) {
  const r = await req(ctx, "/bookings/v2/categories/query", { body: { query: {} } });
  return (r.categories ?? []).map((c) => ({ id: c.id, name: c.name }));
}

// STEP 2: create categories — every service needs a category.id or it's invisible on the live site.
// Independent (no shared revision, unlike Stores categories); looped here one call per category.
async function createCategories(ctx, names) {
  // Reuse an existing same-named category instead of creating a duplicate. Bookings categories aren't
  // unique-by-name, so a re-run (or a partial-failure retry — categories are created before services)
  // would otherwise pile up dupes. Keeps the seed additive-but-idempotent.
  const byName = new Map((await queryCategories(ctx)).map((c) => [c.name, c]));
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

/**
 * STEP 3: bulk-create services (up to 100), one call. APPOINTMENT and CLASS may be mixed.
 * MUST run AFTER staff (STEP 1) and category (STEP 2) are resolved.
 * @param services [{ type:"APPOINTMENT"|"CLASS", name, description, tagLine?, categoryId,
 *   price?, currency?, free?, duration?(APPOINTMENT minutes), capacity?, staffMemberIds?(resourceIds, APPOINTMENT) }]
 * @returns [{ id, slug, revision, type, scheduleId, index, success, error }]
 *   scheduleId feeds scheduleClassSessions (CLASS); revision feeds attachServiceImage.
 *   Retry only the items where success===false, ONCE, with the same body — don't loop, don't re-create successes.
 */
async function createServices(ctx, services) {
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
      index: res.itemMetadata?.originalIndex ?? i,
      success: res.itemMetadata?.success ?? false,
      error: res.itemMetadata?.error,
    };
  });
}

/**
 * STEP 4 (CLASS only): schedule sessions in one bulk Calendar-Events-V3 call. Skip for APPOINTMENT.
 * @param sessions [{ scheduleId(CLASS item.schedule.id), resourceId(from STEP 1), start, end, capacity? }]
 *   start/end are LOCAL wall-clock "YYYY-MM-DDThh:mm:ss" (no Z), today-or-future.
 * @returns [{ id, index, success, error }]  — events send no returnEntity, so ids come from itemMetadata only.
 *   Retry only failed events once.
 */
async function scheduleClassSessions(ctx, sessions) {
  const body = {
    events: sessions.map((s) => ({
      event: {
        scheduleId: s.scheduleId,
        type: "CLASS",
        start: { localDate: s.start },
        end: { localDate: s.end },
        resources: [{ id: s.resourceId, permissionRole: "WRITER" }], // non-empty + WRITER, else UNKNOWN_ROLE 400
        ...(s.capacity != null ? { totalCapacity: s.capacity } : {}),
      },
    })),
  };
  const r = await req(ctx, "/calendar/v3/bulk/events/create", { body });
  return (r.results ?? []).map((res, i) => ({
    id: res.itemMetadata?.id,
    index: res.itemMetadata?.originalIndex ?? i,
    success: res.itemMetadata?.success ?? false,
    error: res.itemMetadata?.error,
  }));
}

// Fetch a service (for its current revision before an image patch, or to confirm an image landed).
async function getService(ctx, serviceId) {
  return req(ctx, `/bookings/v2/services/${serviceId}`, { method: "GET" });
}

/**
 * Import an external image URL into Wix Media → { id, url }. Bookings binds a service image by the
 * Wix Media file **id** (`mainMedia.image.id`), NOT a url — so an external url (e.g. a base44
 * generate_image result) MUST be imported first; the raw url as the id stores (200) but renders
 * nothing. `id` is the wixstatic file id (`<hash>~mv2.png`), `url` the permanent wixstatic url.
 */
async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

/**
 * Attach an image (optional). Writes under media.mainMedia + media.coverMedia; revision-checked.
 * @param it { serviceId, revision, image: { id, url, width, height } } — `image.id` MUST be a Wix
 *   Media file id (from importImage), never a raw external url.
 * ⚠️ Writing under media.image (not mainMedia/coverMedia) returns 200 but SILENTLY drops the image — a 200
 * is not proof; confirm with getService and check media.mainMedia is populated. Never block on failure.
 */
async function attachServiceImage(ctx, it) {
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
 * ONE-CALL seed: install → resolve staff → categories → services → CLASS sessions → images, in the
 * correct order, keeping ids in memory (no hand-threading of scheduleId/resourceId across exec
 * calls). DEFAULT path — call it once instead of the individual functions.
 *
 * @param plan {{
 *   services: [{ type:"APPOINTMENT"|"CLASS", name, description, tagLine?, price?, free?, duration?,
 *                capacity?, category?(name), staffMemberIds?,
 *                sessions?: [{ start, end, capacity? }],  // CLASS only; local "YYYY-MM-DDThh:mm:ss"
 *                imageUrl? }],                             // a plain image url; imported to Wix Media here, optional
 *   staffResourceId?: string,   // defaults to the fresh install's owner (queryStaff()[0].resourceId)
 * }}
 * @returns { services:[...createServices], categories:[{id,name}], resourceId, sessionsScheduled, imagesAttached }
 */
async function setupBookings(ctx, { services = [], staffResourceId } = {}) {
  await installBookingsApp(ctx);

  let resourceId = staffResourceId;
  if (!resourceId) {
    const staff = await queryStaffWithRetry(ctx); // fresh install provisions the default owner async — poll
    resourceId = staff[0]?.resourceId;
  }

  const catNames = [...new Set(services.map((s) => s.category).filter(Boolean))];
  const cats = catNames.length ? await createCategories(ctx, catNames) : [];
  const catIdByName = new Map(cats.map((c) => [c.name, c.id]));

  const created = await createServices(ctx, services.map((s) => ({
    type: s.type, name: s.name, description: s.description, tagLine: s.tagLine,
    price: s.price, free: s.free, duration: s.duration, capacity: s.capacity,
    categoryId: s.category ? catIdByName.get(s.category) : undefined,
    staffMemberIds: s.staffMemberIds ?? (s.type === "APPOINTMENT" && resourceId ? [resourceId] : undefined),
  })));

  const sessions = [];
  created.forEach((c, i) => {
    const plan = services[i];
    if (c.type === "CLASS" && Array.isArray(plan?.sessions)) {
      for (const ses of plan.sessions) {
        sessions.push({ scheduleId: c.scheduleId, resourceId, start: ses.start, end: ses.end, capacity: ses.capacity ?? plan.capacity });
      }
    }
  });
  const scheduled = sessions.length ? await scheduleClassSessions(ctx, sessions) : [];

  let imagesAttached = 0;
  for (let i = 0; i < created.length; i++) {
    const url = services[i]?.imageUrl;         // a plain image url (e.g. base44 generate_image) — imported here
    if (!url || !created[i]?.id) continue;
    try {
      const file = await importImage(ctx, url, `${created[i].slug || "service"}.png`);   // → Wix Media file id
      await attachServiceImage(ctx, {
        serviceId: created[i].id, revision: created[i].revision,
        image: { id: file.id, url: file.url, width: 1024, height: 1024 },
      });
      imagesAttached++;
    } catch { /* never block on image failure — leave the service text-only */ }
  }

  return { services: created, categories: cats, resourceId, sessionsScheduled: scheduled.length, imagesAttached };
}

module.exports = {
  setupBookings,
  installBookingsApp, listServices,
  queryStaff, queryStaffWithRetry, createStaff, queryCategories, createCategories,
  createServices, scheduleClassSessions, getService, importImage, attachServiceImage,
};
