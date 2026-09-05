import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md

/**
 * Wix Stores V3 Product — key fields for the storefront catalog.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md
 *
 *   id {string}, name {string}, slug {string}, visible {boolean}, productType "PHYSICAL"|"DIGITAL",
 *   mainCategoryId {string},
 *   media.main.image {object} — { id, url, height, width, altText },
 *   media.itemsInfo.items {array} — gallery: [{ id, altText, image: { id, url, height, width, altText }, mediaType }],
 *   actualPriceRange.minValue.formattedAmount {string} — lowest price with currency symbol,
 *   actualPriceRange.maxValue.formattedAmount {string} — highest price with currency symbol,
 *   compareAtPriceRange.minValue.formattedAmount {string} — strikethrough price (present when on sale),
 *   actualPriceRange/compareAtPriceRange .minValue.amount {string} — the same figures unformatted
 *     ("129.00"). Use these for arithmetic: a percent-off badge can't be computed from "€129.00",
 *   inventory.availabilityStatus {string} — "IN_STOCK"|"OUT_OF_STOCK"|"PARTIALLY_OUT_OF_STOCK",
 *   inventory.preorderStatus {string} — "ENABLED"|"DISABLED". ENABLED + OUT_OF_STOCK is a pre-order,
 *     which is buyable — label it "Pre-order" rather than "Sold out",
 *     NB: inventory carries no stock COUNT. "Limited stock" (from PARTIALLY_OUT_OF_STOCK) is the most
 *     precise scarcity signal a tile can show; "Only 2 left" needs per-variant inventory, i.e. a
 *     getProductBySlug call per product,
 *   ribbon {object} — { id, name } merchant-set badge: "New", "Sale", "Best Seller". This is the
 *     catalogue's own label, so prefer it over anything derived — a "new" badge computed from
 *     createdDate flags every product at once right after seeding,
 *   additionalRibbons {array} — further { id, name } badges,
 *   createdDate / updatedDate {string} — ISO timestamps,
 *   variantSummary.variantCount {number} — how many variants exist, without fetching them,
 *   options {array} — product options e.g. Size, Color:
 *     [{ id, name, optionRenderType "TEXT_CHOICES"|"COLOR_CHOICES"|"SWATCH_CHOICES",
 *        choicesSettings.choices [{ choiceId, key, name, inStock, visible, choiceType, colorCode,
 *                                   media }] }],
 *     A COLOR/SWATCH option's choices carry choiceType "ONE_COLOR" and colorCode "#395E55" — render
 *     those as real colour swatches, not text pills. A choice's photo is at media.items[].mediaId (a
 *     bare Wix media id — build https://static.wixstatic.com/media/<id>); use choiceImage() from
 *     lib/storeImage to resolve it. Needs the PRODUCT_CHOICES_MEDIA_REFERENCES field (requested by
 *     getProductBySlug below). visible false is a retired choice the merchant no longer sells: filter
 *     it out. (TEXT_CHOICES choices are choiceType "CHOICE_TEXT" with no colorCode.)
 *   modifiers {array} — non-variant customizations (engraving, gift wrap):
 *     [{ id, name, mandatory, modifierRenderType "TEXT_CHOICES"|"FREE_TEXT",
 *        key, choicesSettings.choices, freeTextSettings.key }],
 *   plainDescription {string} — product description as an HTML string (contains <p>, <br>,
 *     <strong>…) despite the "plain" name — NOT plain text. Render with innerHTML /
 *     dangerouslySetInnerHTML; strip tags only for plain-text contexts (meta description, teaser),
 *   variantsInfo.variants {array} — returned only by getProductBySlug:
 *     [{ id, visible, choices [{ optionChoiceIds: { optionId, choiceId } }],
 *        price: { actualPrice, compareAtPrice }, media, inventoryStatus: { inStock } }]
 *     To resolve a buyer's option selections to a variantId: find the variant whose choices
 *     match all selected { optionId, choiceId } pairs, then pass variant.id to addToCart.
 *
 * Category: { id, name, slug, visible, description, image, itemCounter, parentCategory.id }
 *   NB: queryCategories includes the auto-created system category { slug: "all-products" } —
 *   filter it out of a category menu (see INSTRUCTIONS.md). `visible` does not flag it.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories
 */

// Search Products supports server-side sort/filter before cursor paging:
// https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md
export const CATALOG_SORTS = {
  featured: { label: "Default order" }, // legacy key; no promise of merchant-curated ranking
  priceAsc: { label: "Price: low to high" },
  priceHigh: { label: "Price: high to low" },
  name: { label: "Name: A–Z" },
  newest: { label: "Newest" },
};
const SORT_FIELDS = {
  priceAsc: [{ fieldName: "actualPriceRange.minValue.amount", order: "ASC" }, { fieldName: "name", order: "ASC" }],
  priceHigh: [{ fieldName: "actualPriceRange.minValue.amount", order: "DESC" }, { fieldName: "name", order: "ASC" }],
  name: [{ fieldName: "name", order: "ASC" }],
  newest: [{ fieldName: "createdDate", order: "DESC" }, { fieldName: "name", order: "ASC" }],
};

