// Catalog reads (Wix Stores Catalog V3) — the only file that touches raw catalog entities.
// Everything it returns is a plain DTO from ./types: images resolved, prices formatted,
// variants normalized. Copy as-is; extend by adding functions, not by editing these.
import { productsV3 } from "@wix/stores";
import { categories as categoriesModule } from "@wix/categories";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type {
  Category,
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
const LIST_FIELDS = ["CURRENCY", "MEDIA_ITEMS_INFO"];
const DETAIL_FIELDS = [...LIST_FIELDS, "PLAIN_DESCRIPTION", "VARIANT_OPTION_CHOICE_NAMES"];

type RawProduct = Record<string, any>;

function toAvailability(raw: RawProduct): Availability {
  const status = raw.inventory?.availabilityStatus;
  return status === "OUT_OF_STOCK" || status === "PARTIALLY_OUT_OF_STOCK"
    ? status
    : "IN_STOCK";
}

function toSummary(raw: RawProduct): ProductSummary {
  const options: RawProduct[] = raw.options ?? [];
  const galleryItems: RawProduct[] = raw.media?.itemsInfo?.items ?? [];
  const mainUrl = imgSrc(raw.media?.main, 800, 800);
  const hover = galleryItems
    .map((m) => imgSrc(m.image ?? m, 800, 800))
    .filter((u) => u && u !== mainUrl);
  const availability = toAvailability(raw);
  const preorder = raw.inventory?.preorderStatus === "ENABLED" && availability === "OUT_OF_STOCK";
  const optionsSummary = options
    .map((o) => {
      const visible = (o.choicesSettings?.choices ?? []).filter((c: RawProduct) => c.visible !== false);
      return `${visible.length} ${String(o.name ?? "").toLowerCase()}${visible.length === 1 ? "" : "s"}`;
    })
    .join(" · ");
  return {
    id: raw._id ?? "",
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    price: raw.actualPriceRange?.minValue?.formattedAmount ?? "",
    maxPrice: raw.actualPriceRange?.maxValue?.formattedAmount ?? "",
    compareAtPrice: raw.compareAtPriceRange?.minValue?.formattedAmount ?? null,
    ribbon: raw.ribbon?.name ?? null,
    availability,
    preorder,
    imageUrl: mainUrl,
    hoverImageUrl: hover[0] ?? "",
    optionsSummary,
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
    return {
      variantId: v._id ?? v.variantId ?? "",
      choices,
      price: v.price?.actualPrice?.formattedAmount ?? "",
      compareAtPrice: v.price?.compareAtPrice?.formattedAmount ?? null,
      inStock: v.inventoryStatus?.inStock !== false,
    };
  });
}

function toDetail(raw: RawProduct): ProductDetail {
  const summary = toSummary(raw);
  const gallery = [
    summary.imageUrl,
    ...(raw.media?.itemsInfo?.items ?? []).map((m: RawProduct) => imgSrc(m.image ?? m, 1200, 1200)),
  ].filter((u, i, arr) => u && arr.indexOf(u) === i);
  return {
    ...summary,
    descriptionHtml: raw.plainDescription ?? "",
    gallery,
    options: toOptions(raw),
    modifiers: toModifiers(raw),
    variants: toVariants(raw),
  };
}

/** List visible products (newest catalog order), mapped to grid-ready DTOs. */
export async function fetchProducts({ limit = 100 } = {}): Promise<ProductSummary[]> {
  const res = await products
    .queryProducts({ fields: LIST_FIELDS as any })
    .limit(limit)
    .find();
  return (res.items ?? []).map((p) => toSummary(p as RawProduct));
}

/**
 * List visible products in a category, server-side-filtered by the live category id.
 * Category filtering MUST go through searchProducts (the field is not filterable in
 * queryProducts) with the $matchItems operator — this is encoded here so callers never
 * reconstruct it.
 */
export async function fetchProductsByCategory(
  categoryId: string,
  { limit = 100 } = {},
): Promise<ProductSummary[]> {
  const res: RawProduct = await products.searchProducts(
    {
      filter: { "allCategoriesInfo.categories": { $matchItems: [{ id: categoryId }] } },
      cursorPaging: { limit },
    },
    { fields: LIST_FIELDS as any },
  );
  return (res.products ?? []).map((p: RawProduct) => toSummary(p));
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
      .map((c) => ({
        id: (c as RawProduct)._id ?? "",
        slug: (c as RawProduct).slug ?? "",
        name: (c as RawProduct).name ?? "",
      }))
      .filter((c) => c.slug !== "all-products");
  } catch {
    return [];
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
