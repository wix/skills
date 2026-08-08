// Restaurants seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Restaurants
// request/response mechanics (bottom-up items→sections→menu, the priceInfo decimal-string rule,
// the visible:true-at-every-level rule, the full-replace image PATCH, the per-micro-service host
// prefixes for ordering, the premium/address preconditions) live here, once.
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44 (generic: use $TOKEN)
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/restaurants/seed/seed-restaurants.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//
//   // --- MENU (always; the seedable core) ---
//   await seed.installMenusApp(ctx);                               // if the site doesn't have Wix Restaurants Menus yet
//   const menu = await seed.createMenu(ctx, {                      // builds items → sections → menu bottom-up
//     name: "Dinner", description: "Evening menu",
//     sections: [
//       { name: "Antipasti", description: "To start", items: [
//         { name: "Bruschetta al Pomodoro", description: "Grilled sourdough, San Marzano tomatoes, basil.", price: 9.50 },
//       ] },
//     ],
//   });                                                            // → { menuId, sectionIds, itemIds }
//
//   // --- ONLINE ORDERING (add-on, on demand; MENU-FIRST — seed the menu above first) ---
//   await seed.installOrdersApp(ctx);                              // auto-provisions a working ordering setup
//   await seed.setBusinessLocation(ctx, address);                 // STEP 0 — REQUIRED (see preconditions below)
//   const ops = await seed.listOperations(ctx);                    // verify the auto-created operation (never create one)
//   const methods = await seed.listFulfillmentMethods(ctx);        // reshape only what the request names
//   const mos = await seed.queryMenuOrderingSettings(ctx);         // confirm each menu is onlineOrderingEnabled
//
//   // --- TABLE RESERVATIONS (add-on, on demand; INDEPENDENT of menu/ordering) ---
//   await seed.installTableReservationsApp(ctx);                   // auto-provisions a default reservation location
//   await seed.setBusinessLocation(ctx, address);                 // STEP 0 — shared with ordering (do it once if both)
//   const [loc] = await seed.listReservationLocations(ctx);        // discover the default (never create one)
//   await seed.enableOnlineReservations(ctx, loc.id, loc.revision);// PREMIUM-GATED — 428 on a free site (record, don't fail)
//
//   // --- EXPERIENCES (add-on WITHIN Table Reservations, on demand) ---
//   await seed.createExperiences(ctx, loc.id, experiences);        // one per named dining occasion
//
// **NOT yet live-verified — transcribed from setup-restaurants.md / setup-restaurant-orders.md /
// setup-restaurant-reservations.md / setup-restaurant-experiences.md.** If any call fails with a
// shape the caller didn't expect, fall back to the wix-docs skill (search + read the live Wix API
// reference) — never guess.
//
// ── PRECONDITIONS the recipes flag (record in the handoff, do NOT fail the seed) ─────────────────
//   • Ordering STEP 0 address is REQUIRED: without a real business-location address Wix limits
//     ordering to "testing only" and checkout breaks. If the brief names no address, set a clearly
//     marked placeholder and flag the owner to fix it.
//   • Completing a PAID order needs a premium plan + a configured payment method (dashboard/premium
//     provisioning the skill can't do headlessly).
//   • enableOnlineReservations is PREMIUM-ONLY: on a non-premium site it throws `428 PREMIUM_ONLY`.
//     That is EXPECTED and non-fatal — record it as a precondition and continue; do not retry-spiral.
//   • Booking an Experience is premium-gated the same way (create works on a free site; booking needs
//     premium + online reservations enabled).

const API = "https://www.wixapis.com";

// App definition ids (SETUP.md §2). Menus is the seedable core; Orders + Table Reservations are
// separate optional apps. Experiences are a FEATURE of Table Reservations — no separate install.
const MENUS_APP_ID = "b278a256-2757-4f19-9313-c05c783bec92";
const ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";
const TABLE_RESERVATIONS_APP_ID = "f9c07de2-5341-40c6-b096-8eb39de391fb";

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

