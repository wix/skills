// Storefront seed — a BUILD-TIME script, never shipped in the app. Run it from the project
// root (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/storefront/seed/seed-store.mjs plan.json
//
// It mints its own site token via the Wix CLI (the token never leaves this process), installs
// the Wix Stores app if needed, waits for the V3 catalog, bulk-creates products (variants
// expanded, descriptions converted to rich text), creates categories (serially — the shared
// tree 409s on concurrent creates), assigns products, and attaches images. Prints a JSON
// result to stdout.
//
// Plan shape (see SEED.md):
//   { "products": [{ "name", "description", "price", "compareAtPrice"?, "quantity",
//                    "options"?: [{ "name", "type"?: "text"|"color",
//                                   "choices": ["S","M"] | [{ "name", "colorCode"?, "imageMediaId"? | "imageUrl"? | "imagePath"? | "imagePrompt"?, "altText"? }] }],
//                    "variantPrices"?: { "<choice name>": price },
//                    "ribbon"?, "modifiers"?: [{ "name", "type"?: "choices"|"text", "mandatory"?,
//                                              "choices"?: ["Gift wrap"], "maxChars"?, "minChars"? }],
//                    "infoSections"?: [{ "title", "description" }],
//                    "preorder"?: { "message"?, "limit"? },
//                    "imageMediaId"? | "imageUrl"? | "imagePath"? | "imagePrompt"?, "altText"?,
//                    "digitalFileUrl"? | "digitalFilePath"?, "digitalFileName"? }],
//     "categories"?: { "<category name>": ["<product name>", ...] },
//     "categoryDetails"?: { "<category name>": { "description"?, "imageUrl"? | "imagePath"? | "imagePrompt"? } } }
//
// Seeding is ADDITIVE — this script never deletes or overwrites existing content.
// If a call fails with an unexpected shape, read the live API reference (every call below
// carries a docs: line with its reference page) — never guess.
import { setSiteCurrency } from "../../shared/seed/site.mjs";
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { resolveItemImages, resolveItemImagesDetailed } from "../../shared/seed/images.mjs";
import { seedSiteId } from "../../shared/seed/site-context.mjs";
import { wixToken } from "../../shared/seed/wix-cli.mjs";
import { isMain } from "../../shared/seed/main.mjs";
import { buildInfoSections, buildModifiers, buildOptions, expandVariants, mkDesc, preorderInfo, validateProducts } from "./seed-store-plan.mjs";
// Importers of this module keep the plan validation where it was.
export { validateProducts };

const API = "https://www.wixapis.com";
const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

// ---- auth: siteId from wix.config.json, token minted by the Wix CLI ----------------------------

export function makeCtx({ cwd = process.cwd() } = {}) {
  // The content site: the config's site, or the parent on a migration preview (site-context.mjs stops
  // a seed there unless --allow-parent is passed after the user confirmed).
  const siteId = seedSiteId({ cwd, argv: process.argv });
  // The CLI returns a byte-identical token within a run — mint once, reuse.
  const token = wixToken(siteId, cwd);
  return { token, siteId };
}

// ---- transport ----------------------------------------------------------------------------------

