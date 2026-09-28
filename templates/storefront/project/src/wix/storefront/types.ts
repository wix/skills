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
   * The cheapest variant is discounted AND variants are priced differently: the discounted
   * maximum is unknown until the PDP loads the variants, so render "From {price}" (no maxPrice,
   * no struck price). `maxPrice` equals `price` then.
   */
  fromPrice: boolean;
  /**
   * Struck "was" price, formatted; null when not on sale — and ALWAYS null for a range (a lone
   * struck minimum beside a range claims a saving that may not apply to the variant picked).
   */
  compareAtPrice: string | null;
  /** Names of the automatic discount rules applying to this product ("Summer sale") — render under the price; [] when none. */
  discountNames: string[];
  /** Price per unit of the cheapest variant as Wix formats it ("€2.50 / 100 g"); null when the product isn't sold by unit. */
  pricePerUnit: string | null;
  /** The primary merchant ribbon ("New", "Best Seller"); null when none. Same as ribbons[0]. */
  ribbon: string | null;
  /** EVERY merchant ribbon, primary first ("New", "Sale") — render all of them, one shared style. */
  ribbons: string[];
  /** The cheapest variant's id — what a direct add sends for a product with no options; null when unknown. */
  minPriceVariantId: string | null;
  availability: Availability;
  /** OUT_OF_STOCK but pre-orderable — label "Pre-order", not "Sold out". */
  preorder: boolean;
  /** The product sells as a subscription (recurring plans) — the tile routes to the PDP, where the plan is picked. */
  hasSubscriptions: boolean;
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
  /** True when the product can be added to the cart with no choices (single variant, in stock, no subscription plans). */
  quickAddable: boolean;
}

export interface OptionChoice {
  choiceId: string;
  /** Read-only identifier Wix derives from the name — what `catalogReference.options[option.key]` carries. */
  key: string;
  name: string;
  /** Hex color for swatch rendering; null for text choices. */
  colorCode: string | null;
  /** At least one variant with this choice is in stock (catalog-level; the PDP store refines it against the current selection). */
  inStock: boolean;
}

export interface ProductOption {
  /** The option's customization id — what `selectOption(optionId, choiceId)` and `ProductVariant.choiceIds` use. */
  id: string;
  /** Read-only identifier Wix derives from the name — the key inside `catalogReference.options`. */
  key: string;
  name: string;
  /** Render choices as color swatches (true) or text pills (false). */
  isColor: boolean;
  choices: OptionChoice[];
}

export interface ProductModifier {
  /** The modifier's customization id. */
  id: string;
  /**
   * The key the cart takes: `catalogReference.options[key] = choice.key` for a choice modifier,
   * `customTextFields[key] = text` for a free-text one (its `freeTextSettings.key`).
   */
  key: string;
  name: string;
  /** Input required before adding — Wix treats a modifier as mandatory unless it says otherwise. */
  mandatory: boolean;
  /** "choices" renders pills; "text" renders a free-text input. */
  type: "choices" | "text";
  /** The label of a free-text input (Wix's `freeTextSettings.title`); the modifier name for choices. */
  title: string;
  /** Free text only: character limits from the merchant; null when unlimited / none. */
  maxChars: number | null;
  minChars: number | null;
  choices: { choiceId: string; key: string; name: string }[];
}

/** A recurring plan the product can be bought on. */
export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  /** Payment frequency unit; null when Wix didn't say. */
  frequency: "DAY" | "WEEK" | "MONTH" | "YEAR" | null;
  /** Every N frequency units (1 = every month). */
  interval: number;
  /** Number of payments; null = until cancelled (auto-renewing). */
  billingCycles: number | null;
  /** "every 2 months · 6 payments" — the terms in words, ready to render. */
  terms: string;
}

export interface ProductVariant {
  variantId: string;
  /** The option selections this variant answers to, by id: optionId -> choiceId (what resolveVariant matches on). */
  choiceIds: Record<string, string>;
  /** The same selections by name: optionName -> choiceName (display only). */
  choices: Record<string, string>;
  /** The price the buyer pays, formatted — an automatic discount beats the regular price. */
  price: string;
  /** The same selling price as a number in site currency — for ranges, never for display. */
  priceAmount: number;
  /** Struck "was" price, formatted; null unless it is real and higher than `price`. */
  compareAtPrice: string | null;
  /** Price per unit as Wix formats it ("€2.50 / 100 g"); null when not sold by unit. */
  pricePerUnit: string | null;
  /** Merchant SKU; null when none. */
  sku: string | null;
  /** planId -> the formatted price of this variant on that plan (Wix applies the plan's discount to the variant's price). */
  subscriptionPrices: Record<string, string>;
  inStock: boolean;
  /** Out of stock but pre-orderable — still buyable (the add carries preOrderRequested). */
  preorderEnabled: boolean;
  /**
   * Units left to buy: the tracked stock, or the remaining pre-order allowance when pre-ordering.
   * null when stock isn't counted (made to order) or the inventory hasn't loaded yet.
   */
  quantity: number | null;
  /** The merchant's pre-order note ("Ships in 3 weeks"); null when none or not pre-orderable. */
  preorderMessage: string | null;
  /** This variant's own image (from its choice's linked media), resolved to an https URL; null when it has none. */
  imageUrl: string | null;
}

