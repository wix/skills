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
 *   inventory.availabilityStatus {string} — "IN_STOCK"|"OUT_OF_STOCK"|"PARTIALLY_OUT_OF_STOCK",
 *   options {array} — product options e.g. Size, Color:
 *     [{ id, name, optionRenderType "TEXT_CHOICES"|"COLOR_CHOICES"|"SWATCH_CHOICES",
 *        choicesSettings.choices [{ choiceId, key, name, inStock, visible, linkedMedia }] }],
 *   modifiers {array} — non-variant customizations (engraving, gift wrap):
 *     [{ id, name, mandatory, modifierRenderType "TEXT_CHOICES"|"FREE_TEXT",
 *        key, choicesSettings.choices, freeTextSettings.key }],
 *   plainDescription {string} — HTML product description,
 *   variantsInfo.variants {array} — returned only by getProductBySlug:
 *     [{ id, visible, choices [{ optionChoiceIds: { optionId, choiceId } }],
 *        price: { actualPrice, compareAtPrice }, media, inventoryStatus: { inStock } }]
 *     To resolve a buyer's option selections to a variantId: find the variant whose choices
 *     match all selected { optionId, choiceId } pairs, then pass variant.id to addToCart.
 *
 * Category: { id, name, slug, visible, description, image, itemCounter, parentCategory.id }
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories
 */

/**
 * Query visible products (one page). Pass nextCursor back as cursor to load the next page.
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ products: object[], nextCursor: string|null }>}
 */
export async function queryProducts({ limit = 100, cursor } = {}) {
  const res = await wixApiRequest("/stores/v3/products/query", {
    method: "POST",
    body: {
      fields: ["CURRENCY", "PLAIN_DESCRIPTION", "MEDIA_ITEMS_INFO"],
      query: {
        ...(cursor ? {} : { filter: { visible: true } }),
        cursorPaging: cursor ? { limit, cursor } : { limit },
      },
    },
  });
  return {
    products: res?.products ?? [],
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
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
    query: { fields: ["CURRENCY", "PLAIN_DESCRIPTION", "MEDIA_ITEMS_INFO"] },
  });
  return res?.product ?? null;
}

/**
 * Query visible products belonging to a category (one page).
 * @param {string} categoryId  Category GUID from queryCategories / getCategoryBySlug.
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ products: object[], nextCursor: string|null }>}
 */
export async function queryProductsByCategory(categoryId, { limit = 100, cursor } = {}) {
  const res = await wixApiRequest("/stores/v3/products/search", {
    method: "POST",
    body: {
      fields: ["CURRENCY", "PLAIN_DESCRIPTION", "MEDIA_ITEMS_INFO"],
      search: {
        ...(cursor
          ? { cursorPaging: { limit, cursor } }
          : {
              cursorPaging: { limit },
              filter: {
                visible: true,
                "allCategoriesInfo.categories": { $matchItems: [{ id: categoryId }] },
              },
            }),
      },
    },
  });
  return {
    products: res?.products ?? [],
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
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
