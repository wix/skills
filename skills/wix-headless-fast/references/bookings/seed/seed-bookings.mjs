// Bookings seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/bookings/seed/seed-bookings.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Bookings app if needed,
// resolves a staff resource (polling — a fresh install provisions the owner async), creates
// categories (idempotent by name) and services (bulk; APPOINTMENT + CLASS mixed), schedules
// CLASS sessions, and imports+attaches images. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "services": [{ "type": "APPOINTMENT"|"CLASS", "name", "description", "tagLine"?,
//                    "price"?, "free"?, "duration"? (APPOINTMENT, minutes), "capacity"?,
//                    "category"? (name), "imageUrl"? | "imagePrompt"?,
//                    "sessions"?: [{ "start", "end", "capacity"? }] }] }   // CLASS only; local "YYYY-MM-DDThh:mm:ss"
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Unexpected shapes →
// read the live API reference; authoritative source recipe:
// wix-headless/references/inline-recipes/setup-bookings.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";

const API = "https://www.wixapis.com";
const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

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

function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// plain service -> flat Services V2 create object. price omitted / free:true -> NO_FEE.
function buildService(s) {
  const isAppointment = s.type === "APPOINTMENT";
  const free = s.free === true || s.price == null;
  const out = {
    type: s.type,
    name: s.name,
    description: s.description,
    tagLine: s.tagLine,
    defaultCapacity: s.capacity ?? (isAppointment ? 1 : undefined),
    onlineBooking: { enabled: true, requireManualApproval: false, allowMultipleRequests: false },
    payment: free
      ? { rateType: "NO_FEE", options: { online: false, inPerson: true } }
      : {
          rateType: "FIXED",
          fixed: { price: { value: String(s.price), currency: s.currency ?? "USD" } },
          options: { online: true, inPerson: false },
        },
    category: { id: s.categoryId }, // mandatory for live-site visibility
    locations: [{ type: "BUSINESS" }], // never OWNER_BUSINESS on the services endpoint
  };
  if (isAppointment) {
    out.schedule = { availabilityConstraints: { sessionDurations: [s.duration ?? 60] } };
    out.staffMemberIds = s.staffMemberIds; // resourceId(s) — non-empty or MISSING_APPOINTMENT_RESOURCES
  }
  return out;
}

// ---- operations ----------------------------------------------------------------------------------

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

// ⚠️ staffMemberIds takes resourceId, NOT the staff id.
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

// Every service needs a category.id or it's invisible on the live site. Idempotent by name.
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

// Bulk-create services (APPOINTMENT + CLASS mixed). Run AFTER staff + categories.
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

// CLASS only: schedule sessions (bulk Calendar Events V3). start/end are LOCAL wall-clock
// "YYYY-MM-DDThh:mm:ss" (no Z), today-or-future.
export async function scheduleClassSessions(ctx, sessions) {
  const body = {
    events: sessions.map((s) => ({
      event: {
        scheduleId: s.scheduleId,
        type: "CLASS",
        start: { localDate: s.start },
        end: { localDate: s.end },
        resources: [{ id: s.resourceId, permissionRole: "WRITER" }], // non-empty + WRITER, else UNKNOWN_ROLE
        ...(s.capacity != null ? { totalCapacity: s.capacity } : {}),
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

// Bookings binds a service image by Wix Media file ID — an external url must be imported
// first; a plan `imagePrompt` is generated (Wix AI, 1 credit) then imported. Both live in the
// shared util (parallel, resilient, never blocks the seed).
export { importImage } from "../../shared/seed/images.mjs";

// Writes under media.mainMedia + media.coverMedia (writing media.image 200s but silently drops).
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
 * ONE-CALL seed: install → resolve staff (poll) → categories → services → CLASS sessions →
 * images, ids threaded in memory. The default path.
 */
export async function setupBookings(ctx, { services = [], staffResourceId } = {}) {
  await installBookingsApp(ctx);

  let resourceId = staffResourceId;
  if (!resourceId) {
    const staff = await queryStaffWithRetry(ctx);
    resourceId = staff[0]?.resourceId;
  }
  if (!resourceId) throw new Error("No staff resource resolved — Bookings provisioning may still be in progress; re-run the seed.");

  const catNames = [...new Set(services.map((s) => s.category).filter(Boolean))];
  const cats = catNames.length ? await createCategories(ctx, catNames) : await createCategories(ctx, ["Services"]);
  const catIdByName = new Map(cats.map((c) => [c.name, c.id]));
  const defaultCatId = cats[0]?.id;

  const created = await createServices(ctx, services.map((s) => ({
    type: s.type,
    name: s.name,
    description: s.description,
    tagLine: s.tagLine,
    price: s.price,
    currency: s.currency,
    free: s.free,
    duration: s.duration,
    capacity: s.capacity,
    categoryId: (s.category ? catIdByName.get(s.category) : undefined) ?? defaultCatId,
    staffMemberIds: s.staffMemberIds ?? (s.type === "APPOINTMENT" ? [resourceId] : undefined),
  })));

  const sessions = [];
  created.forEach((c, i) => {
    const plan = services[i];
    if (c.type === "CLASS" && c.scheduleId && Array.isArray(plan?.sessions)) {
      for (const ses of plan.sessions) {
        sessions.push({ scheduleId: c.scheduleId, resourceId, start: ses.start, end: ses.end, capacity: ses.capacity ?? plan.capacity });
      }
    }
  });
  const scheduled = sessions.length ? await scheduleClassSessions(ctx, sessions) : [];

  // Pass 2 — images: resolve (import by url / generate by prompt) in one parallel wave, then
  // attach. Failures leave the service text-only; the seed's exit never depends on images.
  const files = await resolveItemImages(ctx, created.map((c, i) => ({
    url: services[i]?.imageUrl,
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
    resourceId,
    sessionsScheduled: scheduled.filter((s) => s.success).length,
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
