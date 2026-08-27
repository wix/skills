// CMS seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/cms/seed/seed-cms.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Data (CMS) app if needed,
// creates each collection (field schema + permissions; an existing collection is left
// as-is), imports IMAGE-field urls into Wix Media, bulk-inserts items, wires
// multi-references, and verifies persistence. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "collections": [{ "id", "displayName"?, "permissions"?,
//       "fields": [{ "key", "displayName"?, "type", "referencedCollectionId"? }],
//       "items": [{ "<fieldKey>": value, ... }] }] }
// Reference fields: order collections so targets come FIRST. A REFERENCE value is the
// target item's index in ITS collection's items array; MULTI_REFERENCE is an array of
// indices.
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Unexpected shapes →
// read the live API reference; authoritative source recipe:
// wix-headless/references/inline-recipes/setup-cms.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const API = "https://www.wixapis.com";
const WIX_DATA_APP_ID = "e593b0bd-b783-45b8-97c2-873d42aacaf4";

// Public collection default: read MUST be "ANYONE" or a visitor query silently returns 0
// items (the single most common "empty page" cause). Other presets: SEED.md.
const DEFAULT_PERMISSIONS = { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ANYONE" };

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

// A fresh site's Wix Data backend can transiently fail its FIRST calls while provisioning —
// 403, 400 WDE0117 ("MetaSite not found"), or 5xx. Retry the same body ONCE after ~3s, then
// fail loud (never loop).
async function reqRetryOnce(ctx, path, opts) {
  try {
    return await req(ctx, path, opts);
  } catch (e) {
    const m = String(e.message);
    if (/-> (403|5\d\d):/.test(m) || m.includes("WDE0117")) {
      await sleep(3000);
      return req(ctx, path, opts);
    }
    throw e;
  }
}

// ---- operations ----------------------------------------------------------------------------------

// Idempotent; strictly only needed when a data call errors WDE0110 (app not installed).
export async function installDataApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: WIX_DATA_APP_ID, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}

// The binding key is referencedCollectionId — the docs' stale `referencedCollection` is
// accepted with a 200 but stores an EMPTY target, leaving every later link silently dead.
// MULTI_REFERENCE additionally REQUIRES referencingFieldKey — the auto-created back-reference
// field on the referenced collection (400 without it); synthesized from the owning
// collection + field when the plan doesn't name one.
function buildField(f, collectionId) {
  const out = { key: f.key, displayName: f.displayName ?? f.key, type: f.type };
  if (f.type === "MULTI_REFERENCE" || f.type === "REFERENCE") {
    if (!f.referencedCollectionId) {
      throw new Error(`field "${f.key}": ${f.type} requires referencedCollectionId`);
    }
    out.typeMetadata =
      f.type === "MULTI_REFERENCE"
        ? { multiReference: {
            referencedCollectionId: f.referencedCollectionId,
            referencingFieldKey: f.referencingFieldKey ?? `${collectionId}_${f.key}`.replace(/[^a-zA-Z0-9_]/g, "_"),
            referencingDisplayName: f.referencingDisplayName ?? `${displayNameOf(collectionId)} (${f.key})`,
          } }
        : { reference: { referencedCollectionId: f.referencedCollectionId } };
  }
  return out;
}

const displayNameOf = (id) => String(id).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// The permissions block is MANDATORY. 409 WDE0104 (already exists) is fine — additive.
export async function createCollection(ctx, { id, displayName, fields = [], permissions }) {
  try {
    await reqRetryOnce(ctx, "/wix-data/v2/collections", { body: { collection: {
      id,
      displayName: displayName ?? id,
      fields: fields.map((f) => buildField(f, id)),
      permissions: permissions ?? DEFAULT_PERMISSIONS,
    } } });
    return { id, created: true };
  } catch (e) {
    const m = String(e.message);
    if (m.includes("WDE0104") || m.includes("-> 409:")) return { id, created: false };
    throw e;
  }
}

