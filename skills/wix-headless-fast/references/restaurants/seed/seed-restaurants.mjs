// Restaurants seed — a BUILD-TIME script, never shipped in the app. Run from the project
// root (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/restaurants/seed/seed-restaurants.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Restaurants Menus app (plus
// Orders / Table Reservations when the plan asks), builds each menu BOTTOM-UP (bulk items →
// bulk sections → menu — every child exists before its parent, visible:true at every level),
// imports+attaches item images, and configures the add-ons. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "menus": [{ "name", "description"?, "sections": [{ "name", "description"?,
//                 "items": [{ "name", "description"?, "price", "imageUrl"? }] }] }],
//     "ordering"?: true | { "address"? },        // menu-first add-on; address is STEP 0
//     "reservations"?: true | { "partySize"? { "min","max" }, "address"? } }
//
// Seeding is ADDITIVE — with ONE recipe-sanctioned exception: when THIS run installs the
// Menus app onto a site that didn't have it, the install's own sample "Dinner Menu" is
// removed (it's provably not owner content). Nothing else is ever deleted. Unexpected
// shapes → read the live API reference; authoritative source recipes:
// wix-headless/references/inline-recipes/setup-restaurants.md, setup-restaurant-orders.md,
// setup-restaurant-reservations.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const API = "https://www.wixapis.com";
const MENUS_APP_ID = "b278a256-2757-4f19-9313-c05c783bec92";
const ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";
const TABLE_RESERVATIONS_APP_ID = "f9c07de2-5341-40c6-b096-8eb39de391fb";

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

// ---- app installs --------------------------------------------------------------------------------

async function installApp(ctx, appDefId) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}
export async function installMenusApp(ctx) { return installApp(ctx, MENUS_APP_ID); }
export async function installOrdersApp(ctx) { return installApp(ctx, ORDERS_APP_ID); }
export async function installTableReservationsApp(ctx) { return installApp(ctx, TABLE_RESERVATIONS_APP_ID); }

/** True when the Menus API answers — i.e. the app is already on the site. */
export async function menusAppPresent(ctx) {
  try {
    await req(ctx, "/restaurants/menus/v1/menus", { method: "GET" });
    return true;
  } catch {
    return false;
  }
}

// ---- menu (setup-restaurants.md) -----------------------------------------------------------------
// Everything is Restaurants Menus V1 on /restaurants/menus/v1/... . REST flattens the
// protobuf wrappers: plain values ("visible": true), never {"value": …}.

/**
 * Recipe STEP 0 — a FRESH Menus-app install ships a populated sample "Dinner Menu"
 * (~4 sections, ~21 items) that would render next to the seeded menu. Call ONLY when this
 * run installed the app onto a site that didn't have it (menusAppPresent was false) — then
 * everything present is provably the install's own sample. Polls briefly (the sample
 * provisions async), then deletes children before parents. No-op when nothing appears.
 */
export async function removeSampleMenu(ctx, { tries = 8, delayMs = 2000 } = {}) {
  let menus = [];
  for (let i = 0; i < tries; i++) {
    const r = await req(ctx, "/restaurants/menus/v1/menus", { method: "GET" });
    menus = r.menus ?? [];
    if (menus.length) break;
    if (i < tries - 1) await sleep(delayMs);
  }
  if (!menus.length) return { removed: false };

  const itemsRes = await req(ctx, "/restaurants/menus/v1/items", { method: "GET" });
  const sectionsRes = await req(ctx, "/restaurants/menus/v1/sections", { method: "GET" });
  const itemIds = (itemsRes.items ?? []).map((it) => it.id).filter(Boolean);
  const sectionIds = (sectionsRes.sections ?? []).map((s) => s.id).filter(Boolean);
  if (itemIds.length) {
    await req(ctx, "/restaurants/menus/v1/bulk/items/delete", { method: "DELETE", body: { ids: itemIds } });
  }
  if (sectionIds.length) {
    await req(ctx, "/restaurants/menus/v1/bulk/sections/delete", { method: "DELETE", body: { ids: sectionIds } });
  }
  for (const m of menus) {
    await req(ctx, `/restaurants/menus/v1/menus/${m.id}`, { method: "DELETE" }); // no bulk delete for menus
  }
  return { removed: true, menus: menus.map((m) => m.name) };
}

