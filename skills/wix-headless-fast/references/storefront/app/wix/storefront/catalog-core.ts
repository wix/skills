// Catalog rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./catalog.ts
// (the SDK, managed Astro and React) and the REST twin in references/storefront/rest/catalog.ts
// (fetch, a static site or a port to another language). Every rule about prices, ribbons,
// ranges, media, variants lives HERE, once. A raw entity may come from the SDK (`_id`) or from
// REST (`id`); the mappers accept both. Imports are type-only so a strip to JS emits no imports.
import type {
  Availability,
  Category,
  Facet,
  FacetData,
  ProductDetail,
  ProductModifier,
  ProductOption,
  ProductSummary,
  ProductVariant,
} from "./types";

/** A raw Catalog V3 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;
/** Media identity before scaling — de-duplicate on this, never on a resolved URL. */
export type MediaKey = (value: any) => string;

const id = (raw: Raw | undefined): string => raw?._id ?? raw?.id ?? "";

// Requested on every product read. CURRENCY → formattedAmount (without it prices render as bare
// numbers); MEDIA_ITEMS_INFO → the gallery; MIN_PRICE_VARIANT + DISCOUNT_INFO → the cheapest variant
// with its discounted price: a card's real price and the direct-add variant id, no per-product fetch.
export const LIST_FIELDS = ["CURRENCY", "MEDIA_ITEMS_INFO", "MIN_PRICE_VARIANT", "DISCOUNT_INFO"] as const;
// The detail read adds the HTML description, the variants (VARIANT_OPTION_CHOICE_NAMES — without it
// variantsInfo is null), and the info sections with HTML bodies.
export const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  "PLAIN_DESCRIPTION",
  "VARIANT_OPTION_CHOICE_NAMES",
  "INFO_SECTION",
  "INFO_SECTION_PLAIN_DESCRIPTION",
] as const;

// ---- sort + filter ---------------------------------------------------------------------------------

export const CATALOG_SORTS = {
  featured: { label: "Default order" }, // the catalog's own order — no sort sent, and NOT a sales ranking
  priceAsc: { label: "Price: low to high" },
  priceHigh: { label: "Price: high to low" },
  name: { label: "Name: A–Z" },
  newest: { label: "Newest" },
} as const;
export type CatalogSort = keyof typeof CATALOG_SORTS;

export const SORT_FIELDS: Partial<Record<CatalogSort, { fieldName: string; order: "ASC" | "DESC" }[]>> = {
  priceAsc: [{ fieldName: "actualPriceRange.minValue.amount", order: "ASC" }, { fieldName: "name", order: "ASC" }],
  priceHigh: [{ fieldName: "actualPriceRange.minValue.amount", order: "DESC" }, { fieldName: "name", order: "ASC" }],
  name: [{ fieldName: "name", order: "ASC" }],
  newest: [{ fieldName: "createdDate", order: "DESC" }, { fieldName: "name", order: "ASC" }],
};

export interface CatalogSearchOptions {
  /** 1–100, default 24. */
  limit?: number;
  /** Continues the ORIGINAL query — send it alone; any change of selection starts over without one. */
  cursor?: string | null;
  categoryId?: string | null;
  sort?: CatalogSort;
  /** Inclusive bounds on the product's minimum actual variant price, site currency. */
  minPrice?: number | string;
  maxPrice?: number | string;
  /** IN_STOCK only — excludes partially stocked and preorder-only products. */
  inStockOnly?: boolean;
  /** Name search, max 100 chars. */
  search?: string;
  /** Option-choice facets: products carrying ANY of these choice ids (see fetchFacetData). */
  choiceIds?: string[];
}