// An IMAGE field stores a permanent Wix Media URL — an external url must be imported first.
export async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.url) throw new Error(`import-file returned no file url: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

// Ids come from results[].dataItem.id (there is no results[].item key).
export async function bulkInsertItems(ctx, dataCollectionId, dataItems) {
  const r = await reqRetryOnce(ctx, "/wix-data/v2/bulk/items/insert", { body: {
    dataCollectionId,
    dataItems: dataItems.map((data) => ({ data })),
    returnEntity: true,
  } });
  const results = [...(r.results ?? [])].sort(
    (a, b) => (a.itemMetadata?.originalIndex ?? 0) - (b.itemMetadata?.originalIndex ?? 0),
  );
  return {
    ids: results.map((res) => res.dataItem?.id ?? res.itemMetadata?.id),
    failures: r.bulkActionMetadata?.totalFailures ?? 0,
  };
}

// Body key is dataItemReferences with referringItemFieldName/referringItemId/referencedItemId
// — the natural-looking `references` shape is rejected with 400 WDE0080.
export async function insertReferences(ctx, dataCollectionId, dataItemReferences) {
  if (!dataItemReferences.length) return 0;
  const r = await req(ctx, "/wix-data/v2/bulk/items/insert-references", {
    body: { dataCollectionId, dataItemReferences },
  });
  return r.bulkActionMetadata?.totalSuccesses ?? dataItemReferences.length;
}

// A 200 on insert does NOT prove persistence — query back and count.
export async function verifyItems(ctx, dataCollectionId) {
  const r = await reqRetryOnce(ctx, "/wix-data/v2/items/query", { body: { dataCollectionId } });
  return (r.dataItems ?? []).length;
}

// plan item -> insert `data`, per field type. MULTI_REFERENCE values are silently dropped by
// the insert endpoint (200, no error) — stripped here and wired after; a single REFERENCE is
// set at insert as the target item's _id. DATE/DATETIME wrap as { "$date": iso }; RICH_TEXT
// is an HTML string stored verbatim; IMAGE urls are imported to Wix Media first.
async function buildItemData(ctx, col, item, idsByCollection, multiRefs, itemIndex, counters) {
  const fieldsByKey = new Map((col.fields ?? []).map((f) => [f.key, f]));
  const data = {};
  for (const [key, value] of Object.entries(item)) {
    const f = fieldsByKey.get(key);
    // A key the schema doesn't have is silently dropped by the API — fail loud instead.
    if (!f) throw new Error(`"${col.id}" item ${itemIndex}: key "${key}" is not in the collection's fields`);
    if (value == null) continue;
    if (f.type === "MULTI_REFERENCE") {
      for (const targetIndex of [].concat(value)) {
        multiRefs.push({ itemIndex, fieldKey: key, targetCollectionId: f.referencedCollectionId, targetIndex });
      }
      continue;
    }
    if (f.type === "REFERENCE") {
      const targetId = (idsByCollection.get(f.referencedCollectionId) ?? [])[value];
      if (!targetId) {
        throw new Error(
          `"${col.id}" item ${itemIndex}: REFERENCE "${key}" -> "${f.referencedCollectionId}"[${value}] — ` +
            `target not created yet (order collections so targets come first)`,
        );
      }
      data[key] = targetId;
      continue;
    }
    if (f.type === "IMAGE") {
      try {
        const file = await importImage(ctx, value, `${col.id}-${itemIndex}-${key}.png`);
        data[key] = file.url;
        counters.imagesImported++;
      } catch {
        /* never block on image failure — the item stays text-only */
      }
      continue;
    }
    if (f.type === "DATE" || f.type === "DATETIME") {
      data[key] = { $date: new Date(value).toISOString() };
      continue;
    }
    data[key] = value;
  }
  return data;
}

/**
 * ONE-CALL seed: install → per collection (in plan order): create → import images →
 * bulk-insert → wire multi-references → verify; ids threaded in memory. The default path.
 */
export async function setupCms(ctx, { collections = [] } = {}) {
  await installDataApp(ctx);

  const idsByCollection = new Map();
  const out = { collections: [] };
  for (const col of collections) {
    const created = await createCollection(ctx, col);

    const counters = { imagesImported: 0 };
    const multiRefs = [];
    const dataItems = [];
    const planItems = col.items ?? [];
    for (let i = 0; i < planItems.length; i++) {
      dataItems.push(await buildItemData(ctx, col, planItems[i], idsByCollection, multiRefs, i, counters));
    }

    let ids = [];
    let failures = 0;
    if (dataItems.length) ({ ids, failures } = await bulkInsertItems(ctx, col.id, dataItems));
    idsByCollection.set(col.id, ids);

    const refs = multiRefs.map(({ itemIndex, fieldKey, targetCollectionId, targetIndex }) => {
      const referringItemId = ids[itemIndex];
      const referencedItemId = (idsByCollection.get(targetCollectionId) ?? [])[targetIndex];
      if (!referringItemId || !referencedItemId) {
        throw new Error(
          `"${col.id}" item ${itemIndex}: multi-reference "${fieldKey}" -> "${targetCollectionId}"[${targetIndex}] ` +
            `has no created id (order collections so targets come first)`,
        );
      }
      return { referringItemFieldName: fieldKey, referringItemId, referencedItemId };
    });
    const referencesLinked = await insertReferences(ctx, col.id, refs);

    out.collections.push({
      id: col.id,
      created: created.created,
      inserted: ids.length,
      failures,
      imagesImported: counters.imagesImported,
      referencesLinked,
      itemsInCollection: await verifyItems(ctx, col.id),
    });
  }
  return out;
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-cms.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupCms(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