/**
 * Build ONE menu BOTTOM-UP (items → sections → menu) in three bulk phases.
 * price -> priceInfo.price as a decimal STRING; currency is the site's (send none).
 * visible:true is baked in at every level — required to render on the live site.
 * Returns { menuId, name, sectionIds, itemIds, items: [{ id, revision, price }] } — the
 * per-item revision/price feed the image pass (Update Item is a full replace).
 */
export async function createMenu(ctx, menu) {
  // STEP 1 — bulk-create every item across all sections in ONE request.
  const flat = [];
  menu.sections.forEach((sec, si) => (sec.items || []).forEach((it) => flat.push({ ...it, _section: si })));
  const itemRes = await req(ctx, "/restaurants/menus/v1/bulk/items/create", {
    body: {
      items: flat.map((it) => ({
        name: it.name,
        ...(it.description ? { description: it.description } : {}),
        priceInfo: { price: String(it.price) },
        visible: true,
      })),
      returnEntity: true,
    },
  });
  // created items are under results[].item (results[].itemMetadata.success is the per-item flag)
  const createdItems = (itemRes.results ?? []).map((r) => r.item);
  const itemIdsBySection = menu.sections.map(() => []);
  flat.forEach((it, i) => {
    const id = createdItems[i]?.id;
    if (id) itemIdsBySection[it._section].push(id);
  });

  // STEP 2 — bulk-create sections, each carrying the itemIds of its items in display order.
  const secRes = await req(ctx, "/restaurants/menus/v1/bulk/sections/create", {
    body: {
      sections: menu.sections.map((sec, si) => ({
        name: sec.name,
        ...(sec.description ? { description: sec.description } : {}),
        visible: true,
        itemIds: itemIdsBySection[si],
      })),
      returnEntity: true,
    },
  });
  const sectionIds = (secRes.results ?? []).map((r) => r.item?.id);

  // STEP 3 — create the menu (single create wraps in `menu`), carrying its sectionIds.
  // businessLocationId omitted -> binds to the site's default (main) location.
  const menuRes = await req(ctx, "/restaurants/menus/v1/menus", {
    body: {
      menu: {
        name: menu.name,
        ...(menu.description ? { description: menu.description } : {}),
        visible: true,
        sectionIds,
      },
    },
  });
  return {
    menuId: menuRes.menu?.id,
    name: menu.name,
    sectionIds,
    itemIds: createdItems.map((it) => it?.id),
    items: createdItems.map((it, i) => ({ id: it?.id, revision: it?.revision, price: flat[i]?.price })),
  };
}

// Restaurants binds an item image by Wix Media file ID — an external url must be imported first.
export async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

// Image pass. Update Item is a FULL-ENTITY REPLACE with NO field mask — each entry MUST echo
// the item's current `revision` AND `priceInfo`, or it fails 428 MISSING_ITEM_PRICING and the
// image does NOT apply. `image` is an OBJECT { id, url, height, width } (never a bare string);
// the binding field is the Wix Media file `id`.
// items: [{ id, revision, price, image: { id, url, height, width } }]
export async function attachItemImages(ctx, items) {
  return req(ctx, "/restaurants/menus/v1/bulk/items/update", {
    body: {
      items: items.map((it) => ({
        item: {
          id: it.id,
          revision: it.revision,
          priceInfo: { price: String(it.price) },
          image: it.image,
        },
      })),
    },
  });
}

// ---- business location (shared STEP 0 for ordering + reservations) ------------------------------
// Update Location is a FULL OVERRIDE — send the WHOLE `location` object (omitted fields are
// wiped), echo `default:true` (omitting it 400s CHANGE_DEFAULT_FORBIDDEN) and the current
// `revision`. address.country is a 2-letter ISO code. Without a real address, ordering is
// "testing only" and checkout breaks — a placeholder must be flagged to the owner.
// location: { name, timeZone, email?, phone?, address: { country, subdivision, city,
//             postalCode, streetAddress: { number, name }, formattedAddress } }
export async function setBusinessLocation(ctx, location) {
  const list = await req(ctx, "/locations/v1/locations", { method: "GET" });
  const def = (list.locations ?? []).find((l) => l.default);
  if (!def) {
    // No default location at all (a bare site can have none) -> CREATE one; operations
    // auto-bind on first-location-add.
    const r = await req(ctx, "/locations/v1/locations", { body: { location: { ...location, default: true } } });
    return r.location;
  }
  const r = await req(ctx, `/locations/v1/locations/${def.id}`, {
    method: "PUT",
    body: { location: { ...location, id: def.id, revision: def.revision, default: true } },
  });
  return r.location;
}

