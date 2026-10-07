// Restaurants DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs. EVERY money value is a formatted string in the site's currency and
// locale (read once from the eCommerce settings' BUSINESS_INFO, the way Wix's own menus code
// does) — "" when the currency could not be read; the raw decimal rides beside it in the
// `*Amount` fields for arithmetic. Order-cart prices (eCom) are formatted from the cart's currency.

/** The site's currency + locale, from the eCommerce settings. `currency` "" when unknown. */
export interface SiteMoney {
  /** ISO 4217, e.g. "USD"; "" when the settings could not be read (prices then format to ""). */
  currency: string;
  /** BCP 47, e.g. "en-US"; "" → the runtime's default locale. */
  locale: string;
}

/** A dietary/style label on a menu item (e.g. "Vegan", "Spicy"). */
export interface MenuItemLabel {
  id: string;
  name: string;
  /** Resolved https URL ("" when the label has no icon). */
  iconUrl: string;
}

/** One price variant of an item ("Small" / "Large"). An item has price OR variants. */
export interface MenuItemVariant {
  variantId: string;
  name: string;
  /** Formatted price ("" when the currency is unknown). */
  price: string;
  /** Decimal amount, site currency, no symbol ("9.50"). */
  priceAmount: string;
}

/** One choice inside a modifier group ("Extra cheese"). */
export interface MenuModifier {
  /** The modifier entity id — what the cart line carries. The same id may appear twice in one group. */
  id: string;
  /** Unique within the group: `${id}~${index}` — the selection key (duplicate ids stay distinct). */
  key: string;
  name: string;
  preSelected: boolean;
  /** Formatted up-charge ("" when free or the currency is unknown). */
  additionalCharge: string;
  /** Decimal up-charge amount ("0" = free), site currency, no symbol. */
  additionalChargeAmount: string;
  inStock: boolean;
}

/**
 * The shape of a group's rule, derived from required/min/max the way Wix's ordering code does:
 * NO_LIMIT (optional, any count) · CHOOSE_ONE (exactly or up to one) · CHOOSE_X (required, min = max)
 * · AT_LEAST_ONE · AT_LEAST_X · UP_TO_X (optional, max > 1) · BETWEEN_X_AND_Y (required, min < max).
 */
export type ModifierRuleType =
  | "NO_LIMIT"
  | "CHOOSE_ONE"
  | "CHOOSE_X"
  | "CHOOSE_AT_LEAST_ONE"
  | "CHOOSE_AT_LEAST_X"
  | "CHOOSE_UP_TO_X"
  | "CHOOSE_BETWEEN_X_AND_Y";

/** A modifier group on an item ("Toppings", choose 0–3). Selections are sent on the cart line. */
export interface MenuModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number | null;
  rule: ModifierRuleType;
  /** required && min 1 && max 1 → render radios (one selection replaces the other); else checkboxes. */
  singleSelect: boolean;
  modifiers: MenuModifier[];
}

/** A dish/drink as the menu page needs it. */
export interface MenuItem {
  id: string;
  name: string;
  description: string;
  /** Formatted price; null when the item is variant-priced or market-priced. */
  price: string | null;
  /** Decimal base price ("12.50"); null when variant-priced or market-priced. */
  priceAmount: string | null;
  /** True → show "Market price"; the item can't be ordered online (an ours-only display rule: owners use "no price" for market price). */
  marketPrice: boolean;
  /** Non-empty exactly when price is null and not marketPrice. The cheapest is the default selection. */
  variants: MenuItemVariant[];
  /** Resolved https URL ("" when the item has no image). */
  imageUrl: string;
  /** The main image followed by the additional images, resolved (may be empty). */
  gallery: string[];
  labels: MenuItemLabel[];
  modifierGroups: MenuModifierGroup[];
  /** The item's own stock flag (orderSettings.inStock). */
  inStock: boolean;
  /** !inStock, OR a required group can't be satisfied from in-stock modifiers → render "Sold out". */
  soldOut: boolean;
  /** Can be added online: not market-priced and not sold out. Menu- and operation-level gates are on the order cart. */
  orderable: boolean;
  /** The kitchen accepts a free-text note on this item (orderSettings.acceptSpecialRequests). */
  acceptsSpecialRequests: boolean;
  featured: boolean;
}

