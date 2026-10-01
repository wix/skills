// Restaurants seed — a BUILD-TIME script, never shipped in the app. Run from the project
// root (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/restaurants/seed/seed-restaurants.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Restaurants Menus app (plus
// Orders / Table Reservations when the plan asks), builds each menu BOTTOM-UP (bulk modifiers →
// bulk modifier groups → bulk variants → bulk items → bulk sections → menu — every child exists
// before its parent, visible:true at every level), imports+attaches item images, and configures
// the add-ons. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "menus": [{ "name", "description"?, "sections": [{ "name", "description"?,
//                 "items": [{ "name", "description"?, "price"? | "variants"?: [{ "name", "price" }],
//                             "modifierGroups"?: [{ "name", "required"?, "min"?, "max"?,
//                               "modifiers": [{ "name", "price"?, "preSelected"?, "inStock"? }] }],
//                             "acceptSpecialRequests"?, "imageUrl"? | "imagePath"? | "imagePrompt"? }] }] }],
//     "ordering"?: true | { "address"? },        // menu-first add-on; address is STEP 0
//     "reservations"?: true | { "partySize"? { "min","max" }, "address"? } }
//
// Seeding is ADDITIVE — nothing on the site is ever deleted, the Menus install's own sample
// "Dinner Menu" included: it is reported (`preexistingMenus`) and the owner removes it in the
// dashboard if they want to. Unexpected
// shapes → read the live API reference; every call below
// carries a docs: line with its reference page.
import { setSiteCurrency } from "../../shared/seed/site.mjs";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";
import { seedSiteId } from "../../shared/seed/site-context.mjs";
import { wixToken } from "../../shared/seed/wix-cli.mjs";

const API = "https://www.wixapis.com";
const MENUS_APP_ID = "b278a256-2757-4f19-9313-c05c783bec92";
const ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";
const TABLE_RESERVATIONS_APP_ID = "f9c07de2-5341-40c6-b096-8eb39de391fb";

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
const money = (n) => String(n ?? 0);

// ---- app installs --------------------------------------------------------------------------------

// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
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
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md
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
 * What the Menus app already holds before this seed writes anything. A FRESH install ships a
 * populated sample "Dinner Menu" (~4 sections, ~21 items) that renders next to the seeded menus;
 * on an existing site these are the owner's menus. Reported, never touched: this seed deletes
 * nothing on a site, ever. Polls briefly on a fresh install (the sample provisions async).
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/list-sections.md
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md
 */
export async function readPreexistingMenus(ctx, { tries = 1, delayMs = 2000 } = {}) {
  let menus = [];
  for (let i = 0; i < tries; i++) {
    const r = await req(ctx, "/restaurants/menus/v1/menus", { method: "GET" });
    menus = r.menus ?? [];
    if (menus.length) break;
    if (i < tries - 1) await sleep(delayMs);
  }
  if (!menus.length) return [];
  const itemsRes = await req(ctx, "/restaurants/menus/v1/items", { method: "GET" });
  const sectionsRes = await req(ctx, "/restaurants/menus/v1/sections", { method: "GET" });
  return menus.map((m) => ({
    id: m.id,
    name: m.name,
    sections: (sectionsRes.sections ?? []).filter((sec) => (m.sectionIds ?? []).includes(sec.id)).length,
    items: (itemsRes.items ?? []).length,
  }));
}

// A bulk create's created entities, in input order (results[].item; the per-entry flag is results[].itemMetadata.success).
const bulkEntities = (res) => (res.results ?? []).map((r) => r.item ?? r.variant ?? r.modifier ?? r.modifierGroup ?? null);

/**
 * Bulk-create the modifiers of the plan's groups (the reusable "Extra cheese" entities; the
 * up-charge and pre-selection live on the group's reference, not here). Returns ids in input order.
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifiers/bulk-create-modifiers.md
 */
export async function createModifiers(ctx, modifiers) {
  if (!modifiers.length) return [];
  const r = await req(ctx, "/restaurants/menus/v1/bulk/modifiers/create", {
    body: { modifiers: modifiers.map((m) => ({ name: m.name, inStock: m.inStock !== false })), returnEntity: true },
  });
  return bulkEntities(r).map((m) => m?.id);
}

