// Restaurants DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs. MENU prices come from the Menus API as decimal strings in the site
// currency with NO symbol ("12.50") — the DTO carries the platform's formatted string when
// the response includes one, else the plain decimal (prefix your brand's currency in the UI).
// Order-cart prices (eCom) ARE fully formatted strings.

/** A dietary/style label on a menu item (e.g. "Vegan", "Spicy"). */
export interface MenuItemLabel {
  id: string;
  name: string;
  /** Resolved https URL ("" when the label has no icon). */
  iconUrl: string;
}

/** One price variant of an item ("Glass" / "Bottle"). An item has price OR variants. */
export interface MenuItemVariant {
  variantId: string;
  name: string;
  /** Display price — formatted when the API provides it, else the decimal amount. */
  price: string;
}

/** One choice inside a modifier group ("Extra cheese"). */
export interface MenuModifier {
  id: string;
  name: string;
  preSelected: boolean;
  /** Decimal up-charge amount ("0" = free), site currency, no symbol. */
  additionalCharge: string;
  inStock: boolean;
}

/** A modifier group on an item ("Toppings", choose 0–3). DISPLAY-ONLY: modifier
 * selections are not sent on the cart line (the API doesn't document that shape). */
export interface MenuModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number | null;
  modifiers: MenuModifier[];
}

/** A dish/drink as the menu page needs it. */
export interface MenuItem {
  id: string;
  name: string;
  description: string;
  /** Display price; null when the item is variant-priced or market-priced. */
  price: string | null;
  /** True → show "Market price"; the item can't be ordered online. */
  marketPrice: boolean;
  /** Non-empty exactly when price is null and not marketPrice. */
  variants: MenuItemVariant[];
  /** Resolved https URL ("" when the item has no image). */
  imageUrl: string;
  labels: MenuItemLabel[];
  modifierGroups: MenuModifierGroup[];
  /** False → render "Sold out" and disable add-to-order. */
  inStock: boolean;
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
}

/** A pickup/delivery method to display (the buyer picks one on the hosted checkout). */
export interface FulfillmentMethodInfo {
  id: string;
  type: "PICKUP" | "DELIVERY";
  name: string;
  /** Decimal amounts, site currency, no symbol ("0", "5"). */
  fee: string;
  minOrderPrice: string;
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
  /** Human-readable selection labels the platform attached (may be empty). */
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

/** A reservation location as the booking form needs it. */
export interface ReservationLocationInfo {
  id: string;
  default: boolean;
  /** Bound the party-size input to [partySizeMin, partySizeMax]. */
  partySizeMin: number;
  partySizeMax: number;
  /** "AUTOMATIC" confirms instantly; "MANUAL"/"MANUAL_FOR_LARGE_PARTIES" may end REQUESTED. */
  approvalMode: "AUTOMATIC" | "MANUAL" | "MANUAL_FOR_LARGE_PARTIES";
  /** False (premium-gated toggle off) → slots/booking won't work; show an honest notice. */
  onlineReservationsEnabled: boolean;
}

/** One AVAILABLE reservation time slot. */
export interface ReservationSlot {
  /** ISO datetime — pass to holdSlot as-is. */
  startIso: string;
  /** Display label, e.g. "7:00 PM". */
  label: string;
  /** "YYYY-MM-DD" in the visitor's timezone — for grouping/labeling. */
  dayKey: string;
  durationMinutes: number;
  /** This slot needs staff approval → the reservation will end REQUESTED, not RESERVED. */
  manualApproval: boolean;
}

/** A 10-minute hold on a slot; completeReservation needs BOTH ids. */
export interface ReservationHold {
  reservationId: string;
  revision: string;
  startIso: string;
  partySize: number;
}

/** The visitor's details. firstName + phone (E.164, e.g. "+15551234567") are REQUIRED. */
export interface ReservationReservee {
  firstName: string;
  phone: string;
  lastName?: string;
  email?: string;
}

/** The outcome of completing a reservation. */
export interface ReservationConfirmation {
  reservationId: string;
  /** RESERVED = confirmed; REQUESTED = pending the restaurant's approval — tell the visitor. */
  status: "RESERVED" | "REQUESTED";
}
