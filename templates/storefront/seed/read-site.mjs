// What the store holds: products (names, prices, options, media, stock), categories. Run it before
// designing a storefront for a site that already has content:
//   node <SKILL_ROOT>/templates/storefront/seed/read-site.mjs [--site <siteId>] [--limit <n>]
// Every request here is the one the deployed data layer makes (rest/catalog.ts); the doc URL of
// each method is in the output's `calls`.
import { runReader } from "../../shared/seed/read-site.mjs";

const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3";
const LIST_FIELDS = ["CURRENCY", "MEDIA_ITEMS_INFO", "MIN_PRICE_VARIANT", "DISCOUNT_INFO"];
const VISIBLE = { $and: [{ visible: true }] };
const TREE = { appNamespace: "@wix/stores", treeKey: null };

// Wix's install samples ("Baseball Cap", "Ceramic Flower Vase", a dozen of them) come with the Stores
// app on every fresh site. Their photos are hosted under Wix's own media account, 22e53e_…, never the
// site's — the tell. (Not the names: an owner can name a product "Baseball Cap", and a sample whose
// photo the owner replaced has been made theirs.)
const WIX_SAMPLE_MEDIA_PREFIX = "22e53e_";
const isWixSample = (p) => String(p.media?.main?.id ?? "").startsWith(WIX_SAMPLE_MEDIA_PREFIX);

await runReader({
  vertical: "storefront",
  appId: STORES_APP_ID,
  async read(api, { limit }) {
    const count = await api.tryCall({ path: "/stores/v3/products/count", body: { filter: VISIBLE }, docs: `${D}/products-v3/count-products` });
    const search = await api.call({ path: "/stores/v3/products/search", body: { fields: LIST_FIELDS, search: { filter: VISIBLE, cursorPaging: { limit } } }, docs: `${D}/products-v3/search-products` });
    const cats = await api.tryCall({ path: "/categories/v1/categories/query", body: { treeReference: TREE, query: { filter: { name: { $exists: true } }, cursorPaging: { limit: 100 } } }, docs: `${D}/categories/query-categories` });
    // samples vs the owner's own, over the whole catalog (main image only; pages of 100, up to 1000)
    const censusProducts = [];
    for (let cursor = null, page = 0; page < 10; page++) {
      const r = await api.tryCall({ path: "/stores/v3/products/search", body: { fields: ["MEDIA_ITEMS_INFO"], search: { filter: VISIBLE, cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) } } }, docs: `${D}/products-v3/search-products` });
      if (!r?.products) break;
      censusProducts.push(...r.products);
      cursor = r.pagingMetadata?.cursors?.next ?? null;
      if (!cursor) break;
    }
    const wixSamples = censusProducts.filter(isWixSample);
    const products = (search.products ?? []).map((p) => ({
      name: p.name, slug: p.slug,
      wixSample: isWixSample(p),
      price: p.actualPriceRange?.minValue?.formattedAmount ?? null,
      priceMax: p.actualPriceRange?.maxValue?.formattedAmount ?? null,
      compareAt: p.compareAtPriceRange?.minValue?.formattedAmount ?? null,
      options: (p.options ?? []).map((o) => `${o.name} (${o.choicesSettings?.choices?.length ?? 0})`),
      media: p.media?.itemsInfo?.items?.length ?? 0,
      availability: p.inventory?.availabilityStatus ?? null,
    }));
    return {
      currency: search.products?.[0]?.currency ?? null,
      productCount: typeof count?.count === "number" ? count.count : null,
      // The owner's own products — what decides whether this store has content of its own (SKILL.md,
      // "Who decides the seed"). Zero with samples present is a fresh install.
      ownProductCount: censusProducts.length - wixSamples.length,
      wixSampleCount: wixSamples.length,
      products,
      productsShown: products.length,
      categories: (cats?.categories ?? []).filter((c) => c.slug !== "all-products").map((c) => ({ id: c.id, name: c.name, slug: c.slug, visible: c.visible !== false })),
    };
  },
});