async function req(ctx, path, { method = "POST", body } = {}) {
  // Retry while the catalog is still provisioning: right after a fresh Stores install the V3
  // WRITE path becomes usable later than the read path, so the first bulk-create can 428 even
  // after the read probe clears. Wait it out (~80s budget); other errors throw immediately.
  // ⚠️ An errored bulk create (seen live with a bare 429 {}) may still have APPLIED
  // server-side — creation is idempotent by name in setupStore for exactly that reason.
  for (let attempt = 0; ; attempt++) {
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
    if (res.ok) return json;
    if (isProvisioning(res.status, json) && attempt < 40) {
      await sleep(2000);
      continue;
    }
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A freshly installed catalog signals "not writable yet" with a 428 under (at least) two codes.
const PROVISIONING_CODES = new Set(["CATALOG_V1_SITE_CALLING_CATALOG_V3_API", "CATALOG_V3_SITE_PROVISIONING"]);

function isProvisioning(status, json) {
  if (PROVISIONING_CODES.has(json?.details?.applicationError?.code)) return true;
  return status === 428 && /provision/i.test(json?.message || "");
}

// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md
async function waitForCatalogV3(ctx, { attempts = 40, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${API}/stores/v3/products/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}`, "wix-site-id": ctx.siteId, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { paging: { limit: 1 } } }),
    });
    if (res.ok) return;
    const json = await res.json().catch(() => ({}));
    if (!isProvisioning(res.status, json)) return;
    await sleep(delayMs);
  }
}

// ---- operations ---------------------------------------------------------------------------------

// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installStoresApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: STORES_APP_ID, enabled: true },
    } });
  } catch {
    // already installed is fine — the readiness wait below still confirms the V3 catalog is live
  }
  await waitForCatalogV3(ctx);
}

// Existing products by exact name (for idempotent reruns). `name` is NOT filterable on the
// V3 query — fetch a page and match client-side (seed catalogs are small). Empty map on any
// failure — falling back to create-everything is the additive behavior we had before.
/** Every product in the catalog (id, name, slug, revision), cursor-paged. Throws on a failed read. */
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md
export async function readAllProducts(ctx) {
  const out = [];
  let cursor;
  do {
    const r = await req(ctx, "/stores/v3/products/query", { body: { query: { cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) } } } });
    for (const p of r.products ?? []) out.push({ id: p.id, name: p.name, slug: p.slug, revision: p.revision });
    cursor = r.pagingMetadata?.cursors?.next || undefined;
  } while (cursor);
  return out;
}

export async function queryProductsByNames(ctx, names, all) {
  const out = new Map();
  if (!names.length) return out;
  try {
    const wanted = new Set(names);
    for (const p of all ?? (await readAllProducts(ctx))) {
      if (wanted.has(p.name) && !out.has(p.name)) out.set(p.name, { id: p.id, slug: p.slug, revision: p.revision });
    }
  } catch (e) {
    console.error(`product name pre-check failed (creating everything): ${String(e.message).slice(0, 120)}`);
  }
  return out;
}

// A digital variant is SELLABLE only with BOTH a file and stock: without the file the cart rejects
// it as ITEM_NOT_FOUND_IN_CATALOG, without stock as "exceeds available inventory" — and either way
// the product reads back visible and in the catalog, so nothing surfaces until a buyer tries to buy.
// A digitalFile* field is the only way into DIGITAL here, which makes the file-less product
// unbuildable. The bytes are PUT, not imported by url: an uploaded file is READY at once, while an
// imported one stays PENDING and the cart rejects the product until it settles.
// docs: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/generate-file-upload-url.md
const FILE_MIME = { pdf: "application/pdf", zip: "application/zip", epub: "application/epub+zip",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", png: "image/png", jpg: "image/jpeg" };

async function uploadDigitalFile(ctx, { digitalFileUrl, digitalFilePath, digitalFileName }) {
  const src = digitalFilePath ?? digitalFileUrl;
  const fileName = digitalFileName || decodeURIComponent(basename(new URL(src, "file:").pathname));
  const mimeType = FILE_MIME[fileName.split(".").pop().toLowerCase()];
  if (!mimeType) throw new Error(`digitalFileName needs one of these extensions (${Object.keys(FILE_MIME).join(", ")}): ${fileName}`);
  const bytes = digitalFilePath
    ? readFileSync(digitalFilePath)
    : await fetch(digitalFileUrl).then((r) => {
        // Don't invent a file and don't ship an unbuyable DIGITAL product: seed it PHYSICAL
        // with stock (drop digitalFileUrl/digitalFilePath, set inStock or a quantity) and
        // tell the user the download still needs a real file.
        if (!r.ok) throw new Error(`digitalFileUrl ${digitalFileUrl} -> ${r.status}. No fetchable file: re-seed this product as PHYSICAL with stock and tell the user it needs a real file before it can be sold as a download.`);
        return r.arrayBuffer();
      });
  const { uploadUrl } = await req(ctx, "/site-media/v1/files/generate-upload-url", { body: { mimeType, fileName } });
  const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: bytes });
  const json = await res.json().catch(() => ({}));
  const id = (json.file || json)?.id;
  if (!res.ok || !id) throw new Error(`digital file upload failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  return id;
}

// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-create-products-with-inventory.md
export async function bulkCreateProducts(ctx, products) {
  const fileIds = await Promise.all(products.map((p) =>
    p.digitalFileUrl || p.digitalFilePath ? uploadDigitalFile(ctx, p) : null));
  const body = {
    returnEntity: true,
    products: products.map((p, i) => ({
      name: p.name,
      // DIGITAL drops physicalProperties and can't be POS-visible (DIGITAL_PRODUCT_CANNOT_BE_VISIBLE_IN_POS).
      ...(fileIds[i]
        ? { productType: "DIGITAL" }
        : { productType: "PHYSICAL", physicalProperties: {}, visibleInPos: true }),
      visible: true,
      description: mkDesc(p.description, i),
      options: buildOptions(p.options),
      // ribbons, modifiers and info sections are created inline by name, like options
      ...(p.ribbon ? { ribbon: { name: p.ribbon } } : {}),
      ...(p.modifiers?.length ? { modifiers: buildModifiers(p.modifiers) } : {}),
      ...(p.infoSections?.length ? { infoSections: buildInfoSections(p.infoSections, i) } : {}),
      variantsInfo: { variants: expandVariants(p.options, p, fileIds[i]) },
    })),
  };
  const r = await req(ctx, "/stores/v3/bulk/products-with-inventory/create", { body });
  // NB: results nest under productResults.results[].item — NOT a top-level `results`.
  // The bulk returns 200 even on PARTIAL failure, so never map results by array position:
  // pair each result to its input via itemMetadata.originalIndex and drop the ones that
  // didn't persist. Positional mapping shifts every id after a failure onto the wrong
  // product — which then mislabels categories and attaches images to the wrong items.
  const created = [];
  const failures = [];
  for (const x of r.productResults?.results ?? []) {
    const i = x.itemMetadata?.originalIndex;
    const src = typeof i === "number" ? products[i] : undefined;
    if (!x.itemMetadata?.success || !x.item?.id) {
      failures.push({
        name: src?.name,
        error: x.itemMetadata?.error?.description ?? x.itemMetadata?.error?.code ?? "unknown",
      });
      continue;
    }
    created.push({
      id: x.item.id, slug: x.item.slug, revision: x.item.revision, name: src?.name,
      variantId: x.item.variantsInfo?.variants?.[0]?.id,
      hasOptions: (src?.options?.length ?? 0) > 0,
      isDigital: !!fileIds[i],
      quantity: src?.quantity ?? 0,
      inStock: src?.inStock,
      preorder: src?.preorder,
    });
  }
  await stockOptionlessProducts(ctx, created);
  return {
    created: created.map((p) => ({ id: p.id, slug: p.slug, revision: p.revision, name: p.name })),
    failures,
  };
}

// The bulk create stocks a variant via its choices; an OPTION-LESS product's single default
// variant is NOT stocked by it and lands OUT_OF_STOCK — stock those explicitly.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-create-inventory-items.md
async function stockOptionlessProducts(ctx, created) {
  const need = created.filter((p) => !p.hasOptions && !p.isDigital && p.id); // digital variants ship inStock from the create
  if (!need.length) return;
  const missing = need.filter((p) => !p.variantId).map((p) => p.id);
  if (missing.length) {
    const q = await req(ctx, "/stores/v3/products/query", { body: { query: { filter: { id: { $in: missing } }, paging: { limit: missing.length } } } });
    const vById = new Map((q.products ?? []).map((p) => [p.id, p.variantsInfo?.variants?.[0]?.id]));
    need.forEach((p) => { if (!p.variantId) p.variantId = vById.get(p.id); });
  }
  // inStock:true == untracked stock (always buyable, no count). Only send a quantity when the
  // product actually tracks one, or Wix rejects the pair; pre-order rides on the counted item.
  const inventoryItems = need
    .filter((p) => p.variantId)
    .map((p) => ({
      productId: p.id,
      variantId: p.variantId,
      ...(p.inStock === true ? { inStock: true } : { quantity: p.quantity, ...(p.preorder ? { preorderInfo: preorderInfo(p.preorder) } : {}) }),
    }));
  if (inventoryItems.length) {
    await req(ctx, "/stores/v3/bulk/inventory-items/create", { body: { inventoryItems } });
  }
}

// Existing categories by name (for idempotent reruns) — a re-run of the seed must reuse
// "Donuts", not create a second one. Empty map on any failure (falls back to create).
export async function queryCategoriesByNames(ctx, names) {
  const out = new Map();
  if (!names.length) return out;
  try {
    const r = await req(ctx, "/categories/v1/categories/query", {
      body: { treeReference: { appNamespace: "@wix/stores", treeKey: null }, query: { cursorPaging: { limit: 100 } } },
    });
    const wanted = new Set(names);
    for (const c of r.categories ?? []) if (wanted.has(c.name) && !out.has(c.name)) out.set(c.name, c.id);
  } catch (e) {
    console.error(`category name pre-check failed (creating everything): ${String(e.message).slice(0, 120)}`);
  }
  return out;
}

// Categories share the @wix/stores tree revision — concurrent creates 409, so: sequential.
// Idempotent by name: a name that already exists is reused, never duplicated (its description
// and image are left as they are). `details[name]` = { description?, imageUrl? } — the image is a
// Wix-hosted URL (resolveItemImages) passed at create time; the API re-hosts a full URL itself.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/create-category.md
export async function createCategories(ctx, names, details = {}) {
  const existing = await queryCategoriesByNames(ctx, names);
  const out = [];
  for (const name of names) {
    if (existing.has(name)) {
      out.push({ id: existing.get(name), name });
      continue;
    }
    const d = details[name] ?? {};
    const r = await req(ctx, "/categories/v1/categories", {
      body: {
        category: {
          name,
          visible: true,
          ...(d.description ? { description: String(d.description).slice(0, 600) } : {}),
          ...(d.imageUrl ? { image: { url: d.imageUrl } } : {}), // an Image OBJECT — a bare URL string is rejected
        },
        treeReference: { appNamespace: "@wix/stores", treeKey: null },
      },
    });
    out.push({ id: r.category?.id, name });
  }
  return out;
}


// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/bulk-add-items-to-category.md
export async function addProductsToCategories(ctx, mapping) {
  for (const [categoryId, productIds] of Object.entries(mapping)) {
    await req(ctx, `/categories/v1/bulk/categories/${categoryId}/add-items`, {
      body: {
        items: productIds.map((catalogItemId) => ({ catalogItemId, appId: STORES_APP_ID })),
        treeReference: { appNamespace: "@wix/stores", treeKey: null },
      },
    });
  }
}

// Bulk image attach in ONE call. items: [{ id, url, mediaId?, altText }] — no revision to pass: the
// current revision is read right before the update, so attach any number of times, any pass.
// An item with a mediaId (a file already in this site's Media Manager) is attached by that id and
// reused as it is; a bare url is re-hosted by Wix server-side, a new file each time. The media can
// take a little while to appear on read-back
// (propagation) — normal, not a failure.
// The bulk update returns 200 on PARTIAL failure, like the bulk create: each item's outcome is
// in results[].itemMetadata (success, error, originalIndex). Seen live (runs 85 and 86,
// 2026-09-26): one product of three came back with no media while the call succeeded — most
// likely its revision moved between the read and the update (variant stocking runs just
// before). So: pair results to inputs, retry the misses once with fresh revisions, and report
// what actually persisted. Returns { attached: [id], failures: [{ id, error }] }.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-products.md
// Writing `media.itemsInfo.items` REPLACES the gallery and CLEARS every choice's link into it (seen
// live: a re-sent gallery came back with the links empty; a gallery that drops a linked item is
// refused outright, "Missing media files. Products must include media files linked to choices").
// So the attach merges: the items already there are re-sent by id, only a url not yet in the
// gallery (by file name) is added, a product with nothing new is left untouched, and a product
// whose choices were linked (by this seed or by the owner in the dashboard) gets those links put
// back right after.
const sameFile = (a, b) => a && b && basename(a) === basename(b);
// A file attached by id keeps its own display name as the item's filename, so it is found by id.
const galleryHas = (items, url, mediaId) => items.some((it) => (mediaId && it.id === mediaId) || sameFile(it.image?.filename, url) || sameFile(it.image?.url, url));

export async function attachProductImages(ctx, items) {
  if (!items?.length) return { attached: [], failures: [] };
  const send = async (batch) => {
    const ids = batch.map((it) => it.id);
    const q = await req(ctx, "/stores/v3/products/query", {
      body: { query: { filter: { id: { $in: ids } }, paging: { limit: ids.length } }, fields: ["MEDIA_ITEMS_INFO", "PRODUCT_CHOICES_MEDIA_REFERENCES", "VARIANT_OPTION_CHOICE_NAMES"] },
    });
    const byId = new Map((q.products ?? []).map((p) => [p.id, p]));
    const ok = new Set();
    const failed = [];
    const toSend = [];
    for (const it of batch) {
      const p = byId.get(it.id);
      const current = p?.media?.itemsInfo?.items ?? [];
      const wanted = it.images ?? [{ url: it.url, altText: it.altText }];
      const fresh = wanted.filter(({ url, mediaId }) => !galleryHas(current, url, mediaId));
      if (!fresh.length) { ok.add(it.id); continue; } // every image is already there
      // A file already in the Media Manager goes in by its id: set by url, Stores imports a copy.
      toSend.push({ it, p, items: [...current.map(({ id }) => ({ id })), ...fresh.map(({ url, mediaId, altText }) => (mediaId ? { id: mediaId, altText } : { url, altText }))] });
    }
    if (toSend.length) {
      const r = await req(ctx, "/stores/v3/bulk/products/update", {
        body: { products: toSend.map(({ it, p, items }) => ({ product: { id: it.id, revision: p?.revision, media: { itemsInfo: { items } } } })) },
      });
      for (const x of r.results ?? []) {
        const src = toSend[x.itemMetadata?.originalIndex];
        if (!src) continue;
        if (x.itemMetadata?.success) ok.add(src.it.id);
        else failed.push({ id: src.it.id, error: x.itemMetadata?.error?.description ?? x.itemMetadata?.error?.code ?? "unknown" });
      }
      // the gallery write cleared the choice links: put back the ones the product had
      for (const { it, p } of toSend) {
        if (!ok.has(it.id)) continue;
        const links = choiceLinksOf(p);
        if (links.length) await linkChoiceImages(ctx, it.id, links).catch((e) => failed.push({ id: it.id, error: `relink: ${e?.message ?? e}` }));
      }
    }
    // an input with no result at all did not persist either
    for (const it of batch) if (!ok.has(it.id) && !failed.some((f) => f.id === it.id)) failed.push({ id: it.id, error: "no result for item" });
    return { ok, failed };
  };
  const first = await send(items);
  const attached = new Set(first.ok);
  let failures = first.failed;
  if (failures.length) {
    const retry = await send(items.filter((it) => failures.some((f) => f.id === it.id)));
    for (const id of retry.ok) attached.add(id);
    failures = retry.failed;
  }
  return { attached: [...attached], failures };
}

// The choice → gallery-item links a product carries (read with PRODUCT_CHOICES_MEDIA_REFERENCES).
function choiceLinksOf(p) {
  const out = [];
  for (const o of p?.options ?? []) {
    for (const c of o.choicesSettings?.choices ?? []) {
      const mediaId = c.media?.items?.[0]?.mediaId;
      if (mediaId) out.push({ optionName: o.name, choiceName: c.name, mediaId });
    }
  }
  return out;
}

// Per-choice images (the dashboard's "image per colour"): a choice points at an item of the
// product's OWN gallery, so the image is attached to the gallery first (pass 2) and linked here by
// the gallery item's id — for a file imported by url that is a different id from the uploaded
// file's and the file's 400s; a file attached by its Media Manager id is the item of that id. Links are a
// product update, which the API only accepts with the variants re-sent beside the options, so the
// current variants (id, choices, price) ride along unchanged. Wix derives a variant's own media
// from its choice at creation only; the storefront reads the choice's image, so a link made here
// shows up on the product page the same as one made in the dashboard.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product.md
// `links`: [{ optionName, choiceName, url }] (the file attached in pass 2) or [{ …, mediaId }] (a
// gallery item id, used to put the owner's links back after a gallery write).
export async function linkChoiceImages(ctx, productId, links) {
  const read = () => req(ctx, `/stores/v3/products/${productId}?fields=MEDIA_ITEMS_INFO&fields=VARIANT_OPTION_CHOICE_NAMES`, { method: "GET" });
  let { product: p } = await read();
  const galleryIdFor = (link) => {
    const items = p?.media?.itemsInfo?.items ?? [];
    if (link.mediaId) return items.some((it) => it.id === link.mediaId) ? link.mediaId : null;
    const hit = items.find((it) => sameFile(it.image?.filename, link.url) || sameFile(it.image?.url, link.url));
    return hit?.id ?? null;
  };
  // the gallery can lag the attach (propagation, seen past 6 s live): poll for up to half a minute
  for (let i = 0; i < 5 && links.some((l) => !galleryIdFor(l)); i++) {
    await new Promise((r) => setTimeout(r, 6000));
    ({ product: p } = await read());
  }
  const missing = [];
  const options = (p?.options ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    optionRenderType: o.optionRenderType,
    choicesSettings: {
      choices: (o.choicesSettings?.choices ?? []).map((c) => {
        const link = links.find((l) => l.optionName === o.name && l.choiceName === c.name);
        const mediaId = link ? galleryIdFor(link) : null;
        if (link && !mediaId) missing.push(`${o.name} / ${c.name}`);
        return {
          choiceId: c.choiceId,
          name: c.name,
          choiceType: c.choiceType,
          ...(c.colorCode ? { colorCode: c.colorCode } : {}),
          ...(mediaId ? { media: { items: [{ mediaId }] } } : {}),
        };
      }),
    },
  }));
  const physical = p?.productType !== "DIGITAL";
  const variants = (p?.variantsInfo?.variants ?? []).map((v) => ({
    id: v.id,
    choices: v.choices,
    price: {
      actualPrice: { amount: v.price?.actualPrice?.amount },
      ...(v.price?.compareAtPrice?.amount ? { compareAtPrice: { amount: v.price.compareAtPrice.amount } } : {}),
    },
    visible: v.visible !== false,
    ...(physical ? { physicalProperties: {} } : {}),
  }));
  if (missing.length < links.length) {
    await req(ctx, `/stores/v3/products/${productId}`, {
      method: "PATCH",
      body: { product: { id: productId, revision: p.revision, options, variantsInfo: { variants } } },
    });
  }
  return { linked: links.length - missing.length, missing };
}

