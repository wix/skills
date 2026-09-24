// Storefront DTOs — the serializable shapes every hook, component, and page consumes.
// These are plain JSON: safe to pass as Astro island props or across a server/client
// boundary. Image values are already-resolved https URLs (never wix:image://), and every
// displayable price is a ready formatted string.

export type Availability = "IN_STOCK" | "OUT_OF_STOCK" | "PARTIALLY_OUT_OF_STOCK";

/** A product as a listing/grid tile needs it. */
export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  /**
   * The price the buyer pays for the cheapest variant, formatted (an automatic discount already
   * applied). When `price !== maxPrice` the product is a RANGE — render "price – maxPrice".
   */
  price: string;
  /** Highest variant price, formatted — differs from `price` when variants are priced differently. */
  maxPrice: string;
  /**
   * Struck "was" price, formatted; null when not on sale — and ALWAYS null for a range (a lone
   * struck minimum beside a range claims a saving that may not apply to the variant picked).
   */
  compareAtPrice: string | null;
  /** The primary merchant ribbon ("New", "Best Seller"); null when none. Same as ribbons[0]. */
  ribbon: string | null;
  /** EVERY merchant ribbon, primary first ("New", "Sale") — render all of them, one shared style. */
  ribbons: string[];
  /** The cheapest variant's id — what a direct add sends for a product with no options; null when unknown. */
  minPriceVariantId: string | null;
  availability: Availability;
  /** OUT_OF_STOCK but pre-orderable — label "Pre-order", not "Sold out". */
  preorder: boolean;
  /** Resolved https URL of the main image ("" when the product has none). */
  imageUrl: string;
  /** Resolved https URL of the second gallery image ("" when there is only one). */
  hoverImageUrl: string;
  /** e.g. "2 colors · 3 sizes"; "" for a single-variant product. */
  optionsSummary: string;
  /**
   * Hex colors of a color option's visible choices, catalog order — render as small dots on the
   * tile (a preview, not a picker: selection happens in QuickAdd or on the PDP). [] when none.
   */
  swatches: string[];
  /** True when the product can be added to the cart with no choices (single variant, in stock). */
  quickAddable: boolean;
}

export interface OptionChoice {
  choiceId: string;
  name: string;
  /** Hex color for swatch rendering; null for text choices. */
  colorCode: string | null;
  inStock: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  /** Render choices as color swatches (true) or text pills (false). */
  isColor: boolean;
  choices: OptionChoice[];
}

export interface ProductModifier {
  key: string;
  name: string;
  mandatory: boolean;
  /** "choices" renders pills; "text" renders a free-text input. */
  type: "choices" | "text";
  choices: { key: string; name: string }[];
}

export interface ProductVariant {
  variantId: string;
  /** The option selections this variant answers to: optionName -> choiceName. */
  choices: Record<string, string>;
  /** The price the buyer pays, formatted — an automatic discount beats the regular price. */
  price: string;
  /** Struck "was" price, formatted; null unless it is real and higher than `price`. */
  compareAtPrice: string | null;
  inStock: boolean;
  /** Out of stock but pre-orderable — still buyable (the add carries preOrderRequested). */
  preorderEnabled: boolean;
}

/** A product as the detail page needs it. */
export interface ProductDetail extends ProductSummary {
  /** Product description as an HTML string — render with innerHTML, not as text. */
  descriptionHtml: string;
  /** Merchant info sections (materials, shipping, care…) — title + HTML; render as sections or accordions. */
  infoSections: { title: string; html: string }[];
  /** Every gallery image as a resolved https URL, main image first, de-duplicated. */
  gallery: string[];
  options: ProductOption[];
  modifiers: ProductModifier[];
  variants: ProductVariant[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  /** Plain-text description when the merchant wrote one; "" otherwise. */
  description: string;
}

export interface FacetChoice {
  /** The option choice id — what searchCatalog({ choiceIds }) filters on. */
  id: string;
  name: string;
  /** Hex color for a swatch facet; null for a text facet. */
  colorCode: string | null;
}

/** One filterable option across the catalog (or a category): "Color" with its choices. */
export interface Facet {
  name: string;
  isColor: boolean;
  choices: FacetChoice[];
}

/** The catalog's (or category's) lowest and highest product price, as numbers in site currency — the slider's bounds. */
export interface PriceRange {
  min: number;
  max: number;
  currency: string;
}

/** What the filter panel needs beyond the product page: the facets and the price bounds of the scope. */
export interface FacetData {
  facets: Facet[];
  priceRange: PriceRange | null;
}

export interface CartLine {
  /** The cart line id — what update/remove take (NOT the product id). */
  lineItemId: string;
  productName: string;
  quantity: number;
  /** Per-unit price, formatted. */
  unitPrice: string;
  /** Line total, formatted. */
  linePrice: string;
  /** Resolved https URL ("" when none). */
  imageUrl: string;
  /** Human-readable option/modifier labels, e.g. ["Color: Ink", "Size: M"]. */
  descriptionLines: string[];
  /** Not IN_STOCK → the line can't be checked out as-is. */
  status: string;
  /**
   * The recurring plan's terms for a subscription line — "Monthly plan · every month · 12 payments";
   * "" for a one-time purchase. A subscription line must read as one in the cart.
   */
  subscription: string;
}

export interface Cart {
  lines: CartLine[];
  /** Sum of line quantities. */
  itemCount: number;
  /** Formatted subtotal (after discounts) — from the cart estimate, not hand-summed. */
  subtotal: string;
  /** Formatted CART-level discount (a coupon or cart rule) — "" when none; item discounts are already in subtotal. */
  discount: string;
  currency: string;
}
