// Catalog reads (Wix Stores Catalog V3) — the only file that touches raw catalog entities.
// Everything it returns is a plain DTO from ./types: images resolved, prices formatted,
// variants normalized. Copy as-is; extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/query-categories.md
import { productsV3 } from "@wix/stores";
import { categories as categoriesModule } from "@wix/categories";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type {
  Category,
  Facet,
  ProductDetail,
  ProductOption,
  ProductModifier,
  ProductSummary,
  ProductVariant,
  Availability,
} from "./types";

const products = wixModule(productsV3);
const categories = wixModule(categoriesModule);

// Requested on every product read. CURRENCY populates formattedAmount (without it, prices render
// as bare unlocalized numbers); MEDIA_ITEMS_INFO populates the gallery; the detail read adds
// PLAIN_DESCRIPTION and VARIANT_OPTION_CHOICE_NAMES (which populates variantsInfo.variants).
// MIN_PRICE_VARIANT + DISCOUNT_INFO → variantSummary.minPriceVariant with its discounted price:
// a card's real price and the direct-add variant id, without a per-product fetch.
const LIST_FIELDS = ["CURRENCY", "MEDIA_ITEMS_INFO", "MIN_PRICE_VARIANT", "DISCOUNT_INFO"];
// INFO_SECTION + INFO_SECTION_PLAIN_DESCRIPTION → infoSections[] with HTML bodies.
const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  "PLAIN_DESCRIPTION",
  "VARIANT_OPTION_CHOICE_NAMES",
  "INFO_SECTION",
  "INFO_SECTION_PLAIN_DESCRIPTION",
];

type RawProduct = Record<string, any>;

/**
 * The price the buyer pays, and the price to strike — exact precedence, shared by cards and
 * variants. An automatic discount (priceAfterDiscount, present when DISCOUNT_INFO is requested)
 * wins and strikes the regular actualPrice; otherwise actualPrice with the merchant's
 * compareAtPrice as the "was". `!== undefined` on purpose: a discounted price of 0 is a real price.
 */
export function sellingPrice(price: RawProduct | undefined): { current?: RawProduct; original?: RawProduct } {
  if (price?.priceAfterDiscount !== undefined) return { current: price.priceAfterDiscount, original: price.actualPrice };
  return { current: price?.actualPrice, original: price?.compareAtPrice };
}

/** The struck price only when it is real and higher than what the buyer pays. */
function strike(original: RawProduct | undefined, current: RawProduct | undefined): string | null {
  const o = Number(original?.amount), c = Number(current?.amount);
  return original?.formattedAmount && Number.isFinite(o) && Number.isFinite(c) && o > c ? original.formattedAmount : null;
}

/** Every merchant ribbon label, primary first — a ribbon is a label, never proof of a price. */
function ribbonsOf(raw: RawProduct): string[] {
  return [raw.ribbon?.name, ...((raw.additionalRibbons ?? []) as RawProduct[]).map((r) => r?.name)]
    .filter((n, i, all): n is string => typeof n === "string" && n.length > 0 && all.indexOf(n) === i);
}

function toAvailability(raw: RawProduct): Availability {
  const status = raw.inventory?.availabilityStatus;
  return status === "OUT_OF_STOCK" || status === "PARTIALLY_OUT_OF_STOCK"
    ? status
    : "IN_STOCK";
}

// The identity of a media entry BEFORE scaling — two scaled URLs of one photo differ in their
// size parameters, so de-duplicating on resolved URLs shows the same image twice.
function mediaKey(m: RawProduct | undefined): string {
  const v = m?.image ?? m?.url ?? m;
  if (!v) return "";
  if (typeof v === "string") return v.split("#")[0];
  return v.id ?? v.url ?? "";
}

