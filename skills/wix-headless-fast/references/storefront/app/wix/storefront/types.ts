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
  /** Lowest price, formatted with currency symbol (e.g. "€34.99"). */
  price: string;
  /** Highest price, formatted — differs from `price` when variants are priced differently. */
  maxPrice: string;
  /** Strikethrough "was" price, formatted; null when not on sale. */
  compareAtPrice: string | null;
  /** Merchant-set badge ("New", "Best Seller"); null when none. */
  ribbon: string | null;
  availability: Availability;
  /** OUT_OF_STOCK but pre-orderable — label "Pre-order", not "Sold out". */
  preorder: boolean;
  /** Resolved https URL of the main image ("" when the product has none). */
  imageUrl: string;
  /** Resolved https URL of the second gallery image ("" when there is only one). */
  hoverImageUrl: string;
  /** e.g. "2 colors · 3 sizes"; "" for a single-variant product. */
  optionsSummary: string;
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
  price: string;
  compareAtPrice: string | null;
  inStock: boolean;
}

/** A product as the detail page needs it. */
export interface ProductDetail extends ProductSummary {
  /** Product description as an HTML string — render with innerHTML, not as text. */
  descriptionHtml: string;
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
}

export interface Cart {
  lines: CartLine[];
  /** Sum of line quantities. */
  itemCount: number;
  /** Formatted subtotal (after discounts) — from the cart estimate, not hand-summed. */
  subtotal: string;
  currency: string;
}
