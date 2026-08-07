// CMS (Wix Data v2) seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Data
// request/response mechanics (the mandatory permissions block, the public-read default,
// the member-scoped variants, the reference typeMetadata key, the dataItem/dataItemReferences
// body shapes, the provisioning-race retry, the read-merge-PUT image attach) live here, once.
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/cms/seed/seed-cms.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//   await seed.installCmsApp(ctx);                                        // if WDE0110 (app not installed)
//   const col = await seed.createCollection(ctx, {                       // STEP 1 (public-read default)
//     id: "team-members", displayName: "Team Members",
//     fields: [{ key: "name", displayName: "Name", type: "TEXT" }, { key: "order", displayName: "Order", type: "NUMBER" }],
//   });
//   const items = await seed.bulkInsertItems(ctx, "team-members", [       // STEP 2 (plain fields only)
//     { name: "Ada Lovelace", role: "Founder", order: 1 },
//   ]);
//   const rows = await seed.queryItems(ctx, "team-members");             // STEP 3 (verify persisted)
//   await seed.insertReferences(ctx, "recipes", [                        // STEP 4 (only if collections relate)
//     { referringItemFieldName: "categories", referringItemId: recipeId, referencedItemId: categoryId },
//   ]);
//   await seed.attachItemImage(ctx, "team-members", { itemId, imageFieldKey: "photo", url: fileUrl }); // imagery ON only
//
// **NOT yet live-verified — transcribed from setup-cms.md.**
//
// If any call fails with a shape the caller didn't expect, fall back to the wix-docs skill
// (search + read the live Wix API reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-cms.md.

const API = "https://www.wixapis.com";
const CMS_APP_ID = "e593b0bd-b783-45b8-97c2-873d42aacaf4"; // per recipe (Wix Data app; WDE0110 = not installed)

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

// A fresh site's Wix Data backend can fail the FIRST few create/insert calls transiently
// (403 on create, 400 WDE0117 "MetaSite not found" on insert, or 5xx) — a provisioning race that
// self-heals in seconds. Retry the SAME body ONCE, then fail loud; never loop (per recipe).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isTransient(err) {
  const m = String(err && err.message);
  return /-> 403:/.test(m) || /-> 5\d\d:/.test(m) || m.includes("WDE0117");
}
async function retryOnce(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isTransient(err)) throw err;
    await sleep(3000);
    return await fn();
  }
}

// Permission presets — the `permissions` block is MANDATORY on create (per recipe).
// Default is publicRead: a headless visitor token reads but cannot elevate, so a PUBLIC
// collection's `read` MUST be "ANYONE" or the visitor query returns zero items with no error.
// Write verbs stay "ADMIN" (only the seed token writes) unless the site lets visitors write.
const PERMISSIONS = {
  // admin-owned content, anyone reads (the default)
  publicRead: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ANYONE" },
  // visitor-written shared/global data (guestbook, community board) — the only open-write level
  // the anonymous visitor token supports; NO per-user scoping (any visitor edits any row)
  collaborative: { read: "ANYONE", insert: "ANYONE", update: "ANYONE", remove: "ANYONE" },
  // per-user-private "my …" data — member sees/edits only their OWN rows (_owner-matched);
  // runs on the member token; seed such a collection EMPTY (members populate it themselves)
  memberPrivate: { read: "SITE_MEMBER_AUTHOR", insert: "SITE_MEMBER", update: "SITE_MEMBER_AUTHOR", remove: "SITE_MEMBER_AUTHOR" },
  // gated content: any logged-in member reads, only the seed/admin writes
  memberSharedReadOnly: { read: "SITE_MEMBER", insert: "ADMIN", update: "ADMIN", remove: "ADMIN" },
};

// ---- exported operations ----

// Install the Wix Data (CMS) app if the site doesn't have it (WDE0110 on a data call = not installed).
async function installCmsApp(ctx) {
  return req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
    tenant: { tenantType: "SITE", id: ctx.siteId },
    appInstance: { appDefId: CMS_APP_ID, enabled: true },
  } });
}