/** A section of a menu ("Appetizers"), items already in display order. */
export interface MenuSection {
  id: string;
  name: string;
  description: string;
  /** Resolved https URL ("" when none). */
  imageUrl: string;
  items: MenuItem[];
}

/** A whole menu ("Dinner"), sections already in display order. */
export interface MenuData {
  id: string;
  name: string;
  description: string;
  /** URL fragment (urlQueryParam), e.g. "dinner". */
  slug: string;
  sections: MenuSection[];
  /** The currency + locale every price on this menu was formatted with — for live price math (`itemPrice`). */
  money: SiteMoney;
}

/**
 * What a visitor chose on a dish before adding it: the variant (variant-priced items only), the
 * modifier KEYS per group (MenuModifier.key — never the id), and the special request.
 * Start from `initialSelection(item)`; change with `toggleModifier`; check with `validateSelection`.
 */
export interface OrderSelection {
  variantId: string | null;
  /** groupId → selected MenuModifier.key list. */
  modifiers: Record<string, string[]>;
  specialRequest: string;
}

/** The result of validating a selection: one message per group that fails its rule. */
export interface SelectionValidation {
  ok: boolean;
  /** groupId → message ("Choose at least 2", …). */
  errors: Record<string, string>;
}

/** The live price of a selection: amount and the formatted string. */
export interface SelectionPrice {
  amount: number;
  formatted: string;
}

/** The online-ordering operation's state, resolved once per session. */
export interface OrderingStatus {
  /** The operation to order through; null when the site has none. */
  operationId: string | null;
  /** ENABLED accepts orders. DISABLED and PAUSED_UNTIL refuse them; NONE = no operation. */
  status: "ENABLED" | "DISABLED" | "PAUSED_UNTIL" | "NONE";
  /** When status is PAUSED_UNTIL: the moment ordering resumes (ISO). */
  pausedUntilIso: string | null;
  /** The operation's location timezone (for rendering pausedUntilIso), "" when unknown. */
  timeZone: string;
  /** The fulfillment methods this operation offers (ids) — fetchFulfillmentMethods is limited to them. */
  fulfillmentIds: string[];
  defaultFulfillmentType: "PICKUP" | "DELIVERY" | null;
}

/** One weekly availability window, wall-clock in the setting's timezone. */
export interface WeeklyWindow {
  day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  /** "HH:mm" (24h). An end before the start wraps past midnight. */
  start: string;
  end: string;
}

/**
 * A menu's ordering settings under the resolved operation (one entry per menu). A menu with no
 * entry, or `enabled: false`, or outside its availability, isn't orderable — show no add control.
 */
export interface MenuOrderingInfo {
  menuId: string;
  enabled: boolean;
  availability: {
    /** ALWAYS_AVAILABLE · WEEKLY_SCHEDULE (see `weekly`) · TIMESTAMP_RANGES (see `ranges`). */
    type: "ALWAYS_AVAILABLE" | "WEEKLY_SCHEDULE" | "TIMESTAMP_RANGES" | "UNSPECIFIED";
    /** IANA zone the windows are expressed in ("" → the visitor's). */
    timeZone: string;
    weekly: WeeklyWindow[];
    ranges: { startIso: string; endIso: string }[];
  };
}

/** A pickup/delivery method the operation offers (the buyer picks one on the hosted checkout). */
export interface FulfillmentMethodInfo {
  id: string;
  type: "PICKUP" | "DELIVERY";
  name: string;
  /** Formatted fee ("" when free or the currency is unknown). */
  fee: string;
  feeAmount: string;
  /** Formatted minimum order ("" when none). */
  minOrderPrice: string;
  minOrderPriceAmount: string;
}

export interface OrderLine {
  /** The cart line id — what update/remove take (NOT the menu item id). */
  lineItemId: string;
  itemName: string;
  quantity: number;
  /** Per-unit price, formatted. */
  unitPrice: string;
  /** Line total, formatted. */
  linePrice: string;
  /** Resolved https URL ("" when none). */
  imageUrl: string;
  /** Human-readable selection labels the platform attached (variant, modifiers, special request). */
  descriptionLines: string[];
  /** Not IN_STOCK → the line can't be checked out as-is. */
  status: string;
}

