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
//   await seed.attachProductImages(ctx, products.map((p,i) => ({ id:p.id, revision:p.revision, url:imageUrls[i], altText:p.slug })));
//
// If any call fails with a shape the caller didn't expect, fall back to the wix-docs skill
// (search + read the live Wix API reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-online-store.md.

const API = "https://www.wixapis.com";
const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

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

// plain string -> Wix rich-text description node tree (plainDescription is HTML/nodes, not text)
function mkDesc(text, i) {
  return {
    nodes: [{
      type: "PARAGRAPH", id: `desc-${i}`,
      nodes: [{ type: "TEXT", textData: { text: text || "" } }],
      paragraphData: { textStyle: { textAlignment: "AUTO" } },
    }],
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
  return req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
    tenant: { tenantType: "SITE", id: ctx.siteId },
    appInstance: { appDefId: STORES_APP_ID, enabled: true },
  } });
}

// Clean is JUDGMENT — never auto-delete. Agent lists, decides which are obvious install samples,
// deletes only those (SEED.md: seeding is additive; deleting real content needs the owner's OK).
async function listProducts(ctx) {
  const r = await req(ctx, "/stores/v3/products/query", { body: { query: { paging: { limit: 50 } } } });
  return (r.products ?? []).map((p) => ({ id: p.id, name: p.name }));
}
async function deleteProducts(ctx, ids) {
  if (!ids || !ids.length) return;
  return req(ctx, "/stores/v3/bulk/products/delete", { body: { productIds: ids } });
}

/**
 * Bulk-create products.
 * @param products [{ name, description, price, compareAtPrice?, quantity,
 *   options?: [{ name, type?:"text"|"color", choices:["8","9"] | [{name,colorCode}] }] }]
 *   options = ONLY things the buyer selects-and-buys (Size, Color) -> become variants.
 *   Display-only attributes go in name/category/description, NOT options. Default: no options.
 *   visible/physicalProperties/variant-expansion handled here.
 * @returns [{ id, slug, revision }]  (revision feeds attachProductImages)
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
  return (r.productResults?.results ?? []).map((x) => ({
    id: x.item?.id, slug: x.item?.slug, revision: x.item?.revision,
  }));
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

// Bulk image attach in ONE call. items: [{ id, revision, url, altText }]
// revision comes from bulkCreateProducts' return. Wix re-hosts the image (new wixstatic id on
// read-back) and bumps revision; media-only update preserves options/variants. Read success from
// results[].itemMetadata.success + bulkActionMetadata.totalSuccesses.
async function attachProductImages(ctx, items) {
  return req(ctx, "/stores/v3/bulk/products/update", {
    body: {
      products: items.map((it) => ({
        product: { id: it.id, revision: it.revision, media: { itemsInfo: { items: [{ url: it.url, altText: it.altText }] } } },
      })),
    },
  });
}

module.exports = {
  installStoresApp, listProducts, deleteProducts,
  bulkCreateProducts, createCategories, addProductsToCategories, attachProductImages,
};