// ---- online ordering (setup-restaurant-orders.md) ------------------------------------------------
// The Orders-app install AUTO-provisions a working setup (an ENABLED operation with Pickup +
// Delivery attached, every menu ordering-enabled) — these helpers VERIFY it; they never POST
// an operation. Each micro-service is on its OWN host prefix — do not normalize.

export async function listOperations(ctx) {
  const r = await req(ctx, "/restaurants-operations/v1/operations", { method: "GET" });
  return r.operations ?? [];
}

// A fresh install provisions the operation ASYNC — poll until it lands.
export async function listOperationsWithRetry(ctx, { tries = 15, delayMs = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const ops = await listOperations(ctx).catch(() => []);
    if (ops.length) return ops;
    if (i < tries - 1) await sleep(delayMs);
  }
  return [];
}

// Normally already ENABLED — only PATCH when DISABLED/PAUSED_UNTIL. revision mandatory + current.
export async function enableOperation(ctx, operationId, revision) {
  return req(ctx, `/restaurants-operations/v1/operations/${operationId}`, {
    method: "PATCH",
    body: { operation: { revision, onlineOrderingStatus: "ENABLED" } },
  });
}

export async function queryMenuOrderingSettings(ctx) {
  const r = await req(ctx, "/menu-ordering-settings/v1/menu-ordering-settings/query", { body: { query: {} } });
  return r.menuOrderingSettings ?? [];
}

// Only when an entry shows onlineOrderingEnabled:false / operationId:"none".
export async function updateMenuOrderingSettings(ctx, settingsId, patch) {
  return req(ctx, `/menu-ordering-settings/v1/menu-ordering-settings/${settingsId}`, {
    method: "PATCH",
    body: { menuOrderingSettings: patch },
  });
}

// ---- table reservations (setup-restaurant-reservations.md) ---------------------------------------
// The install AUTO-provisions one default reservation location with a complete config; the
// one thing OFF is onlineReservationsEnabled (premium-gated). A reservation location cannot
// be created via this API — discover, configure, enable. Post-Jan-2026 field names:
// partySize (not partiesSize), approval (not manualApproval).

export async function listReservationLocations(ctx) {
  const r = await req(ctx, "/table-reservations/reservation-locations/v1/reservation-locations", { method: "GET" });
  return r.reservationLocations ?? [];
}

export async function listReservationLocationsWithRetry(ctx, { tries = 15, delayMs = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const locs = await listReservationLocations(ctx).catch(() => []);
    if (locs.length) return locs;
    if (i < tries - 1) await sleep(delayMs);
  }
  return [];
}

// Partial PATCH; revision mandatory; works on a non-premium site. The `location` object
// (address/name) is IMMUTABLE here — only touch `configuration`.
export async function updateReservationLocation(ctx, reservationLocationId, revision, configuration) {
  return req(ctx, `/table-reservations/reservation-locations/v1/reservation-locations/${reservationLocationId}`, {
    method: "PATCH",
    body: { reservationLocation: { id: reservationLocationId, revision, configuration } },
  });
}

// PREMIUM-ONLY: on a non-premium site this THROWS `428 PREMIUM_ONLY` — expected and
// non-fatal; the caller records it and continues (never retry-spiral, never fail the seed).
export async function enableOnlineReservations(ctx, reservationLocationId, revision) {
  return req(ctx, `/table-reservations/reservation-locations/v1/reservation-locations/${reservationLocationId}`, {
    method: "PATCH",
    body: {
      reservationLocation: {
        id: reservationLocationId,
        revision,
        configuration: { onlineReservations: { onlineReservationsEnabled: true } },
      },
    },
  });
}

/**
 * ONE-CALL seed: Menus install (+ sample cleanup when fresh) → menus bottom-up → images →
 * ordering add-on → reservations add-on, ids threaded in memory. The default path.
 */
