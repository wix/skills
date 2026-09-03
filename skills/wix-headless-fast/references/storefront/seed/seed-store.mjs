// Storefront seed — a BUILD-TIME script, never shipped in the app. Run it from the project
// root (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/storefront/seed/seed-store.mjs plan.json
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
//                                   "choices": ["S","M"] | [{ "name", "colorCode" }] }],
//                    "imageUrl"? | "imagePath"? | "imagePrompt"?, "altText"?,
//                    "digitalFileUrl"? | "digitalFilePath"?, "digitalFileName"? }],
//     "categories"?: { "<category name>": ["<product name>", ...] } }
//
// Seeding is ADDITIVE — this script never deletes or overwrites existing content.
// If a call fails with an unexpected shape, read the live API reference (the authoritative
// source recipe is wix-headless/references/inline-recipes/setup-online-store.md) — never guess.
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";

const API = "https://www.wixapis.com";
const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

// ---- auth: siteId from wix.config.json, token minted by the Wix CLI ----------------------------

export function makeCtx({ cwd = process.cwd() } = {}) {
  const config = JSON.parse(readFileSync(`${cwd}/wix.config.json`, "utf8"));
  const siteId = config.siteId ?? config.projectId;
  if (!siteId) throw new Error("wix.config.json has no siteId — is this a Wix CLI project?");
  // The CLI returns a byte-identical token within a run — mint once, reuse.
  const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
    encoding: "utf8",
    cwd,
  }).trim();
  if (!token) throw new Error("The Wix CLI returned no token — run `npx @wix/cli@latest login` first.");
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

// ---- description string -> Wix rich-text nodes --------------------------------------------------
// Descriptions arrive as HTML as often as not. The writable field is `description` (Ricos
// nodes) — the HTML `plainDescription` the storefront renders is derived from them, so markup
// dropped into a TEXT node comes back escaped and the PDP shows literal tags. Convert the tags
// a model actually emits; a tag-free string stays one paragraph.

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function decodeEntities(s) {
  return s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

function mkTextNodes(html) {
  const nodes = [];
  let bold = 0, italic = 0, last = 0, m;
  const tag = /<(\/?)(strong|b|em|i)\s*\/?>/gi;
  const push = (raw) => {
    const text = decodeEntities(raw.replace(/<[^>]*>/g, ""));
    if (!text) return;
    const decorations = [];
    if (bold > 0) decorations.push({ type: "BOLD" });
    if (italic > 0) decorations.push({ type: "ITALIC" });
    nodes.push({ type: "TEXT", textData: { text, decorations } });
  };
  while ((m = tag.exec(html)) !== null) {
    push(html.slice(last, m.index));
    const step = m[1] ? -1 : 1;
    if (/^(strong|b)$/i.test(m[2])) bold = Math.max(0, bold + step);
    else italic = Math.max(0, italic + step);
    last = tag.lastIndex;
  }
  push(html.slice(last));
  return nodes.length ? nodes : [{ type: "TEXT", textData: { text: "", decorations: [] } }];
}

function mkDesc(text, i) {
  const blocks = String(text ?? "").split(/<\/p\s*>|<br\s*\/?>/i).map((b) => b.trim()).filter(Boolean);
  return {
    nodes: (blocks.length ? blocks : [""]).map((block, n) => ({
      type: "PARAGRAPH", id: `desc-${i}-${n}`,
      nodes: mkTextNodes(block),
      paragraphData: { textStyle: { textAlignment: "AUTO" } },
    })),
    metadata: { version: 1, id: `desc-meta-${i}` },
  };
}

// ---- options / variants -------------------------------------------------------------------------

function buildOptions(options = []) {
  return options.map((o) => {
    const color = o.type === "color";
    return {
      name: o.name,
      optionRenderType: color ? "SWATCH_CHOICES" : "TEXT_CHOICES",
      choicesSettings: {
        choices: o.choices.map((c) =>
          color
            ? { choiceType: "ONE_COLOR", name: c.name, colorCode: c.colorCode }
            : { choiceType: "CHOICE_TEXT", name: typeof c === "string" ? c : c.name }),
      },
    };
  });
}

// Full Cartesian product, each variant priced/stocked from the product; visible:true baked in.
function expandVariants(options = [], { price, compareAtPrice, quantity }, digitalFileId) {
  const base = {
    price: {
      actualPrice: { amount: String(price) },
      ...(compareAtPrice ? { compareAtPrice: { amount: String(compareAtPrice) } } : {}),
    },
    visible: true,
    ...(digitalFileId
      ? { digitalProperties: { digitalFile: { id: digitalFileId } }, inventoryItem: { inStock: true } }
      : { physicalProperties: {}, inventoryItem: { quantity: quantity ?? 0, preorderInfo: { enabled: false } } }),
  };
  if (!options.length) return [base];
  let combos = [[]];
  for (const o of options) {
    const rt = o.type === "color" ? "SWATCH_CHOICES" : "TEXT_CHOICES";
    const names = o.choices.map((c) => (typeof c === "string" ? c : c.name));
    combos = combos.flatMap((combo) =>
      names.map((choiceName) => [...combo, { optionChoiceNames: { optionName: o.name, choiceName, renderType: rt } }]));
  }
  return combos.map((choices) => ({ ...base, choices }));
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
export async function queryProductsByNames(ctx, names) {
  const out = new Map();
  if (!names.length) return out;
  try {
    const wanted = new Set(names);
    const r = await req(ctx, "/stores/v3/products/query", { body: { query: { cursorPaging: { limit: 100 } } } });
    for (const p of r.products ?? []) {
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
        if (!r.ok) throw new Error(`digitalFileUrl ${digitalFileUrl} -> ${r.status}`);
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
      variantsInfo: { variants: expandVariants(p.options, p, fileIds[i]) },
    })),
  };
  const r = await req(ctx, "/stores/v3/bulk/products-with-inventory/create", { body });
  // NB: results nest under productResults.results[].item — NOT a top-level `results`.
  const created = (r.productResults?.results ?? []).map((x, i) => ({
    id: x.item?.id, slug: x.item?.slug, revision: x.item?.revision,
    variantId: x.item?.variantsInfo?.variants?.[0]?.id,
    hasOptions: (products[i]?.options?.length ?? 0) > 0,
    isDigital: !!fileIds[i],
    quantity: products[i]?.quantity ?? 0,
  }));
  await stockOptionlessProducts(ctx, created);
  return created.map((p) => ({ id: p.id, slug: p.slug, revision: p.revision }));
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
  const inventoryItems = need
    .filter((p) => p.variantId)
    .map((p) => ({ productId: p.id, variantId: p.variantId, quantity: p.quantity }));
  if (inventoryItems.length) {
    await req(ctx, "/stores/v3/bulk/inventory-items/create", { body: { inventoryItems } });
  }
}