// Every distinct media entry, main first, keyed on identity — shared by the tile (hover image)
// and the PDP (gallery) so both see the same photos in the same order.
function mediaEntries(raw: RawProduct): RawProduct[] {
  const out: RawProduct[] = [];
  const seen = new Set<string>();
  for (const m of [raw.media?.main, ...((raw.media?.itemsInfo?.items ?? []) as RawProduct[])]) {
    const k = mediaKey(m);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

function toSummary(raw: RawProduct): ProductSummary {
  const options: RawProduct[] = raw.options ?? [];
  const media = mediaEntries(raw);
  const mainUrl = imgSrc(media[0], 800, 800);
  const hover = media.slice(1).map((m) => imgSrc(m, 800, 800)).filter(Boolean);
  const swatches = options
    .filter((o) => o.optionRenderType === "SWATCH_CHOICES" || o.optionRenderType === "COLOR_CHOICES")
    .flatMap((o) => (o.choicesSettings?.choices ?? []) as RawProduct[])
    .filter((c) => c.visible !== false && c.colorCode)
    .map((c) => String(c.colorCode));
  const availability = toAvailability(raw);
  const preorder = raw.inventory?.preorderStatus === "ENABLED" && availability === "OUT_OF_STOCK";
  const optionsSummary = options
    .map((o) => {
      const visible = (o.choicesSettings?.choices ?? []).filter((c: RawProduct) => c.visible !== false);
      return `${visible.length} ${String(o.name ?? "").toLowerCase()}${visible.length === 1 ? "" : "s"}`;
    })
    .join(" · ");
  // Price: the cheapest variant's selling price (discount applied) via MIN_PRICE_VARIANT; the
  // product range when variants are priced differently. A struck "was" only for a single price.
  const min = raw.actualPriceRange?.minValue;
  const max = raw.actualPriceRange?.maxValue;
  const isRange = !!(min?.amount && max?.amount && min.amount !== max.amount);
  const minVariant: RawProduct | undefined = raw.variantSummary?.minPriceVariant;
  const { current, original } = sellingPrice(minVariant?.price);
  const ribbons = ribbonsOf(raw);
  return {
    id: raw._id ?? "",
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    price: current?.formattedAmount ?? min?.formattedAmount ?? "",
    maxPrice: max?.formattedAmount ?? "",
    compareAtPrice: isRange ? null : strike(original ?? raw.compareAtPriceRange?.minValue, current ?? min),
    ribbon: ribbons[0] ?? null,
    ribbons,
    minPriceVariantId: minVariant?._id ?? minVariant?.variantId ?? null,
    availability,
    preorder,
    imageUrl: mainUrl,
    hoverImageUrl: hover[0] ?? "",
    optionsSummary,
    swatches,
    quickAddable: options.length === 0 && availability === "IN_STOCK",
  };
}

function toOptions(raw: RawProduct): ProductOption[] {
  return (raw.options ?? []).map((o: RawProduct) => {
    const isColor = o.optionRenderType === "SWATCH_CHOICES" || o.optionRenderType === "COLOR_CHOICES";
    return {
      id: o._id ?? o.id ?? o.name ?? "",
      name: o.name ?? "",
      isColor,
      choices: (o.choicesSettings?.choices ?? [])
        .filter((c: RawProduct) => c.visible !== false)
        .map((c: RawProduct) => ({
          choiceId: c.choiceId ?? "",
          name: c.name ?? "",
          colorCode: c.colorCode ?? null,
          inStock: c.inStock !== false,
        })),
    };
  });
}

function toModifiers(raw: RawProduct): ProductModifier[] {
  return (raw.modifiers ?? []).map((m: RawProduct) => ({
    key: m.key ?? m.freeTextSettings?.key ?? m.name ?? "",
    name: m.name ?? "",
    mandatory: m.mandatory === true,
    type: m.modifierRenderType === "FREE_TEXT" ? ("text" as const) : ("choices" as const),
    choices: (m.choicesSettings?.choices ?? []).map((c: RawProduct) => ({
      key: c.key ?? c.name ?? "",
      name: c.name ?? "",
    })),
  }));
}

function toVariants(raw: RawProduct): ProductVariant[] {
  return (raw.variantsInfo?.variants ?? []).map((v: RawProduct) => {
    const choices: Record<string, string> = {};
    for (const c of v.choices ?? []) {
      const names = c.optionChoiceNames;
      if (names?.optionName) choices[names.optionName] = names.choiceName ?? "";
    }
    const { current, original } = sellingPrice(v.price);
    return {
      variantId: v._id ?? v.variantId ?? "",
      choices,
      price: current?.formattedAmount ?? "",
      compareAtPrice: strike(original, current),
      inStock: v.inventoryStatus?.inStock !== false,
      preorderEnabled: v.inventoryStatus?.preorderEnabled === true,
    };
  });
}

function toDetail(raw: RawProduct): ProductDetail {
  const summary = toSummary(raw);
  // De-duplicated on media identity (mediaEntries), then resolved once at one size — never
  // "main at 800 + items at 1200", which yields two thumbnails of the same photo.
  const gallery = mediaEntries(raw).map((m) => imgSrc(m, 1200, 1200)).filter(Boolean);
  return {
    ...summary,
    descriptionHtml: raw.plainDescription ?? "",   // plainDescription IS an HTML string despite the name
    infoSections: ((raw.infoSections ?? []) as RawProduct[])
      .map((s) => ({ title: s.title ?? "", html: s.plainDescription ?? "" }))
      .filter((s) => s.title || s.html),
    gallery,
    options: toOptions(raw),
    modifiers: toModifiers(raw),
    variants: toVariants(raw),
  };
}

// Search Products applies sort/filter/search server-side, across the WHOLE catalog, before
// cursor paging — the only correct place for them. Sorting or filtering an already-fetched
// page only rearranges the slice you happen to hold.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md
export const CATALOG_SORTS = {
  featured: { label: "Default order" }, // the catalog's own order; no merchant-curated promise
  priceAsc: { label: "Price: low to high" },
  priceHigh: { label: "Price: high to low" },
  name: { label: "Name: A\u2013Z" },
  newest: { label: "Newest" },
} as const;
export type CatalogSort = keyof typeof CATALOG_SORTS;

const SORT_FIELDS: Partial<Record<CatalogSort, { fieldName: string; order: "ASC" | "DESC" }[]>> = {
  priceAsc: [{ fieldName: "actualPriceRange.minValue.amount", order: "ASC" }, { fieldName: "name", order: "ASC" }],
  priceHigh: [{ fieldName: "actualPriceRange.minValue.amount", order: "DESC" }, { fieldName: "name", order: "ASC" }],
  name: [{ fieldName: "name", order: "ASC" }],
  newest: [{ fieldName: "createdDate", order: "DESC" }, { fieldName: "name", order: "ASC" }],
};

function priceBound(value: number | string | undefined, name: string): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (!String(value).trim() || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return parsed;
}

export interface CatalogSearchOptions {
  limit?: number;
  /** Continues the ORIGINAL query — pass alone; new sort/filter values start without one. */
  cursor?: string;
  categoryId?: string | null;
  sort?: CatalogSort;
  /** Bounds compare the product's minimum actual variant price, in site currency. */
  minPrice?: number | string;
  maxPrice?: number | string;
  inStockOnly?: boolean;
  /** Name search, max 100 chars. */
  search?: string;
  /** Option-choice facets: products carrying ANY of these choice ids (see fetchFacets). */
  choiceIds?: string[];
}

/**
 * Search visible catalog products — sorted, filtered, and searched by Wix across the whole
 * catalog, then cursor-paged. `nextCursor` continues the same query; start over (no cursor)
 * whenever any selection changes.
 */
export async function searchCatalog({
  limit = 24,
  cursor,
  categoryId,
  sort = "featured",
  minPrice,
  maxPrice,
  inStockOnly = false,
  search = "",
  choiceIds = [],
}: CatalogSearchOptions = {}): Promise<{ products: ProductSummary[]; nextCursor: string | null; total: number | null }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("limit must be between 1 and 100.");
  let query: RawProduct = { cursorPaging: { limit, ...(cursor ? { cursor } : {}) } };
  if (!cursor) {
    if (!(sort in CATALOG_SORTS)) throw new Error("Unsupported catalog sort.");
    const min = priceBound(minPrice, "minPrice");
    const max = priceBound(maxPrice, "maxPrice");
    if (min !== undefined && max !== undefined && min > max)
      throw new Error("minPrice must not exceed maxPrice.");
    if (search.trim().length > 100) throw new Error("Search must be at most 100 characters.");
    const conditions: RawProduct[] = [{ visible: true }];
    if (categoryId)
      conditions.push({ "allCategoriesInfo.categories": { $matchItems: [{ id: categoryId }] } });
    // Search rejects two operators in one field object — separate bounds, joined by $and.
    if (min !== undefined)
      conditions.push({ "actualPriceRange.minValue.amount": { $gte: String(min) } });
    if (max !== undefined)
      conditions.push({ "actualPriceRange.minValue.amount": { $lte: String(max) } });
    if (inStockOnly) conditions.push({ "inventory.availabilityStatus": { $eq: "IN_STOCK" } });
    // Facets discover PRODUCTS that carry a choice; the PDP / QuickAdd still resolves the variant.
    if (choiceIds.length) conditions.push({ "options.choicesSettings.choices.choiceId": { $hasSome: choiceIds } });
    query = {
      ...query,
      filter: { $and: conditions },
      ...(SORT_FIELDS[sort] ? { sort: SORT_FIELDS[sort] } : {}),
      ...(search.trim() ? { search: { expression: search.trim(), fields: ["name"] } } : {}),
    };
  }
  const res: RawProduct = await products.searchProducts(query, { fields: LIST_FIELDS as any });
  // The result count for the "N products" line — same filter, issued alongside the first page.
  let total: number | null = null;
  if (!cursor && query.filter) {
    try {
      const count: RawProduct = await products.countProducts({ filter: query.filter });
      total = typeof count?.count === "number" ? count.count : null;
    } catch {
      /* the count is a nicety — the page is still valid */
    }
  }
  return {
    products: (res.products ?? []).map((p: RawProduct) => toSummary(p)),
    nextCursor: res.pagingMetadata?.cursors?.next ?? null,
    total,
  };
}

/**
 * The filterable options of the catalog (or of one category): every option name with its
 * choices, aggregated from the products themselves — so the panel only offers facets that
 * exist. Color options carry a colorCode for swatches. Non-fatal: [] when the read fails.
 */
export async function fetchFacets({ categoryId }: { categoryId?: string | null } = {}): Promise<Facet[]> {
  try {
    const conditions: RawProduct[] = [{ visible: true }];
    if (categoryId) conditions.push({ "allCategoriesInfo.categories": { $matchItems: [{ id: categoryId }] } });
    const res: RawProduct = await products.searchProducts(
      { filter: { $and: conditions }, cursorPaging: { limit: 100 } },
      { fields: [] as any },
    );
    const byName = new Map<string, Facet>();
    for (const p of (res.products ?? []) as RawProduct[]) {
      for (const o of (p.options ?? []) as RawProduct[]) {
        const name = o.name ?? "";
        if (!name) continue;
        const isColor = o.optionRenderType === "SWATCH_CHOICES" || o.optionRenderType === "COLOR_CHOICES";
        const facet: Facet = byName.get(name) ?? { name, isColor, choices: [] };
        for (const ch of (o.choicesSettings?.choices ?? []) as RawProduct[]) {
          if (ch.visible === false || !ch.choiceId) continue;
          if (!facet.choices.some((x) => x.id === ch.choiceId))
            facet.choices.push({ id: ch.choiceId, name: ch.name ?? "", colorCode: ch.colorCode ?? null });
        }
        byName.set(name, facet);
      }
    }
    return [...byName.values()].filter((f) => f.choices.length > 1);
  } catch {
    return [];
  }
}

/** First page of visible products in the default order — a thin wrap of searchCatalog. */
export async function fetchProducts({ limit = 24 } = {}): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit })).products;
}