function priceBound(value, name) {
  if (value == null || value === "") return undefined;
  if (!["number", "string"].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return Number(value);
}

/**
 * Search visible catalog products, sorted/filtered across the whole catalog.
 * Price bounds and ordering use the product's minimum actual variant price in site currency.
 * A cursor continues the original query; start without one when any selection changes.
 * @param {{ limit?: number, cursor?: string, categoryId?: string, sort?: string,
 *   minPrice?: number|string, maxPrice?: number|string, inStockOnly?: boolean, search?: string }} [options]
 * @returns {Promise<{ products: object[], nextCursor: string|null }>}
 */
export async function searchProducts({ limit = 100, cursor, categoryId, sort = "featured", minPrice, maxPrice, inStockOnly = false, search = "" } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100.");
  let query = { cursorPaging: { limit, ...(cursor ? { cursor } : {}) } };
  if (!cursor) {
    if (!Object.hasOwn(CATALOG_SORTS, sort)) throw new Error("Unsupported catalog sort.");
    const min = priceBound(minPrice, "minPrice"), max = priceBound(maxPrice, "maxPrice");
    if (min !== undefined && max !== undefined && min > max) throw new Error("minPrice must not exceed maxPrice.");
    if (typeof search !== "string" || search.trim().length > 100) throw new Error("Search must be at most 100 characters.");
    const conditions = [{ visible: true }];
    if (categoryId) conditions.push({ "allCategoriesInfo.categories": { $matchItems: [{ id: categoryId }] } });
    // Search rejects two operators in the same field object. Join separate bounds with $and.
    if (min !== undefined) conditions.push({ "actualPriceRange.minValue.amount": { $gte: String(min) } });
    if (max !== undefined) conditions.push({ "actualPriceRange.minValue.amount": { $lte: String(max) } });
    if (inStockOnly) conditions.push({ "inventory.availabilityStatus": { $eq: "IN_STOCK" } });
    query = { ...query, filter: { $and: conditions },
      ...(SORT_FIELDS[sort] ? { sort: SORT_FIELDS[sort] } : {}),
      ...(search.trim() ? { search: { expression: search.trim(), fields: ["name"] } } : {}),
    };
  }
  const res = await wixApiRequest("/stores/v3/products/search", {
    method: "POST",
    body: { fields: ["CURRENCY", "PLAIN_DESCRIPTION", "MEDIA_ITEMS_INFO"], search: query },
  });
  return { products: res?.products ?? [], nextCursor: res?.pagingMetadata?.cursors?.next ?? null };
}

/** Visible products; accepts the same sort/filter options as searchProducts. */
export function queryProducts(options = {}) {
  return searchProducts(options);
}

/**
 * Fetch a product by its URL slug. Returns null if not found.
 * Returns the full product including variantsInfo.variants (with per-variant media and choices).
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getProductBySlug(slug) {
  const res = await wixApiRequest(`/stores/v3/products/slug/${encodeURIComponent(slug)}`, {
    method: "GET",
    // PRODUCT_CHOICES_MEDIA_REFERENCES → choice.media.items[].mediaId (the per-colour photos, needed
    // for the swatch→gallery swap); VARIANT_OPTION_CHOICE_NAMES → variant choice names. Without these
    // the choice media / variant data come back null.
    query: {
      fields: [
        "CURRENCY",
        "PLAIN_DESCRIPTION",
        "MEDIA_ITEMS_INFO",
        "PRODUCT_CHOICES_MEDIA_REFERENCES",
        "VARIANT_OPTION_CHOICE_NAMES",
      ],
    },
  });
  return res?.product ?? null;
}

/** Category products; accepts the same sort/filter options as searchProducts. */
export function queryProductsByCategory(categoryId, options = {}) {
  return searchProducts({ ...options, categoryId });
}

/**
 * Total number of visible products. Used for empty-state logic (0 → prompt user to add products).
 * @returns {Promise<number>}
 */
export async function countProducts() {
  const res = await wixApiRequest("/stores/v3/products/count", {
    method: "POST",
    body: { filter: { visible: true } },
  });
  return res?.count ?? 0;
}

/**
 * Query Wix Stores categories (one page).
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ categories: object[], nextCursor: string|null }>}
 */
export async function queryCategories({ limit = 100, cursor } = {}) {
  const res = await wixApiRequest("/categories/v1/categories/query", {
    method: "POST",
    body: {
      treeReference: { appNamespace: "@wix/stores", treeKey: null },
      query: { cursorPaging: cursor ? { limit, cursor } : { limit } },
    },
  });
  return {
    categories: res?.categories ?? [],
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Get a single category by its URL slug. Returns null if not found.
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getCategoryBySlug(slug) {
  const res = await wixApiRequest(`/categories/v1/categories/slug/${encodeURIComponent(slug)}`, {
    method: "GET",
    query: { "treeReference.appNamespace": "@wix/stores" },
  });
  return res?.category ?? null;
}