/**
 * Bulk-create modifier groups: each carries its modifier references (id, preSelected, the
 * up-charge as additionalChargeInfo.additionalCharge — a decimal string in the site currency) and
 * its rule { required, minSelections, maxSelections }. Returns ids in input order.
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifier-groups/bulk-create-modifier-groups.md
 */
export async function createModifierGroups(ctx, groups) {
  if (!groups.length) return [];
  const r = await req(ctx, "/restaurants/menus/v1/bulk/modifier-groups/create", {
    body: {
      modifierGroups: groups.map((g) => ({
        name: g.name,
        modifiers: g.modifiers.map((m) => ({
          id: m.id,
          preSelected: m.preSelected === true,
          additionalChargeInfo: { additionalCharge: money(m.price) },
        })),
        rule: {
          required: g.required === true,
          minSelections: g.min ?? (g.required ? 1 : 0),
          ...(g.max != null ? { maxSelections: g.max } : {}),
        },
      })),
      returnEntity: true,
    },
  });
  return bulkEntities(r).map((g) => g?.id);
}

/**
 * Bulk-create price variants (the reusable "Glass" / "Bottle" names; the price per item lives on
 * the item's priceVariants reference). Returns ids in input order.
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-variants/bulk-create-variants.md
 */
export async function createVariants(ctx, variants) {
  if (!variants.length) return [];
  const r = await req(ctx, "/restaurants/menus/v1/bulk/variants/create", {
    body: { variants: variants.map((v) => ({ name: v.name })), returnEntity: true },
  });
  return bulkEntities(r).map((v) => v?.id);
}

/**
 * The writable fields of one item from its plan entry and the ids of its created variants/groups:
 * flat `priceInfo` OR `priceVariants` (never both), the group references, and the order settings.
 * Used by the create AND echoed by the image pass (Update Item is a full replace).
 */
export function itemBody(it, { variantIds = [], groupIds = [] } = {}) {
  const pricing = it.variants?.length
    ? { priceVariants: { variants: it.variants.map((v, i) => ({ variantId: variantIds[i], priceInfo: { price: money(v.price) } })).filter((v) => v.variantId) } }
    : { priceInfo: { price: money(it.price) } };
  return {
    name: it.name,
    ...(it.description ? { description: it.description } : {}),
    ...pricing,
    ...(groupIds.length ? { modifierGroups: groupIds.filter(Boolean).map((id) => ({ id })) } : {}),
    orderSettings: { inStock: it.inStock !== false, acceptSpecialRequests: it.acceptSpecialRequests === true },
    visible: true,
  };
}

/**
 * Build ONE menu BOTTOM-UP in bulk phases: modifiers → modifier groups → variants → items →
 * sections → menu. Prices are decimal STRINGS in the site currency (send none). visible:true is
 * baked in at every level — required to render on the live site.
 * Returns { menuId, name, sectionIds, itemIds, items: [{ id, revision, body }] } — the per-item
 * revision and body feed the image pass (Update Item is a full replace).
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/bulk-create-items.md
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/bulk-create-sections.md
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/create-menu.md
 */