export async function setupRestaurants(ctx, plan) {
  const menusPlan = plan.menus ?? [];
  const wasPresent = await menusAppPresent(ctx);
  await installMenusApp(ctx);
  let sampleMenuRemoved = false;
  if (!wasPresent) {
    const r = await removeSampleMenu(ctx).catch(() => ({ removed: false }));
    sampleMenuRemoved = r.removed === true;
  }

  const createdMenus = [];
  for (const m of menusPlan) createdMenus.push(await createMenu(ctx, m));

  // image pass — import each item's url to Wix Media (restaurants binds by file id), then
  // bulk full-replace with revision + priceInfo echoed. Never block on image failure.
  let imagesAttached = 0;
  const imageItems = [];
  menusPlan.forEach((m, mi) => {
    const flat = m.sections.flatMap((s) => s.items || []);
    flat.forEach((it, i) => {
      const created = createdMenus[mi]?.items?.[i];
      if (it.imageUrl && created?.id) imageItems.push({ ...created, imageUrl: it.imageUrl, name: it.name });
    });
  });
  const toAttach = [];
  for (const it of imageItems) {
    try {
      const file = await importImage(ctx, it.imageUrl, `${it.name || "item"}.png`);
      toAttach.push({ id: it.id, revision: it.revision ?? "1", price: it.price,
        image: { id: file.id, url: file.url, width: 1024, height: 1024 } });
    } catch {
      /* skip this item's image */
    }
  }
  if (toAttach.length) {
    try {
      await attachItemImages(ctx, toAttach);
      imagesAttached = toAttach.length;
    } catch {
      /* the items stay text-only */
    }
  }

  // shared STEP 0 address — set once across both add-ons.
  let locationSet = false;
  const ensureLocation = async (address) => {
    if (address && !locationSet) {
      await setBusinessLocation(ctx, address);
      locationSet = true;
    }
  };

  const ordering = { enabled: false, addressSet: false };
  if (plan.ordering) {
    const cfg = typeof plan.ordering === "object" ? plan.ordering : {};
    await installOrdersApp(ctx); // auto-provisions operation + methods + per-menu settings
    await ensureLocation(cfg.address);
    ordering.addressSet = locationSet;
    const ops = await listOperationsWithRetry(ctx);
    const op = ops.find((o) => o.default) ?? ops[0];
    if (!op) throw new Error("No ordering operation appeared — the Orders app install may not have completed; re-run the seed.");
    if (op.onlineOrderingStatus !== "ENABLED") await enableOperation(ctx, op.id, op.revision);
    // confirm each menu is orderable (auto-created + auto-enabled per menu; PATCH only when off)
    const settings = await queryMenuOrderingSettings(ctx);
    for (const s of settings) {
      if (s.onlineOrderingEnabled === false || s.operationId === "none") {
        await updateMenuOrderingSettings(ctx, s.id, {
          revision: s.revision,
          operationId: op.id,
          onlineOrderingEnabled: true,
          availability: { type: "ALWAYS_AVAILABLE", timeZone: cfg.address?.timeZone ?? "America/New_York" },
        }).catch(() => {});
      }
    }
    ordering.enabled = true;
    ordering.operationId = op.id;
    if (!ordering.addressSet) ordering.note = "No address in the plan — ordering is 'testing only' until the owner sets the real business address.";
  }

  const reservations = { enabled: false };
  if (plan.reservations) {
    const cfg = typeof plan.reservations === "object" ? plan.reservations : {};
    await installTableReservationsApp(ctx); // auto-provisions the default reservation location
    await ensureLocation(cfg.address);
    let [loc] = await listReservationLocationsWithRetry(ctx);
    if (!loc) throw new Error("No reservation location appeared — the Table Reservations install may not have completed; re-run the seed.");
    const configuration = cfg.configuration ?? (cfg.partySize ? { onlineReservations: { partySize: cfg.partySize } } : null);
    if (configuration) {
      await updateReservationLocation(ctx, loc.id, loc.revision, configuration);
      [loc] = await listReservationLocations(ctx); // re-read for the bumped revision
    }
    reservations.reservationLocationId = loc.id;
    try {
      await enableOnlineReservations(ctx, loc.id, loc.revision);
      reservations.enabled = true;
    } catch {
      // 428 PREMIUM_ONLY on a free site — expected; record, don't fail.
      reservations.premiumRequired = true;
    }
  }

  return {
    menus: createdMenus.map(({ items, ...m }) => m),
    imagesAttached,
    sampleMenuRemoved,
    ordering,
    reservations,
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-restaurants.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupRestaurants(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