/** One inventory record per variant at the store's default location (fetchInventory). */
export interface VariantInventory {
  status: "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER";
  /** Units in stock when counted; null when stock is a yes/no flag. */
  quantity: number | null;
  /** Units still pre-orderable when `status` is PREORDER; null otherwise or when uncounted. */
  preorderQuantity: number | null;
  preorderMessage: string | null;
}

/** A category breadcrumb: an ancestor (or, on a product, the path to its main category). */
export interface Breadcrumb {
  id: string;
  name: string;
  slug: string;
}

/** A product as the detail page needs it. */
export interface ProductDetail extends ProductSummary {
  /** Product description as an HTML string — render with innerHTML, not as text. */
  descriptionHtml: string;
  /** Merchant info sections (materials, shipping, care…) — title + HTML; render as sections or accordions. */
  infoSections: { title: string; html: string }[];
  /** Every gallery image as a resolved https URL, main image first, de-duplicated. */
  gallery: string[];
  /** Path to the product's main category, top-level first ("Clothing" > "T-Shirts"); [] when it has no main category. */
  breadcrumbs: Breadcrumb[];
  /** Ids of the categories the product is directly assigned to. */
  categoryIds: string[];
  options: ProductOption[];
  modifiers: ProductModifier[];
  variants: ProductVariant[];
  /** The recurring plans the product is sold on; [] for a one-time-only product. */
  subscriptions: SubscriptionPlan[];
  /** With plans present: whether a plain one-time purchase is also offered. */
  allowOneTimePurchase: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  /** Plain-text description when the merchant wrote one; "" otherwise. */
  description: string;
  /** The category's own image, resolved to an https URL; "" when none. */
  imageUrl: string;
  /** The parent category's id; null for a top-level category. */
  parentId: string | null;
  /** Position among its siblings (the merchant's order). */
  index: number;
  /** Products directly in this category (not in its subcategories); null when unknown. */
  productCount: number | null;
  /** Ancestors, top-level first — only filled by fetchCategoryBySlug; [] elsewhere. */
  breadcrumbs: Breadcrumb[];
}

export interface FacetChoice {
  /** The choice id — what toggleChoice / searchCatalog filter on. */
  id: string;
  name: string;
  /** Hex color for a swatch facet; null for a text facet. */
  colorCode: string | null;
  /** Products in the scope carrying this choice (linked choices counted into their primary). */
  count: number;
  /** Ids of linked choices shown under this one ("Light red" under "Red") — the filter sends them along; [] when none. */
  childIds: string[];
}

/** One filterable customization across the catalog (or a category): "Color" with its choices. */
export interface Facet {
  /** The customization id (an option's or a modifier's). */
  id: string;
  name: string;
  /** Options and modifiers filter on different fields — the store keeps them apart. */
  kind: "option" | "modifier";
  isColor: boolean;
  choices: FacetChoice[];
}

/** The catalog's (or category's) lowest and highest product price, as numbers in site currency — the slider's bounds. */
export interface PriceRange {
  min: number;
  max: number;
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
  /** Struck line total (the catalog price × quantity) when the line is discounted; null otherwise. */
  compareAtLinePrice: string | null;
  /** Units the store can still sell of this line; null when uncounted. The stepper's ceiling. */
  availableQuantity: number | null;
  /** Resolved https URL ("" when none). */
  imageUrl: string;
  /** The item's page URL when Wix returned one; "" otherwise (a headless site links by slug). */
  productUrl: string;
  /** Human-readable option/modifier labels, e.g. ["Color: Ink", "Size: M"]. */
  descriptionLines: string[];
  /** IN_STOCK | PARTIALLY_IN_STOCK | OUT_OF_STOCK | REMOVED_FROM_CATALOG — not IN_STOCK → the line can't be checked out as-is. */
  status: string;
  /**
   * The recurring plan's terms for a subscription line — "Monthly plan · every month · 12 payments";
   * "" for a one-time purchase. A subscription line must read as one in the cart.
   */
  subscription: string;
}

/** A named amount from the cart estimate (a discount, a fee, a tax), formatted. */
export interface CartAmount {
  name: string;
  amount: string;
}

export interface Cart {
  lines: CartLine[];
  /** Sum of line quantities. */
  itemCount: number;
  /** Formatted subtotal (after item discounts) — from the cart estimate, not hand-summed. */
  subtotal: string;
  /** Formatted CART-level discount total (a coupon or cart rule) — "" when none; item discounts are already in subtotal. */
  discount: string;
  /** Every applied discount by name (coupon, automatic rule) with its amount; [] when none. */
  discounts: CartAmount[];
  /** Additional fees (handling, platform) with their amounts; [] when none. */
  fees: CartAmount[];
  /** Taxes by name; [] when none or not yet calculable (no address). */
  taxes: CartAmount[];
  /** Line prices already include tax — don't render a tax row then. */
  pricesIncludeTax: boolean;
  /** Formatted total to pay before delivery (shipping resolves at checkout); "" when unknown. */
  total: string;
  /** The applied coupon; null when none. */
  coupon: { id: string; code: string } | null;
  /** The buyer's note to the merchant; "" when none. */
  note: string;
  currency: string;
}