export async function createMenu(ctx, menu) {
  const flat = [];
  menu.sections.forEach((sec, si) => (sec.items || []).forEach((it) => flat.push({ ...it, _section: si })));

  // STEP 1 — every modifier of every group of every item, ONE bulk call; then the groups.
  const modifierPlan = [];
  const groupPlan = [];
  flat.forEach((it, ii) => (it.modifierGroups || []).forEach((g, gi) => {
    groupPlan.push({ ...g, _item: ii, _group: gi, _modifierIdx: (g.modifiers || []).map((m) => modifierPlan.push(m) - 1) });
  }));
  const modifierIds = await createModifiers(ctx, modifierPlan);
  const groupIds = await createModifierGroups(ctx, groupPlan.map((g) => ({
    ...g,
    modifiers: g._modifierIdx.map((mi) => ({ ...modifierPlan[mi], id: modifierIds[mi] })).filter((m) => m.id),
  })));
  const groupIdsByItem = flat.map(() => []);
  groupPlan.forEach((g, i) => groupIdsByItem[g._item].push(groupIds[i]));

  // STEP 2 — every variant of every variant-priced item, ONE bulk call.
  const variantPlan = [];
  const variantIdxByItem = flat.map((it) => (it.variants || []).map((v) => variantPlan.push(v) - 1));
  const variantIds = await createVariants(ctx, variantPlan);

  // STEP 3 — bulk-create every item across all sections in ONE request.
  const bodies = flat.map((it, i) => itemBody(it, { variantIds: variantIdxByItem[i].map((vi) => variantIds[vi]), groupIds: groupIdsByItem[i] }));
  const itemRes = await req(ctx, "/restaurants/menus/v1/bulk/items/create", { body: { items: bodies, returnEntity: true } });
  const createdItems = bulkEntities(itemRes);
  const itemIdsBySection = menu.sections.map(() => []);
  flat.forEach((it, i) => {
    const id = createdItems[i]?.id;
    if (id) itemIdsBySection[it._section].push(id);
  });

  // STEP 4 — bulk-create sections, each carrying the itemIds of its items in display order.
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
  const sectionIds = bulkEntities(secRes).map((s) => s?.id);

  // STEP 5 — create the menu (single create wraps in `menu`), carrying its sectionIds.
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
    items: createdItems.map((it, i) => ({ id: it?.id, revision: it?.revision, body: bodies[i] })),
  };
}

// Restaurants binds an item image by Wix Media file ID — an external url must be imported
// first; a plan `imagePrompt` is generated (Wix AI, 1 credit) then imported. Both live in the
// shared util (parallel, resilient, never blocks the seed).
export { importImage } from "../../shared/seed/images.mjs";

// Image pass. Update Item is a FULL-ENTITY REPLACE with NO field mask — each entry MUST echo
// the item's current `revision` AND every field it was created with (its `body`: pricing, modifier
// groups, order settings), or the pricing fails 428 MISSING_ITEM_PRICING / the groups are wiped.
// `image` is an OBJECT { id, url, height, width } (never a bare string); the binding field is the
// Wix Media file `id`.
// items: [{ id, revision, body, image: { id, url, height, width } }]
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/bulk-update-item.md
// The bulk update returns 200 on PARTIAL failure: each item's outcome is in
// results[].itemMetadata (success, error, originalIndex). Returns { attached: [id], failures: [{ id, error }] }.
export async function attachItemImages(ctx, items) {
  const r = await req(ctx, "/restaurants/menus/v1/bulk/items/update", {
    body: {
      items: items.map((it) => ({
        item: { ...(it.body ?? { priceInfo: { price: money(it.price) } }), id: it.id, revision: it.revision, image: it.image },
      })),
    },
  });
  return bulkOutcome(items, r.results);
}

// Pair a bulk response's results[] to the inputs by originalIndex; an input with no result did not persist.
export function bulkOutcome(items, results) {
  const attached = [];
  const failures = [];
  for (const x of results ?? []) {
    const src = items[x.itemMetadata?.originalIndex];
    if (!src) continue;
    if (x.itemMetadata?.success) attached.push(src.id);
    else failures.push({ id: src.id, error: x.itemMetadata?.error?.description ?? x.itemMetadata?.error?.code ?? "unknown" });
  }
  for (const it of items) if (!attached.includes(it.id) && !failures.some((f) => f.id === it.id)) failures.push({ id: it.id, error: "no result for item" });
  return { attached, failures };
}

// ---- business location (shared STEP 0 for ordering + reservations) ------------------------------
// Update Location is a FULL OVERRIDE — send the WHOLE `location` object (omitted fields are
// wiped), echo `default:true` (omitting it 400s CHANGE_DEFAULT_FORBIDDEN) and the current
// `revision`. address.country is a 2-letter ISO code. Without a real address, ordering is
// "testing only" and checkout breaks — a placeholder must be flagged to the owner.
// location: { name, timeZone, email?, phone?, address: { country, subdivision, city,
//             postalCode, streetAddress: { number, name }, formattedAddress } }
// docs: https://dev.wix.com/docs/api-reference/business-management/locations/list-locations.md
// docs: https://dev.wix.com/docs/api-reference/business-management/locations/create-location.md
// docs: https://dev.wix.com/docs/api-reference/business-management/locations/update-location.md
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

// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/list-operations.md
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
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/update-operation.md
export async function enableOperation(ctx, operationId, revision) {
  return req(ctx, `/restaurants-operations/v1/operations/${operationId}`, {
    method: "PATCH",
    body: { operation: { revision, onlineOrderingStatus: "ENABLED" } },
  });
}

// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/query-menu-ordering-settings.md
export async function queryMenuOrderingSettings(ctx) {
  const r = await req(ctx, "/menu-ordering-settings/v1/menu-ordering-settings/query", { body: { query: {} } });
  return r.menuOrderingSettings ?? [];
}

// Only when an entry shows onlineOrderingEnabled:false / operationId:"none".
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/update-menu-ordering-settings.md
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

// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/list-reservation-locations.md
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
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/update-reservation-location.md
export async function updateReservationLocation(ctx, reservationLocationId, revision, configuration) {
  return req(ctx, `/table-reservations/reservation-locations/v1/reservation-locations/${reservationLocationId}`, {
    method: "PATCH",
    body: { reservationLocation: { id: reservationLocationId, revision, configuration } },
  });
}

// PREMIUM-ONLY: on a non-premium site this THROWS `428 PREMIUM_ONLY` — expected and
// non-fatal; the caller records it and continues (never retry-spiral, never fail the seed).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/update-reservation-location.md
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
 * ONE-CALL seed: Menus install (+ a report of what the app already holds) → menus bottom-up → images →
 * ordering add-on → reservations add-on, ids threaded in memory. The default path.
 */
export async function setupRestaurants(ctx, plan) {
  // Before any item exists: an item's price is stored in the site currency.
  if (plan.currency) await setSiteCurrency(ctx, plan.currency);
  const menusPlan = plan.menus ?? [];
  const wasPresent = await menusAppPresent(ctx);
  await installMenusApp(ctx);
  // Menus the plan did not create: the install's sample "Dinner Menu" on a fresh site (polled, it
  // provisions async), the owner's menus on an existing one. Reported for the closing message,
  // never deleted.
  const preexistingMenus = await readPreexistingMenus(ctx, { tries: wasPresent ? 1 : 8 }).catch(() => []);

  const createdMenus = [];
  for (const m of menusPlan) createdMenus.push(await createMenu(ctx, m));

  // image pass — resolve each item's image (import by url / generate by prompt) in ONE
  // parallel wave (restaurants binds by file id), then bulk full-replace with revision +
  // the item's created body echoed. Never block on image failure.
  let imagesAttached = 0;
  const imageItems = [];
  menusPlan.forEach((m, mi) => {
    const flat = m.sections.flatMap((s) => s.items || []);
    flat.forEach((it, i) => {
      const created = createdMenus[mi]?.items?.[i];
      if ((it.imageUrl || it.imagePath || it.imagePrompt) && created?.id) {
        imageItems.push({ ...created, imageUrl: it.imageUrl, imagePath: it.imagePath, imagePrompt: it.imagePrompt, name: it.name });
      }
    });
  });
  const files = await resolveItemImages(ctx, imageItems.map((it) => ({
    url: it.imageUrl,
    path: it.imagePath,
    prompt: it.imagePrompt,
    displayName: `${it.name || "item"}.png`,
  })));
  const toAttach = imageItems
    .map((it, i) => (files[i]
      ? { id: it.id, revision: it.revision ?? "1", body: it.body,
          image: { id: files[i].id, url: files[i].url, width: 1024, height: 1024 } }
      : null))
    .filter(Boolean);
  const imageFailures = [];
  if (toAttach.length) {
    try {
      const r = await attachItemImages(ctx, toAttach);
      imagesAttached = r.attached.length;
      for (const f of r.failures) imageFailures.push(f);
    } catch (e) {
      for (const it of toAttach) imageFailures.push({ id: it.id, error: e?.message ?? String(e) });
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
    imageFailures,
    preexistingMenus,
    dashboardMenusUrl: `https://manage.wix.com/dashboard/${ctx.siteId}/restaurants/menus`,
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