// Categories share the @wix/stores tree revision — concurrent creates 409, so: sequential.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/create-category.md
export async function createCategories(ctx, names) {
  const out = [];
  for (const name of names) {
    const r = await req(ctx, "/categories/v1/categories", {
      body: { category: { name, visible: true }, treeReference: { appNamespace: "@wix/stores", treeKey: null } },
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

// Bulk image attach in ONE call. items: [{ id, url, altText }] — no revision to pass: the
// current revision is read right before the update, so attach any number of times, any pass.
// Wix re-hosts each url server-side; the media can take a little while to appear on read-back
// (propagation) — normal, not a failure.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-products.md
export async function attachProductImages(ctx, items) {
  if (!items?.length) return;
  const ids = items.map((it) => it.id);
  const q = await req(ctx, "/stores/v3/products/query", { body: { query: { filter: { id: { $in: ids } }, paging: { limit: ids.length } } } });
  const revById = new Map((q.products ?? []).map((p) => [p.id, p.revision]));
  return req(ctx, "/stores/v3/bulk/products/update", {
    body: {
      products: items.map((it) => ({
        product: { id: it.id, revision: revById.get(it.id), media: { itemsInfo: { items: [{ url: it.url, altText: it.altText }] } } },
      })),
    },
  });
}

/**
 * ONE-CALL seed: install → create products → categories → attach images, ids threaded in
 * memory. This is the default path — call it once instead of the individual functions.
 */
export async function setupStore(ctx, { products = [], categories = {} } = {}) {
  await installStoresApp(ctx);

  // Idempotent by name: an errored bulk create (429/5xx) may still have applied server-side,
  // and SKILL.md tells the agent to re-run a failed seed — creating only the names that don't
  // exist yet makes that rerun safe instead of a duplicator.
  const existing = await queryProductsByNames(ctx, products.map((p) => p.name));
  const toCreate = products.filter((p) => !existing.has(p.name));
  const created = toCreate.length ? await bulkCreateProducts(ctx, toCreate) : [];
  const createdByName = new Map(created.map((p, i) => [toCreate[i]?.name, p]));
  const withNames = products.map((p) => {
    const hit = createdByName.get(p.name) ?? existing.get(p.name);
    return { ...(hit ?? {}), name: p.name };
  });
  const idByName = new Map(withNames.map((p) => [p.name, p.id]));

  const names = Object.keys(categories);
  const cats = names.length ? await createCategories(ctx, names) : [];
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
  const files = await resolveItemImages(ctx, withNames.map((p, i) => ({
    url: products[i]?.imageUrl,
    path: products[i]?.imagePath,
    prompt: products[i]?.imagePrompt,
    displayName: `${p.slug || "product"}.png`,
  })));
  const imageItems = withNames
    .map((p, i) => (files[i] && p.id ? { id: p.id, url: files[i].url, altText: products[i]?.altText ?? p.slug } : null))
    .filter(Boolean);
  let imagesAttached = 0;
  try {
    if (imageItems.length) await attachProductImages(ctx, imageItems);
    imagesAttached = imageItems.length;
  } catch {
    /* never block on image failure — the products stay text-only */
  }

  return { products: withNames, categories: cats, imagesAttached };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
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