// ── app install ─────────────────────────────────────────────────────────────────────────────────
// Body shape per SETUP.md §2 (tenant + appInstance). One install call per app.
async function installApp(ctx, appDefId) {
  return req(ctx, "/apps-installer-service/v1/app-instance/install", {
    body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId, enabled: true },
    },
  });
}
async function installMenusApp(ctx) { return installApp(ctx, MENUS_APP_ID); }
async function installOrdersApp(ctx) { return installApp(ctx, ORDERS_APP_ID); }
async function installTableReservationsApp(ctx) { return installApp(ctx, TABLE_RESERVATIONS_APP_ID); }

// ══ MENU (setup-restaurants.md) ═══════════════════════════════════════════════════════════════════
// Everything is the Restaurants Menus V1 API on /restaurants/menus/v1/... — one service.
// REST flattens the protobuf wrappers: send plain values (`"visible": true`), never `{"value": …}`.

async function listMenuItems(ctx) {
  const r = await req(ctx, "/restaurants/menus/v1/items", { method: "GET" });
  return (r.items ?? []).map((it) => ({ id: it.id, name: it.name }));
}
async function listMenuSections(ctx) {
  const r = await req(ctx, "/restaurants/menus/v1/sections", { method: "GET" });
  return (r.sections ?? []).map((s) => ({ id: s.id, name: s.name }));
}
async function listMenus(ctx) {
  const r = await req(ctx, "/restaurants/menus/v1/menus", { method: "GET" });
  return (r.menus ?? []).map((m) => ({ id: m.id, name: m.name }));
}

/**
 * Build one menu BOTTOM-UP (items → sections → menu) in three bulk phases.
 * @param menu {
 *   name, description?,
 *   sections: [{ name, description?, items: [{ name, description?, price }] }]
 * }
 *   price -> priceInfo.price as a decimal STRING; currency is the site's (send none).
 *   description is a plain string (NOT rich-text nodes); omit for a name-only item/section.
 *   visible:true is baked in at every level (item, section, menu) — required to render on the live site.
 * @returns { menuId, sectionIds:[…], itemIds:[…] }  (revisions available via listMenuItems for image pass)
 */
async function createMenu(ctx, menu) {
  // STEP 1 — bulk-create every item across all sections in ONE request; track which section each belongs to.
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

  // STEP 2 — bulk-create sections, each carrying the itemIds of its items (real ids from STEP 1).
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
  return { menuId: menuRes.menu?.id, sectionIds, itemIds: createdItems.map((it) => it?.id) };
}

// Import an external image URL into Wix Media → { id, url }. Restaurants binds a menu-item image by
// the Wix Media file **id**, NOT a url — an external url (e.g. a base44 generate_image result) MUST
// be imported first; the raw url as the id stores (200) but renders nothing. id = wixstatic file id,
// url = the permanent wixstatic url.
async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

