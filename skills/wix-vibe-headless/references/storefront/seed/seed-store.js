// Storefront seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Stores
// request/response mechanics (bulk shapes, variant expansion, rich-text descriptions,
// the 409-serial category rule, the re-hosted-image quirk) live here, once.
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/storefront/seed/seed-store.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//   await seed.installStoresApp(ctx);
//   const products = await seed.bulkCreateProducts(ctx, [{ name, description, price, quantity, options? }]);
//   const cats = await seed.createCategories(ctx, ["Legends", "Rising Stars"]);
//   await seed.addProductsToCategories(ctx, { [cats[0].id]: products.map(p => p.id) });
//   await seed.attachProductImages(ctx, products.map((p,i) => ({ id:p.id, url:imageUrls[i], altText:p.slug })));
//
// If any call fails with a shape the caller didn't expect, fall back to the wix-docs skill
// (search + read the live Wix API reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-online-store.md.

const API = "https://www.wixapis.com";
const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

async function req(ctx, path, { method = "POST", body } = {}) {
  // Retry while the catalog is still provisioning: right after a fresh Stores install the V3 WRITE
  // path becomes usable a bit later than the V3 read path, so even once waitForCatalogV3 (a read
  // probe) returns, the first bulk-create can still 428. Wait it out (~80s budget); every other
  // error throws on the first try as before.
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

// A freshly installed catalog isn't writable yet, and Wix has signalled that with two different
// 428s: the older CATALOG_V1_SITE_CALLING_CATALOG_V3_API (site still reports V1) and the current
// CATALOG_V3_SITE_PROVISIONING ("Site is currently being provisioned for CATALOG_V3"). Sites exist
// on both behaviours, so match either. The message check catches a further rename: on this endpoint
// a 428 means "not ready, retry", and treating an unknown one as fatal turns a wait into a failed
// seed — which is exactly how the V3 code slipped through when only the V1 code was matched.
const PROVISIONING_CODES = new Set(["CATALOG_V1_SITE_CALLING_CATALOG_V3_API", "CATALOG_V3_SITE_PROVISIONING"]);

function isProvisioning(status, json) {
  if (PROVISIONING_CODES.has(json?.details?.applicationError?.code)) return true;
  return status === 428 && /provision/i.test(json?.message || "");
}

// A freshly installed Stores catalog 428s on V3 calls until provisioning settles (see
// isProvisioning for the codes). Poll a cheap V3 read until that clears (bounded ~80s), so we don't
// fire the expensive bulk-create repeatedly during the window. This is a pre-gate on the READ path;
// the WRITE path clears slightly later, so the real guarantee is req()'s retry — this just minimizes
// how many times the actual write has to retry.
async function waitForCatalogV3(ctx, { attempts = 40, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${API}/stores/v3/products/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}`, "wix-site-id": ctx.siteId, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { paging: { limit: 1 } } }),
    });
    if (res.ok) return;
    const json = await res.json().catch(() => ({}));
    // Anything that isn't a provisioning signal is a real error — return and let the caller's own
    // request surface it. Matching only one of the two codes here made this exit the wait on the
    // other one, handing the caller straight to a write that then 428'd.
    if (!isProvisioning(res.status, json)) return;
    await sleep(delayMs);
  }
}

// description string -> Wix rich-text node tree.
//
// Descriptions arrive as HTML as often as not: asked to describe a product, a model writes
// <p>…</p><strong>Care:</strong><br/>. The writable field is `description` (Ricos nodes) — the HTML
// `plainDescription` the storefront renders is read-only, derived from them. So markup dropped into
// a single TEXT node is stored as literal text, comes back escaped, and the PDP shows the tags to
// the buyer. Convert the tags a model actually emits; a string with no tags stays one paragraph.
const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function decodeEntities(s) {
  return s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

// One paragraph's inner HTML -> TEXT nodes, carrying bold/italic as Ricos decorations.
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

// [{name, type?:"text"|"color", choices:["8","9"] | [{name,colorCode}]}] -> Wix options[]
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

// full Cartesian product of variants, each priced/stocked from the product; visible:true baked in
function expandVariants(options = [], { price, compareAtPrice, quantity }) {
  const base = {
    price: {
      actualPrice: { amount: String(price) },
      ...(compareAtPrice ? { compareAtPrice: { amount: String(compareAtPrice) } } : {}),
    },
    visible: true,
    physicalProperties: {},
    inventoryItem: { quantity: quantity ?? 0, preorderInfo: { enabled: false } },
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

// ---- exported operations ----

async function installStoresApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: STORES_APP_ID, enabled: true },
    } });
  } catch {
    // already installed is fine — the readiness wait below still confirms the V3 catalog is live
  }
  // Do NOT return to the caller until V3 is ready, else the first V3 seed call 428s on CATALOG_V1.
  await waitForCatalogV3(ctx);
}

async function listProducts(ctx) {
  const r = await req(ctx, "/stores/v3/products/query", { body: { query: { paging: { limit: 50 } } } });
  return (r.products ?? []).map((p) => ({ id: p.id, name: p.name }));
}

/**
 * Bulk-create products.
 * @param products [{ name, description, price, compareAtPrice?, quantity,
 *   options?: [{ name, type?:"text"|"color", choices:["8","9"] | [{name,colorCode}] }] }]
 *   description: plain text, or simple HTML (`<p>`, `<br/>`, `<strong>`, `<em>`) — converted to
 *   Wix rich text here, so the storefront renders paragraphs and bold rather than tag text.
 *   options = ONLY things the buyer selects-and-buys (Size, Color) -> become variants.
 *   Display-only attributes go in name/category/description, NOT options. Default: no options.
 *   visible/physicalProperties/variant-expansion handled here. `quantity` is the stock created.
 * @returns [{ id, slug, revision }]
 */
async function bulkCreateProducts(ctx, products) {
  const body = {
    returnEntity: true,
    products: products.map((p, i) => ({
      name: p.name,
      productType: "PHYSICAL",
      physicalProperties: {},
      visible: true,
      visibleInPos: true,
      description: mkDesc(p.description, i),
      options: buildOptions(p.options),
      variantsInfo: { variants: expandVariants(p.options, p) },
    })),
  };
  const r = await req(ctx, "/stores/v3/bulk/products-with-inventory/create", { body });
  // NB: results nest under productResults.results[].item — NOT a top-level `results`.
  const created = (r.productResults?.results ?? []).map((x, i) => ({
    id: x.item?.id, slug: x.item?.slug, revision: x.item?.revision,
    variantId: x.item?.variantsInfo?.variants?.[0]?.id,
    hasOptions: (products[i]?.options?.length ?? 0) > 0,
    quantity: products[i]?.quantity ?? 0,
  }));
  await stockOptionlessProducts(ctx, created);
  return created.map((p) => ({ id: p.id, slug: p.slug, revision: p.revision }));
}

// products-with-inventory/create stocks a variant via its choices; an OPTION-LESS product has a
// single choiceless (default) variant that the create does NOT stock — it lands OUT_OF_STOCK. So
// set stock on those default variants explicitly (bulk/inventory-items/create). Products WITH options
// are already stocked by the create above, so they're skipped. Backfills the default variantId from a
// query if the create response didn't return it.
async function stockOptionlessProducts(ctx, created) {
  const need = created.filter((p) => !p.hasOptions && p.id);
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

// Categories: no bulk create, and MUST be sequential — they share the @wix/stores tree revision,
// so concurrent creates 409. Run after products (catalog can lag right after the Stores install).
async function createCategories(ctx, names) {
  const out = [];
  for (const name of names) {
    const r = await req(ctx, "/categories/v1/categories", {
      body: { category: { name, visible: true }, treeReference: { appNamespace: "@wix/stores", treeKey: null } },
    });
    out.push({ id: r.category?.id, name });
  }
  return out;
}

// mapping: { [categoryId]: [productId, ...] } — also sequential (same shared tree)
async function addProductsToCategories(ctx, mapping) {
  for (const [categoryId, productIds] of Object.entries(mapping)) {
    await req(ctx, `/categories/v1/bulk/categories/${categoryId}/add-items`, {
      body: {
        items: productIds.map((catalogItemId) => ({ catalogItemId, appId: STORES_APP_ID })),
        treeReference: { appNamespace: "@wix/stores", treeKey: null },
      },
    });
  }
}

// Bulk image attach in ONE call. items: [{ id, url, altText }] — NO revision.
// An attach bumps the product's revision, so a caller-supplied revision goes stale between passes
// (INVALID_REVISION); we read each product's CURRENT revision here, right before the update, so the
// caller never manages a revision token — attach any number of times, in any pass. Wix re-hosts the
// image from the url server-side; the re-hosted media can take a little while to appear on read-back
// (propagation) — that's normal, not a failure, so we don't block on it.
async function attachProductImages(ctx, items) {
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
 * ONE-CALL seed: install → create products → categories → attach images, in the correct order,
 * keeping the created ids in memory (no hand-threading of product ids across exec calls). This is
 * the DEFAULT path — call it once instead of the individual functions.
 *
 * @param plan {{
 *   products: [{ name, description, price, compareAtPrice?, quantity, options?, imageUrl?, altText? }],
 *   categories?: { [categoryName]: string[] },   // map of category name -> product NAMES in it
 * }}
 * @returns { products: [{id,slug,revision,name}], categories: [{id,name}], imagesAttached: number }
 */
async function setupStore(ctx, { products = [], categories = {} } = {}) {
  await installStoresApp(ctx); // installs if needed AND waits for the V3 catalog to be ready

  const created = await bulkCreateProducts(ctx, products);
  const withNames = created.map((p, i) => ({ ...p, name: products[i]?.name }));
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

  const imageItems = withNames
    .map((p, i) => ({ id: p.id, url: products[i]?.imageUrl, altText: products[i]?.altText ?? p.slug }))
    .filter((it) => it.url);
  if (imageItems.length) await attachProductImages(ctx, imageItems);

  return { products: withNames, categories: cats, imagesAttached: imageItems.length };
}

module.exports = {
  setupStore,
  installStoresApp, listProducts,
  bulkCreateProducts, createCategories, addProductsToCategories, attachProductImages,
};