/**
 * STEP 1 — create ONE collection (public-read by default).
 * @param col { id, displayName, fields, permissions? }
 *   fields = the Wix Data field schema verbatim ([{ key, displayName, type, typeMetadata? }]).
 *     A REFERENCE/MULTI_REFERENCE field MUST carry `typeMetadata.(multiReference|reference).referencedCollectionId`
 *     (NOT `referencedCollection` — the docs' stale key stores an empty target and every later link is dead);
 *     the target collection must be created FIRST.
 *   permissions = one of PERMISSIONS.* or a custom { insert, update, remove, read } block. Default: publicRead.
 * @returns the created collection (its `id` is the value you sent — Wix does not rename it; keep it + the field keys).
 */
async function createCollection(ctx, { id, displayName, fields, permissions = PERMISSIONS.publicRead }) {
  const r = await retryOnce(() =>
    req(ctx, "/wix-data/v2/collections", {
      body: { collection: { id, displayName, fields, permissions } },
    }));
  return r.collection ?? r;
}

/**
 * STEP 2 — bulk-insert a collection's items in ONE call.
 * @param items plain field-value objects ([{ name, role, order }]). Each is wrapped as { data } internally.
 *   Set plain fields + single REFERENCE fields (pass the referenced item's `_id` string) only.
 *   Do NOT put a MULTI_REFERENCE value here — it is SILENTLY DROPPED (no error); wire it in STEP 4.
 * @returns [{ id, data }] — item id read from results[].dataItem.id (NOT results[].item).
 */
async function bulkInsertItems(ctx, dataCollectionId, items) {
  const r = await retryOnce(() =>
    req(ctx, "/wix-data/v2/bulk/items/insert", {
      body: { dataCollectionId, dataItems: items.map((data) => ({ data })), returnEntity: true },
    }));
  return (r.results ?? []).map((x) => ({ id: x.dataItem?.id, data: x.dataItem?.data }));
}

/**
 * STEP 2 (single) — insert one item; equivalent to bulkInsertItems for a one-item collection.
 * @returns { id, data } — from the single-insert `dataItem` wrapper.
 */
async function insertItem(ctx, dataCollectionId, data) {
  const r = await retryOnce(() =>
    req(ctx, "/wix-data/v2/items", { body: { dataCollectionId, dataItem: { data } } }));
  return { id: r.dataItem?.id, data: r.dataItem?.data };
}

// STEP 3 — query a collection to verify inserts persisted (a POST without an error does NOT prove it).
// The recipe documents only the query body `{ dataCollectionId }`, not the response shape — this maps the
// standard `dataItems` wrapper; if the shape differs, fall back to wix-docs. // per recipe
async function queryItems(ctx, dataCollectionId) {
  const r = await req(ctx, "/wix-data/v2/items/query", { body: { dataCollectionId } });
  return (r.dataItems ?? []).map((d) => ({ id: d.id, data: d.data }));
}

/**
 * STEP 4 — wire MULTI_REFERENCE links (skip unless collections relate).
 * @param references [{ referringItemFieldName, referringItemId, referencedItemId }]
 *   referringItemFieldName = the multi-reference field key on the referring collection;
 *   referringItemId = that item's id; referencedItemId = the target item's id. Both ids from STEP 2.
 *   Resolves ONLY if the field was created with a non-empty referencedCollectionId (STEP 1).
 */
async function insertReferences(ctx, dataCollectionId, references) {
  return req(ctx, "/wix-data/v2/bulk/items/insert-references", {
    body: { dataCollectionId, dataItemReferences: references },
  });
}

// Attach a generated image to an item (imagery ON only). Read-merge-PUT — a partial PUT wipes omitted
// fields, so query the item, merge the url into its IMAGE field key, and PUT the WHOLE record back.
// Never block on image failure — on failure skip and leave the item text-only. url = the permanent
// wixstatic.com file.url (an IMAGE field stores the URL string).
async function attachItemImage(ctx, dataCollectionId, { itemId, imageFieldKey, url }) {
  const rows = await queryItems(ctx, dataCollectionId);
  const row = rows.find((x) => x.id === itemId);
  if (!row) throw new Error(`attachItemImage: item ${itemId} not found in ${dataCollectionId}`);
  const data = { ...row.data, _id: itemId, [imageFieldKey]: url };
  return req(ctx, `/wix-data/v2/items/${itemId}`, { method: "PUT", body: { dataCollectionId, dataItem: { data } } });
}

module.exports = {
  PERMISSIONS,
  installCmsApp, createCollection,
  bulkInsertItems, insertItem, queryItems,
  insertReferences, attachItemImage,
};