export function priceBound(value: number | string | undefined, name: string): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number.`);
  return n;
}

/**
 * The filter every catalog read shares (the page, its count, the facets) — one place, so they
 * can't drift. Search rejects two operators in ONE field object: price bounds are separate
 * conditions joined by $and. Category: `allCategoriesInfo.categories` with `$matchItems` on the
 * id (includes parent categories); never `$hasSome`, never V1 `collectionIds`. Facets discover
 * PRODUCTS carrying a choice; the picker / PDP still resolves the variant.
 */
export function catalogFilter({ categoryId, minPrice, maxPrice, inStockOnly = false, choiceIds = [] }: CatalogSearchOptions = {}): Raw {
  const min = priceBound(minPrice, "minPrice"), max = priceBound(maxPrice, "maxPrice");
  if (min !== undefined && max !== undefined && min > max) throw new Error("minPrice must not exceed maxPrice.");
  const and: Raw[] = [{ visible: true }];
  if (categoryId) and.push({ "allCategoriesInfo.categories": { $matchItems: [{ id: categoryId }] } });
  if (min !== undefined) and.push({ "actualPriceRange.minValue.amount": { $gte: String(min) } });
  if (max !== undefined) and.push({ "actualPriceRange.minValue.amount": { $lte: String(max) } });
  if (inStockOnly) and.push({ "inventory.availabilityStatus": { $eq: "IN_STOCK" } });
  if (choiceIds.length) and.push({ "options.choicesSettings.choices.choiceId": { $hasSome: choiceIds } });
  return { $and: and };
}

/** The full Search Products body (minus fields) for a page; a cursor request carries ONLY cursorPaging. */
export function searchQuery(o: CatalogSearchOptions): Raw {
  const { limit = 24, cursor, sort = "featured", search = "" } = o;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100.");
  const paging = { cursorPaging: { limit, ...(cursor ? { cursor } : {}) } };
  if (cursor) return paging;
  if (!(sort in CATALOG_SORTS)) throw new Error("Unsupported catalog sort.");
  if (search.trim().length > 100) throw new Error("Search must be at most 100 characters.");
  return {
    ...paging,
    filter: catalogFilter(o),
    ...(SORT_FIELDS[sort] ? { sort: SORT_FIELDS[sort] } : {}),
    ...(search.trim() ? { search: { expression: search.trim(), fields: ["name"] } } : {}),
  };
}

// ---- price rules ----------------------------------------------------------------------------------

/**
 * The price the buyer pays and the price to strike — exact precedence, shared by cards and
 * variants. An automatic discount (priceAfterDiscount) wins and strikes the regular actualPrice;
 * else actualPrice with the merchant's compareAtPrice as the "was". `!== undefined` on purpose:
 * a discounted price of 0 is a real price.
 */
export function sellingPrice(price: Raw | undefined): { current?: Raw; original?: Raw } {
  if (price?.priceAfterDiscount !== undefined) return { current: price.priceAfterDiscount, original: price.actualPrice };
  return { current: price?.actualPrice, original: price?.compareAtPrice };
}

/** The struck price only when it is real and higher than what the buyer pays. */
export function strike(original: Raw | undefined, current: Raw | undefined): string | null {
  const o = Number(original?.amount), c = Number(current?.amount);
  return original?.formattedAmount && Number.isFinite(o) && Number.isFinite(c) && o > c ? original.formattedAmount : null;
}

/** Every merchant ribbon, primary first, de-duplicated. A ribbon is a label, never proof of a price. */
export function ribbonsOf(raw: Raw): string[] {
  return [raw.ribbon?.name, ...((raw.additionalRibbons ?? []) as Raw[]).map((r) => r?.name)]
    .filter((n, i, all): n is string => typeof n === "string" && n.length > 0 && all.indexOf(n) === i);
}

export function toAvailability(raw: Raw): Availability {
  const s = raw.inventory?.availabilityStatus;
  return s === "OUT_OF_STOCK" || s === "PARTIALLY_OUT_OF_STOCK" ? s : "IN_STOCK";
}

/**
 * Every distinct media entry, main first, keyed on identity — two scaled URLs of one photo are
 * ONE entry (the "two thumbnails for the same image" bug). Shared by the tile and the PDP.
 */
export function mediaEntries(raw: Raw, mediaKey: MediaKey): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const m of [raw.media?.main, ...((raw.media?.itemsInfo?.items ?? []) as Raw[])]) {
    const v = m?.image ?? m;
    const k = mediaKey(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// ---- DTO mappers -----------------------------------------------------------------------------------

export function toSummary(raw: Raw, imgSrc: ImgSrc, mediaKey: MediaKey): ProductSummary {
  const options: Raw[] = raw.options ?? [];
  const media = mediaEntries(raw, mediaKey);
  const mainUrl = imgSrc(media[0], 800, 800);
  const hover = media.slice(1).map((m) => imgSrc(m, 800, 800)).filter(Boolean);
  const availability = toAvailability(raw);
  // Price: the cheapest variant's selling price (discount applied); the product RANGE when variants
  // are priced differently — and NO struck price beside a range (a lone struck minimum claims a
  // saving that may not apply to the variant picked).
  const min = raw.actualPriceRange?.minValue, max = raw.actualPriceRange?.maxValue;
  const isRange = !!(min?.amount && max?.amount && min.amount !== max.amount);
  const minVariant: Raw | undefined = raw.variantSummary?.minPriceVariant;
  const { current, original } = sellingPrice(minVariant?.price);
  const ribbons = ribbonsOf(raw);
  return {
    id: id(raw),
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    price: current?.formattedAmount ?? min?.formattedAmount ?? "",
    maxPrice: max?.formattedAmount ?? "",
    compareAtPrice: isRange ? null : strike(original ?? raw.compareAtPriceRange?.minValue, current ?? min),
    ribbon: ribbons[0] ?? null,
    ribbons,
    minPriceVariantId: minVariant ? id(minVariant) || minVariant.variantId || null : null,
    availability,
    // Out of stock but pre-orderable — label "Pre-order", not "Sold out".
    preorder: raw.inventory?.preorderStatus === "ENABLED" && availability === "OUT_OF_STOCK",
    imageUrl: mainUrl,
    hoverImageUrl: hover[0] ?? "",
    optionsSummary: options
      .map((o) => {
        const n = ((o.choicesSettings?.choices ?? []) as Raw[]).filter((c) => c.visible !== false).length;
        return `${n} ${String(o.name ?? "").toLowerCase()}${n === 1 ? "" : "s"}`;
      })
      .join(" · "),
    swatches: options
      .filter((o) => o.optionRenderType === "SWATCH_CHOICES" || o.optionRenderType === "COLOR_CHOICES")
      .flatMap((o) => (o.choicesSettings?.choices ?? []) as Raw[])
      .filter((c) => c.visible !== false && c.colorCode)
      .map((c) => String(c.colorCode)),
    // Addable in one click: no options and plainly in stock.
    quickAddable: options.length === 0 && availability === "IN_STOCK",
  };
}

export function toOptions(raw: Raw): ProductOption[] {
  return ((raw.options ?? []) as Raw[]).map((o) => ({
    id: id(o) || o.name || "",
    name: o.name ?? "",
    isColor: o.optionRenderType === "SWATCH_CHOICES" || o.optionRenderType === "COLOR_CHOICES",
    choices: ((o.choicesSettings?.choices ?? []) as Raw[])
      .filter((c) => c.visible !== false) // a retired choice the merchant no longer sells
      .map((c) => ({ choiceId: c.choiceId ?? "", name: c.name ?? "", colorCode: c.colorCode ?? null, inStock: c.inStock !== false })),
  }));
}

export function toModifiers(raw: Raw): ProductModifier[] {
  return ((raw.modifiers ?? []) as Raw[]).map((m) => ({
    key: m.key ?? m.freeTextSettings?.key ?? m.name ?? "",
    name: m.name ?? "",
    mandatory: m.mandatory === true,
    type: m.modifierRenderType === "FREE_TEXT" ? ("text" as const) : ("choices" as const),
    choices: ((m.choicesSettings?.choices ?? []) as Raw[]).map((c) => ({ key: c.key ?? c.name ?? "", name: c.name ?? "" })),
  }));
}

/** Variants keyed by optionName → choiceName. Buyable when in stock OR pre-orderable. */
// `variant.media` is read-only on the API: Wix derives it from the media linked to the variant's
// choice (a product with several options derives it only when the choices agree). Mapped to a
// URL so a PDP can show the selected variant's picture without knowing how Wix derives it.
export function toVariants(raw: Raw, imgSrc: ImgSrc): ProductVariant[] {
  return ((raw.variantsInfo?.variants ?? []) as Raw[])
    .filter((v) => v.visible !== false)
    .map((v) => {
      const choices: Record<string, string> = {};
      for (const c of (v.choices ?? []) as Raw[]) {
        const on = c.optionChoiceNames?.optionName, cn = c.optionChoiceNames?.choiceName;
        if (on && cn) choices[on] = cn;
      }
      const { current, original } = sellingPrice(v.price);
      const vm = v.media ? (v.media.image ?? v.media) : null;
      return {
        variantId: id(v),
        choices,
        price: current?.formattedAmount ?? "",
        compareAtPrice: strike(original, current),
        inStock: v.inventoryStatus?.inStock !== false,
        preorderEnabled: v.inventoryStatus?.preorderEnabled === true,
        imageUrl: vm ? imgSrc(vm, 1200, 1200) || null : null,
      };
    });
}

export function toDetail(raw: Raw, imgSrc: ImgSrc, mediaKey: MediaKey): ProductDetail {
  return {
    ...toSummary(raw, imgSrc, mediaKey),
    descriptionHtml: raw.plainDescription ?? "", // an HTML string despite the name — render as HTML
    infoSections: ((raw.infoSections ?? []) as Raw[])
      .map((s) => ({ title: s.title ?? "", html: s.plainDescription ?? "" }))
      .filter((s) => s.title || s.html),
    // De-duplicated on media identity, then resolved once at one size.
    gallery: mediaEntries(raw, mediaKey).map((m) => imgSrc(m, 1200, 1200)).filter(Boolean),
    options: toOptions(raw),
    modifiers: toModifiers(raw),
    variants: toVariants(raw, imgSrc),
  };
}

export function toCategory(raw: Raw): Category {
  return { id: id(raw), slug: raw.slug ?? "", name: raw.name ?? "", description: raw.description ?? "" };
}

/** Facets + price bounds from a scope's products (the 100-product read), so the panel only offers filters that exist. */
export function toFacetData(products: Raw[]): FacetData {
  const byName = new Map<string, Facet>();
  let lo = Infinity, hi = -Infinity, currency = "";
  for (const p of products) {
    const min = Number(p.actualPriceRange?.minValue?.amount), max = Number(p.actualPriceRange?.maxValue?.amount);
    if (Number.isFinite(min)) lo = Math.min(lo, min);
    if (Number.isFinite(max)) hi = Math.max(hi, max);
    currency = currency || p.currency || "";
    for (const o of (p.options ?? []) as Raw[]) {
      if (!o.name) continue;
      const facet: Facet = byName.get(o.name) ?? { name: o.name, isColor: o.optionRenderType === "SWATCH_CHOICES" || o.optionRenderType === "COLOR_CHOICES", choices: [] };
      for (const c of (o.choicesSettings?.choices ?? []) as Raw[]) {
        if (c.visible === false || !c.choiceId) continue;
        if (!facet.choices.some((x) => x.id === c.choiceId)) facet.choices.push({ id: c.choiceId, name: c.name ?? "", colorCode: c.colorCode ?? null });
      }
      byName.set(o.name, facet);
    }
  }
  return {
    facets: [...byName.values()].filter((f) => f.choices.length > 1),
    priceRange: Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? { min: Math.floor(lo), max: Math.ceil(hi), currency } : null,
  };
}

/**
 * Resolve the variant for the buyer's selections (optionName → choiceName). A product with no
 * options resolves to its single variant; with options every option must be selected and match.
 * null while incomplete. Selections start EMPTY — never pre-pick a first choice.
 */
export function resolveVariant(detail: ProductDetail, selections: Record<string, string>): ProductVariant | null {
  if (detail.options.length === 0) return detail.variants[0] ?? null;
  if (!detail.options.every((o) => selections[o.name])) return null;
  return detail.variants.find((v) => detail.options.every((o) => v.choices[o.name] === selections[o.name])) ?? null;
}