/**
 * ONE-CALL seed: install → currency → create products → categories → attach images, ids
 * threaded in memory. This is the default path — call it once instead of the individual
 * functions.
 */
export async function setupStore(ctx, { products = [], categories = {}, categoryDetails = {}, currency } = {}) {
  validateProducts(products);
  await installStoresApp(ctx);
  // Before any product exists: a product's price is stored in the site currency at create time,
  // so switching afterwards leaves the catalog priced in the old one.
  if (currency) await setSiteCurrency(ctx, currency);

  // What the catalog held BEFORE this seed and the plan does not name: on a fresh install that is
  // Wix's sample catalog ("Baseball Cap", "Ceramic Flower Vase", a dozen of them), which the live shop
  // lists next to the owner's products. Reported (`preexisting`), never touched: this seed deletes
  // nothing on a site, ever. The owner removes what they do not want in the dashboard; the closing
  // message tells them it is there and where.
  const planNames = new Set(products.map((p) => p.name));
  let all = [];
  try { all = await readAllProducts(ctx); } catch (e) { console.error(`catalog read failed (skipping the pre-existing check): ${String(e.message).slice(0, 120)}`); }
  let preexisting = all.filter((p) => !planNames.has(p.name));

  // Idempotent by name: an errored bulk create (429/5xx) may still have applied server-side,
  // and SKILL.md tells the agent to re-run a failed seed — creating only the names that don't
  // exist yet makes that rerun safe instead of a duplicator.
  const existing = await queryProductsByNames(ctx, products.map((p) => p.name), all.length ? all : undefined);
  const toCreate = products.filter((p) => !existing.has(p.name));
  const { created, failures } = toCreate.length
    ? await bulkCreateProducts(ctx, toCreate)
    : { created: [], failures: [] };
  const createdByName = new Map(created.map((p) => [p.name, p]));
  const withNames = products.map((p) => {
    const hit = createdByName.get(p.name) ?? existing.get(p.name);
    return { ...(hit ?? {}), name: p.name };
  });
  const idByName = new Map(withNames.map((p) => [p.name, p.id]));

  // Category images resolve before the categories exist (the create call takes the image URL);
  // a failed image leaves the category text-only, like a product.
  const names = Object.keys(categories);
  const details = {};
  if (names.length) {
    const catFiles = await resolveItemImages(ctx, names.map((n) => ({
      url: categoryDetails[n]?.imageUrl,
      path: categoryDetails[n]?.imagePath,
      prompt: categoryDetails[n]?.imagePrompt,
      displayName: `${n.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
    })));
    names.forEach((n, i) => {
      details[n] = { description: categoryDetails[n]?.description, imageUrl: catFiles[i]?.url };
    });
  }
  const cats = names.length ? await createCategories(ctx, names, details) : [];
  if (cats.length) {
    const mapping = {};
    for (const c of cats) {
      const ids = (categories[c.name] || []).map((n) => idByName.get(n)).filter(Boolean);
      if (ids.length) mapping[c.id] = ids;
    }
    if (Object.keys(mapping).length) await addProductsToCategories(ctx, mapping);
  }

  // Pass 2 — images: resolve (import by url / generate by prompt) in one parallel wave, then
  // bulk-attach. Failures leave the product text-only; the seed's exit never depends on images.
  // A choice's image (`options[].choices[].imageUrl|imagePath|imagePrompt`) resolves in the same
  // wave and joins the product's gallery; pass 3 links it to its choice.
  const choiceSpecs = products.map((pl, i) =>
    (pl.options ?? []).flatMap((o) =>
      (o.choices ?? [])
        .filter((c) => typeof c === "object" && c && (c.imageMediaId || c.imageUrl || c.imagePath || c.imagePrompt))
        .map((c) => ({
          optionName: o.name,
          choiceName: c.name,
          productName: pl.name,
          altText: c.altText ?? `${pl.name} — ${c.name}`,
          spec: { mediaId: c.imageMediaId, url: c.imageUrl, path: c.imagePath, prompt: c.imagePrompt, displayName: `${withNames[i].slug || "product"}-${String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png` },
        })),
    ));
  const flatChoiceSpecs = choiceSpecs.flat();
  const resolved = await resolveItemImagesDetailed(ctx, [
    ...withNames.map((p, i) => ({
      mediaId: products[i]?.imageMediaId,
      url: products[i]?.imageUrl,
      path: products[i]?.imagePath,
      prompt: products[i]?.imagePrompt,
      displayName: `${p.slug || "product"}.png`,
    })),
    ...flatChoiceSpecs.map((c) => c.spec),
  ]);
  const files = resolved.map((r) => r.file);
  const choiceFiles = files.slice(withNames.length);
  const choiceResolved = resolved.slice(withNames.length);
  let cursor = 0;
  const choiceLinks = choiceSpecs.map((specs) =>
    specs.map((c) => ({ ...c, file: choiceFiles[cursor++] })).filter((c) => c.file));
  // `p.id` guards this: a product that failed to create has no id, and bulk-updating an
  // undefined id would 400 the whole batch and cost every other product its image.
  const imageItems = withNames
    .map((p, i) => {
      if (!p.id) return null;
      const images = [
        ...(files[i] ? [{ url: files[i].url, mediaId: files[i].existing ? files[i].id : undefined, altText: products[i]?.altText ?? p.slug }] : []),
        ...choiceLinks[i].map((c) => ({ url: c.file.url, mediaId: c.file.existing ? c.file.id : undefined, altText: c.altText })),
      ];
      return images.length ? { id: p.id, images } : null;
    })
    .filter(Boolean);
  // imagesAttached counts the attaches the API CONFIRMED (per-item results), not the ones sent;
  // imageFailures names the products left text-only and why. Neither blocks the seed: a re-run of
  // the same plan reuses the products and attaches again.
  let imagesAttached = 0;
  const imageFailures = [];
  // A product whose image never resolved (a bad path, an unsupported file type, a refused
  // prompt, a timeout) is not in imageItems at all, so the attach step below never sees it:
  // it is reported here with the resolver's reason, or it ships text-only in silence.
  withNames.forEach((p, i) => {
    const src = products[i] ?? {};
    if ((src.imageMediaId || src.imageUrl || src.imagePath || src.imagePrompt) && !files[i]) {
      imageFailures.push({ name: p.name, error: resolved[i]?.error ?? "image did not resolve" });
    }
  });
  const nameOf = (id) => withNames.find((p) => p.id === id)?.name;
  try {
    if (imageItems.length) {
      const r = await attachProductImages(ctx, imageItems);
      imagesAttached = r.attached.length;
      for (const f of r.failures) imageFailures.push({ name: nameOf(f.id), error: f.error });
    }
  } catch (e) {
    for (const it of imageItems) imageFailures.push({ name: nameOf(it.id), error: e?.message ?? String(e) });
  }

  // Pass 3 — link each choice's image to its choice, by the gallery item's id.
  let choiceImagesLinked = 0;
  const choiceImageFailures = [];
  flatChoiceSpecs.forEach((c, j) => {
    if (!choiceFiles[j]) choiceImageFailures.push({ name: c.productName, choice: c.choiceName, error: choiceResolved[j]?.error ?? "image did not resolve" });
  });
  for (const [i, p] of withNames.entries()) {
    const links = choiceLinks[i];
    if (!links.length || !p.id || !imagesAttached) continue;
    try {
      // a file attached by its Media Manager id is the gallery item of that id; an imported one is found by name
      const r = await linkChoiceImages(ctx, p.id, links.map((c) => ({ optionName: c.optionName, choiceName: c.choiceName, ...(c.file.existing ? { mediaId: c.file.id } : { url: c.file.url }) })));
      choiceImagesLinked += r.linked;
      for (const m of r.missing) choiceImageFailures.push({ name: p.name, choice: m, error: "image not in the product gallery" });
    } catch (e) {
      choiceImageFailures.push({ name: p.name, error: e?.message ?? String(e) });
    }
  }

  // The pre-existing list is read again now: on a fresh site the Stores app was installed moments
  // before the first read, and Wix creates its sample catalog asynchronously after the install, so
  // that read often came back empty and the closing message said nothing about a dozen samples the
  // live shop lists. The early read still serves the idempotency check above; this one serves the report.
  try {
    const after = await readAllProducts(ctx);
    preexisting = after.filter((p) => !planNames.has(p.name));
  } catch (e) {
    console.error(`catalog re-read failed (reporting the pre-existing list from the first read): ${String(e.message).slice(0, 120)}`);
  }

  // failures is part of the result, not an exception: a partial seed still leaves a usable
  // store, and the agent needs the names to report rather than silently shipping a short
  // catalog. Re-run the seed to retry them — existing names are skipped, not duplicated.
  return {
    products: withNames,
    categories: cats,
    imagesAttached,
    imageFailures,
    choiceImagesLinked,
    choiceImageFailures,
    failures,
    // Products the plan did not name (Wix's install samples on a fresh site, or the owner's own on an
    // existing one): the closing message names what the shop lists and where the owner removes it.
    preexisting: preexisting.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    // the Stores app's slug + products list (registered dashboard route); `store/products` is no route
    dashboardProductsUrl: `https://manage.wix.com/dashboard/${ctx.siteId}/wix-stores/products`,
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = isMain(import.meta.url);
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-store.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupStore(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