/** First page of a category — same wrap; category filtering only works through search. */
export async function fetchProductsByCategory(
  categoryId: string,
  { limit = 24 } = {},
): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit, categoryId })).products;
}

/** Fetch one product by its URL slug, with options/modifiers/variants. Null when not found. */
export async function fetchProductBySlug(slug: string): Promise<ProductDetail | null> {
  try {
    const res = await products.getProductBySlug(slug, { fields: DETAIL_FIELDS as any });
    return res.product ? toDetail(res.product as RawProduct) : null;
  } catch {
    return null;
  }
}

/**
 * List the store's categories for nav/filter UI, minus Wix's auto-created "all-products"
 * system category. The query must carry a filter condition (`.exists("name", true)` — a
 * tautology): a bare .find() serializes an empty filter that the API rejects on the
 * visitor-client path. Treat a failure as "no category nav", not a fatal error.
 */
export async function fetchCategories(): Promise<Category[]> {
  try {
    const res = await categories
      .queryCategories({ treeReference: { appNamespace: "@wix/stores" } })
      .exists("name", true)
      .find();
    return (res.items ?? [])
      .map((c) => toCategory(c as RawProduct))
      .filter((c) => c.slug !== "all-products");
  } catch {
    return [];
  }
}

function toCategory(raw: RawProduct): Category {
  return {
    id: raw._id ?? raw.id ?? "",
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    description: raw.description ?? "",
  };
}

/**
 * One category by its URL slug — the data a /category/[slug] page needs (its id feeds
 * searchCatalog / useShop, its name and description head the page). Null when not found or
 * hidden, which the page turns into a real 404 — never a fallback to all products.
 */
export async function fetchCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const res: RawProduct = await categories.getCategoryBySlug(slug, { appNamespace: "@wix/stores" } as any);
    const raw: RawProduct | undefined = res?.category;
    if (!raw || raw.visible === false) return null;
    return toCategory(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the variant for the buyer's selections (optionName -> choiceName).
 * A product with no options resolves to its single variant; with options, every option
 * must be selected and match. Returns null while the selection is incomplete.
 */
export function resolveVariant(
  detail: ProductDetail,
  selections: Record<string, string>,
): ProductVariant | null {
  if (detail.options.length === 0) return detail.variants[0] ?? null;
  if (!detail.options.every((o) => selections[o.name])) return null;
  return (
    detail.variants.find((v) =>
      detail.options.every((o) => v.choices[o.name] === selections[o.name]),
    ) ?? null
  );
}