// Optional (pass-2). The ITEM is the image-bearing entity. Update Item is a FULL-ENTITY REPLACE
// with NO field mask — you MUST echo each item's current `revision` AND `priceInfo`, or it fails
// `428 MISSING_ITEM_PRICING` and the image does NOT apply. `image` is an OBJECT { id, url, height, width }
// (never a bare string); the binding field is the Wix Media file `id` (from importImage). Never block on image failure.
// items: [{ id, revision, price, image: { id, url, height, width } }]
async function attachItemImages(ctx, items) {
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

// ══ BUSINESS LOCATION (shared STEP 0 for ordering + reservations) ══════════════════════════════════
// Update Location is a FULL OVERRIDE — send the WHOLE `location` object (omitted fields are wiped),
// echo `default:true` (omitting it 400s CHANGE_DEFAULT_FORBIDDEN) and the current `revision`.
// address.country is a 2-letter ISO-3166 code. The address propagates to Site Properties.
// `location`: { name, timeZone, email?, phone?, address:{ country, subdivision, city, postalCode,
//               streetAddress:{ number, name }, formattedAddress } }
async function setBusinessLocation(ctx, location) {
  const list = await req(ctx, "/locations/v1/locations", { method: "GET" });
  const def = (list.locations ?? []).find((l) => l.default);
  // No default location at all (a bare Orders-only site can have none) -> CREATE one; operations
  // auto-bind on first-location-add. Otherwise overwrite the existing default (full override).
  if (!def) {
    const r = await req(ctx, "/locations/v1/locations", { body: { location: { ...location, default: true } } });
    return r.location;
  }
  const r = await req(ctx, `/locations/v1/locations/${def.id}`, {
    method: "PUT",
    body: { location: { ...location, id: def.id, revision: def.revision, default: true } },
  });
  return r.location;
}

// ══ ONLINE ORDERING (setup-restaurant-orders.md) ═══════════════════════════════════════════════════
// MENU-FIRST: a menu must exist (createMenu above) before ordering; each menu binds to the operation
// via a menu-ordering-settings object. The Orders-app install AUTO-provisions a working setup (an
// ENABLED operation with Pickup + Delivery attached, every menu ordering-enabled) — these helpers
// VERIFY and RESHAPE it; they do NOT build ordering from scratch. Each micro-service is on its OWN
// host prefix (restaurants-operations / fulfillment-methods / menu-ordering-settings) — do not normalize.

// STEP 1 — verify the auto-created operation (never POST to create one). If empty, the install hasn't
// finished provisioning: wait briefly and retry the GET once (caller's concern), then fail loud.
async function listOperations(ctx) {
  const r = await req(ctx, "/restaurants-operations/v1/operations", { method: "GET" });
  return r.operations ?? [];
}
// Normally already "ENABLED" — only PATCH if you see DISABLED/PAUSED_UNTIL. revision mandatory + current.
async function enableOperation(ctx, operationId, revision) {
  return req(ctx, `/restaurants-operations/v1/operations/${operationId}`, {
    method: "PATCH",
    body: { operation: { revision, onlineOrderingStatus: "ENABLED" } },
  });
}
// A newly created fulfillment method is NOT auto-attached — PATCH the operation's fulfillmentIds with
// the FULL array (existing ids + the new one) or it won't be offered at checkout.
async function setOperationFulfillmentIds(ctx, operationId, revision, fulfillmentIds) {
  return req(ctx, `/restaurants-operations/v1/operations/${operationId}`, {
    method: "PATCH",
    body: { operation: { revision, fulfillmentIds } },
  });
}

// STEP 2 — reconcile fulfillment methods to the request. Install ships three (Pickup enabled,
// "Delivery Area #1" enabled fee "0", "DoorDash Drive" disabled), all with a San Francisco placeholder
// address. Wrap bodies in camelCase `fulfillmentMethod`; fee/minOrderPrice are decimal STRINGS.
async function listFulfillmentMethods(ctx) {
  const r = await req(ctx, "/fulfillment-methods/v1/fulfillment-methods", { method: "GET" });
  return r.fulfillmentMethods ?? [];
}
// patch: partial { revision, name?, fee?, minOrderPrice?, enabled?, availability?, pickupOptions?/deliveryOptions? }
async function updateFulfillmentMethod(ctx, methodId, patch) {
  return req(ctx, `/fulfillment-methods/v1/fulfillment-methods/${methodId}`, {
    method: "PATCH",
    body: { fulfillmentMethod: patch },
  });
}
// Create a method beyond the defaults, THEN setOperationFulfillmentIds to attach it (create does NOT attach).
// pickupOptions for type PICKUP, deliveryOptions (with a deliveryArea) for DELIVERY — send the one matching type.
async function createFulfillmentMethod(ctx, fulfillmentMethod) {
  const r = await req(ctx, "/fulfillment-methods/v1/fulfillment-methods", { body: { fulfillmentMethod } });
  return r.fulfillmentMethod;
}

// STEP 3 — verify each menu is orderable. Auto-created + auto-enabled per menu, so normally a confirmation.
async function queryMenuOrderingSettings(ctx) {
  const r = await req(ctx, "/menu-ordering-settings/v1/menu-ordering-settings/query", { body: { query: {} } });
  return r.menuOrderingSettings ?? [];
}
// Only if an entry shows onlineOrderingEnabled:false / operationId:"none" (or a menu should be display-only).
// patch: { revision, operationId, onlineOrderingEnabled, availability:{ type:"ALWAYS_AVAILABLE", timeZone } }
async function updateMenuOrderingSettings(ctx, settingsId, patch) {
  return req(ctx, `/menu-ordering-settings/v1/menu-ordering-settings/${settingsId}`, {
    method: "PATCH",
    body: { menuOrderingSettings: patch },
  });
}

// ══ TABLE RESERVATIONS (setup-restaurant-reservations.md) ══════════════════════════════════════════
// INDEPENDENT of the menu (reservations bind to a LOCATION, not a menu — no menu-first rule) and there
// is NOTHING to bulk-seed (visitors create reservations at runtime). The install AUTO-provisions one
// default reservation location with a complete config; the one thing OFF is onlineReservationsEnabled.
// A reservation location CANNOT be created via this API — discover, configure, and enable it.
// Use the post-Jan-2026 field names: partySize (not partiesSize), approval (not manualApproval),
// tables.ids (not tableIds), ignoreConflicts.

// STEP 1 — discover the default location (never create one). If empty, wait + retry the GET once, else fail loud.
async function listReservationLocations(ctx) {
  const r = await req(ctx, "/table-reservations/reservation-locations/v1/reservation-locations", { method: "GET" });
  return r.reservationLocations ?? [];
}
// STEP 2 — customize config (only what the request names). Partial PATCH; revision mandatory. Works on a
// non-premium site. The `location` object (address/name) is IMMUTABLE here — only touch `configuration`.
// configuration: { onlineReservations: { partySize?:{min,max}, minimumReservationNotice?:{number,unit},
//                  defaultTurnoverTime?, businessSchedule?, approval?:{mode:"AUTOMATIC"}, ... } }
async function updateReservationLocation(ctx, reservationLocationId, revision, configuration) {
  return req(ctx, `/table-reservations/reservation-locations/v1/reservation-locations/${reservationLocationId}`, {
    method: "PATCH",
    body: { reservationLocation: { id: reservationLocationId, revision, configuration } },
  });
}
// STEP 3 — turn on online reservations. PREMIUM-ONLY: on a non-premium site this THROWS `428 PREMIUM_ONLY`
// ("Can't turn on online reservation for a non-premium website"). That is EXPECTED and non-fatal — the
// caller records it as a premium precondition and continues; do NOT retry-spiral or fail the seed.
async function enableOnlineReservations(ctx, reservationLocationId, revision) {
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

// ══ EXPERIENCES (setup-restaurant-experiences.md) ══════════════════════════════════════════════════
// An experience is a reservation that IS a curated dining occasion (wine tasting, chef's table). Feature
// of the Table Reservations app — no separate install. Created against a reservationLocationId (from
// listReservationLocations). The full create payload lives in the live docs (fields evolve) — build each
// `experience` from the Create-Experience doc; this only wires the loop. Set configuration.visible:true.
// GOTCHAS the docs won't state:
//   • Notice fields are FLAT under onlineReservations (minimumReservationNotice / maximumReservationNotice),
//     NOT wrapped in `noticePeriod` (the doc example's wrapper is stale).
//   • paymentPolicyType: PER_GUEST (needs perGuestOptions.price, a decimal string) or FREE.
//   • businessSchedule.entries[] carries the recurrence (WEEKLY + weeklyOptions.startDaysAndTimes[{day,time}],
//     or ONE_TIME); durationInMinutes sits on businessSchedule, not per entry.
//   • Creating works on a free site; BOOKING is premium-gated (record, don't fail).
// experiences: [{ configuration: { displayInfo:{name,shortDescription}, paymentPolicy, onlineReservations, visible } }]
async function createExperiences(ctx, reservationLocationId, experiences) {
  const out = [];
  for (const exp of experiences) {
    const r = await req(ctx, "/table-reservations/experiences/v1/experiences", {
      body: { experience: { reservationLocationId, ...exp } },
    });
    out.push({ id: r.experience?.id, name: r.experience?.configuration?.displayInfo?.name });
  }
  return out;
}

// ══ ONE-CALL ORCHESTRATOR ══════════════════════════════════════════════════════════════════════════
/**
 * DEFAULT one-call path — seed a whole Wix Restaurants site from a plain plan; the caller threads NO
 * ids across exec calls. Installs the Menus app and builds the menu BOTTOM-UP (items → sections → menu):
 * `createMenu` bulk-creates every item first, then the sections carrying their item ids, then the menu
 * carrying its section ids — every child exists before its parent. In-memory name→id maps (item, section)
 * wire the tree and map each plan item to its created id for the image pass (full-replace, echo revision
 * + price; freshly created items are at revision "1"). Online ordering and table reservations are
 * on-demand add-ons — touched ONLY when the plan asks, each installing its own app and following the
 * module's own fns. Ordering needs a business-location address (`setBusinessLocation` STEP 0); if the
 * plan names none the recipe's precondition applies (record + flag). `enableOnlineReservations` is
 * premium-gated (428 on a free site) — expected and non-fatal, recorded not thrown.
 *
 * @param plan {
 *   menu: { name, description?, sections: [{ name, description?,
 *           items: [{ name, description?, price, imageUrl? }] }] },   // imageUrl = a plain url; imported to Wix Media here
 *   ordering?:     boolean | { address? },
 *   reservations?: boolean | { address?, configuration? },
 * }
 * @returns { menuId, sectionIds, itemIds, orderingEnabled, reservationsEnabled, imagesAttached }
 */
async function setupRestaurants(ctx, plan) {
  await installMenusApp(ctx);

  const { menuId, sectionIds, itemIds } = await createMenu(ctx, plan.menu);

  // name→id maps: createMenu flattens sections→items in order, so itemIds/sectionIds line up 1:1.
  const flatItems = plan.menu.sections.flatMap((s) => s.items || []);
  const itemNameToId = new Map(flatItems.map((it, i) => [it.name, itemIds[i]]));

  // image pass — import each item's url to Wix Media (restaurants binds by file id), then full-replace
  // update its created id (revision "1", fresh + priceInfo). A failed import just skips that image.
  const imageItems = [];
  for (const it of flatItems) {
    if (!it.imageUrl) continue;
    try {
      const file = await importImage(ctx, it.imageUrl, `${it.name || "item"}.png`);
      imageItems.push({ id: itemNameToId.get(it.name), revision: "1", price: it.price,
        image: { id: file.id, url: file.url, height: 1024, width: 1024 } });
    } catch { /* skip this item's image */ }
  }
  let imagesAttached = 0;
  if (imageItems.length) {
    try { await attachItemImages(ctx, imageItems); imagesAttached = imageItems.length; }
    catch { /* never block on image failure */ }
  }

  // shared STEP 0 address — set once across both add-ons (SEED.md: do it once if both run).
  let locationSet = false;
  const ensureLocation = async (address) => {
    if (address && !locationSet) { await setBusinessLocation(ctx, address); locationSet = true; }
  };

  let orderingEnabled = false;
  if (plan.ordering) {
    const cfg = typeof plan.ordering === "object" ? plan.ordering : {};
    await installOrdersApp(ctx);                 // auto-provisions operation + methods + per-menu settings
    await ensureLocation(cfg.address);
    await listOperations(ctx);                   // verify the auto-created operation
    await queryMenuOrderingSettings(ctx);        // confirm each menu is orderable
    orderingEnabled = true;
  }

  let reservationsEnabled = false;
  if (plan.reservations) {
    const cfg = typeof plan.reservations === "object" ? plan.reservations : {};
    await installTableReservationsApp(ctx);      // auto-provisions the default reservation location
    await ensureLocation(cfg.address);           // independent of menu; address optional for reservations
    let [loc] = await listReservationLocations(ctx);
    if (loc && cfg.configuration) {
      await updateReservationLocation(ctx, loc.id, loc.revision, cfg.configuration);
      [loc] = await listReservationLocations(ctx);  // re-read for the bumped revision
    }
    if (loc) {
      try { await enableOnlineReservations(ctx, loc.id, loc.revision); reservationsEnabled = true; }
      catch { /* 428 PREMIUM_ONLY on a free site is expected — record, don't fail */ }
    }
  }

  return { menuId, sectionIds, itemIds, orderingEnabled, reservationsEnabled, imagesAttached };
}

module.exports = {
  // DEFAULT one-call orchestrator
  setupRestaurants,
  // app install
  installMenusApp, installOrdersApp, installTableReservationsApp,
  // menu
  listMenuItems, listMenuSections, listMenus,
  createMenu, importImage, attachItemImages,
  // shared business location (ordering + reservations STEP 0)
  setBusinessLocation,
  // ordering add-on
  listOperations, enableOperation, setOperationFulfillmentIds,
  listFulfillmentMethods, updateFulfillmentMethod, createFulfillmentMethod,
  queryMenuOrderingSettings, updateMenuOrderingSettings,
  // reservations add-on
  listReservationLocations, updateReservationLocation, enableOnlineReservations,
  // experiences add-on
  createExperiences,
};