export interface OrderCart {
  lines: OrderLine[];
  /** Sum of line quantities. */
  itemCount: number;
  /** Formatted subtotal (after discounts) — from the cart estimate, not hand-summed. */
  subtotal: string;
  currency: string;
}

/** A custom question the owner added to the reservation form. */
export interface ReservationCustomField {
  id: string;
  name: string;
  required: boolean;
}

/** A policy link or text the form must show ({ url } or { text }). */
export interface ReservationPolicy {
  url: string;
  text: string;
}

/** The owner's reservation form configuration — render the form from it, validate against it. */
export interface ReservationFormConfig {
  /** firstName and phone are ALWAYS required; these two are per configuration. */
  lastNameRequired: boolean;
  emailRequired: boolean;
  /** An email-marketing consent checkbox; null when the owner disabled it. */
  marketingCheckbox: { checkedByDefault: boolean } | null;
  customFields: ReservationCustomField[];
  /** Terms and conditions to show when enabled; null otherwise. */
  terms: ReservationPolicy | null;
  /** Privacy policy to show when enabled; null otherwise. */
  privacy: ReservationPolicy | null;
  /** The owner's post-submit message ("" when none). */
  submitMessage: string;
}

/** A reservation location as the booking form needs it. */
export interface ReservationLocationInfo {
  id: string;
  name: string;
  /** Formatted address ("" when none). */
  address: string;
  /** IANA zone — slot search and labels are computed in it, never in the visitor's. */
  timeZone: string;
  default: boolean;
  /** Bound the party-size input to [partySizeMin, partySizeMax]. */
  partySizeMin: number;
  partySizeMax: number;
  /** "AUTOMATIC" confirms instantly; "MANUAL" always asks the restaurant; "MANUAL_FOR_LARGE_PARTIES" from the threshold up. */
  approvalMode: "AUTOMATIC" | "MANUAL" | "MANUAL_FOR_LARGE_PARTIES";
  /** Parties of this size and up need approval (MANUAL_FOR_LARGE_PARTIES); null otherwise. */
  manualApprovalPartySizeThreshold: number | null;
  /** False (premium-gated toggle off) → slots/booking won't work; show an honest notice. */
  onlineReservationsEnabled: boolean;
  form: ReservationFormConfig;
}

/** One reservation time slot. */
export interface ReservationSlot {
  /** ISO datetime — pass to holdSlot as-is. */
  startIso: string;
  /** Display label in the location's timezone, e.g. "7:00 PM". */
  label: string;
  /** "YYYY-MM-DD" in the location's timezone — for grouping/labeling. */
  dayKey: string;
  durationMinutes: number;
  /** This slot needs staff approval → the reservation is requested (no hold), ending REQUESTED. */
  manualApproval: boolean;
}

/** A 10-minute hold on a slot; completeReservation needs BOTH ids. */
export interface ReservationHold {
  reservationId: string;
  revision: string;
  startIso: string;
  partySize: number;
  /** When the hold lapses (created + 10 minutes) — drive a countdown from it. */
  expiresAtIso: string;
}

/** The visitor's details. firstName + phone are ALWAYS required; the rest per ReservationFormConfig. */
export interface ReservationReservee {
  firstName: string;
  phone: string;
  lastName?: string;
  email?: string;
  /** The marketing checkbox's value; only when the form shows one. */
  marketingConsent?: boolean;
  /** custom field id → the visitor's answer. */
  customFields?: Record<string, string>;
}

/** Every status the Reservations API can return. */
export type ReservationStatus =
  | "HELD"
  | "RESERVED"
  | "REQUESTED"
  | "PAYMENT_INFORMATION_PENDING"
  | "CANCELED"
  | "DECLINED"
  | "FINISHED"
  | "NO_SHOW"
  | "SEATED"
  | "UNKNOWN";

/** The outcome of completing or requesting a reservation. */
export interface ReservationConfirmation {
  reservationId: string;
  /** The API's status, unmapped. */
  status: ReservationStatus;
  /** confirmed = RESERVED; pending = REQUESTED or PAYMENT_INFORMATION_PENDING; anything else = other. */
  outcome: "confirmed" | "pending" | "other";
}
