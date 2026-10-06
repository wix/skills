// Online-ordering rules and DTO mapping — transport-agnostic, imported by both ./ordering.ts (SDK)
// and the REST twin in templates/restaurants/rest/ordering.ts (fetch). The restaurant cart rides
// on the eCom current cart (Cart V2); what makes a line a RESTAURANT line is the catalogReference
// built here: the Orders app id plus options { operationId, menuId, sectionId } and, exactly as
// Wix's own ordering code sends them, the visitor's choices: options.priceVariant { id,
// formattedPrice }, options.modifierGroups [{ id, modifiers: [{ id, price, formattedPrice }] }],
// options.specialRequests. Raw entities carry `_id` (SDK) or `id` (REST). Has its own formatMoney
// (a copy of ../money.ts) so it stands alone when stripped. Imports are type-only except the zone
// helpers from ./time-core (deployed beside this file).
import type { FulfillmentMethodInfo, MenuItem, MenuOrderingInfo, OrderCart, OrderLine, OrderSelection, OrderingStatus, SiteMoney, WeeklyWindow } from "./types";
import type { ImgSrc, Raw } from "./menu-core";
import { zonedMinutes, zonedParts } from "./time-core";

/** The Restaurants Orders app id — every restaurant cart line's catalogReference.appId. */
export const RESTAURANTS_ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/**
 * Cart V2 money is ConvertedMoney { amount, convertedAmount } with NO formatted string, and the
 * currency lives on the cart, not on the money. "" when the currency is unknown — never a guessed
 * symbol, never a USD default.
 */
export function formatMoney(money: Raw | null | undefined, currencyCode: string | null | undefined): string {
  const value = money?.convertedAmount ?? money?.amount;
  if (value == null || value === "" || !currencyCode) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(Number(value));
  } catch {
    return `${value} ${currencyCode}`;
  }
}

/** A site-currency decimal ("5", "0") formatted for display; "" when zero or the currency is unknown. */
function formatAmount(amount: string | null | undefined, money: SiteMoney): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n) || n <= 0 || !money.currency) return "";
  try {
    return new Intl.NumberFormat(money.locale || undefined, { style: "currency", currency: money.currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${money.currency}`;
  }
}

export const cartCurrency = (raw: Raw | null | undefined): string =>
  raw?.customerInfo?.currencyCode ?? raw?.businessInfo?.currencyCode ?? "";

// ---- operation ----------------------------------------------------------------------------------------------

const NO_ORDERING: OrderingStatus = { operationId: null, status: "NONE", pausedUntilIso: null, timeZone: "", fulfillmentIds: [], defaultFulfillmentType: null };

const isoOf = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * The operation to order through and its state: an ENABLED one, else the default, else the first.
 * Only ENABLED accepts orders (Wix: AcceptingOrders = operation.enabled && a fulfillment); DISABLED
 * and PAUSED_UNTIL (with `pausedUntilOptions.time`) refuse every add — surface the reason.
 */
export function resolveOperation(operations: Raw[]): OrderingStatus {
  const op = operations.find((o) => o.onlineOrderingStatus === "ENABLED") ?? operations.find((o) => o.default) ?? operations[0];
  if (!op || !rawId(op)) return NO_ORDERING;
  const raw = String(op.onlineOrderingStatus ?? "");
  const status: OrderingStatus["status"] = raw === "ENABLED" ? "ENABLED" : raw === "PAUSED_UNTIL" ? "PAUSED_UNTIL" : "DISABLED";
  return {
    operationId: rawId(op),
    status,
    pausedUntilIso: status === "PAUSED_UNTIL" ? isoOf(op.pausedUntilOptions?.time) : null,
    timeZone: op.businessLocationDetails?.timeZone ?? "",
    fulfillmentIds: ((op.fulfillmentIds ?? []) as string[]).filter(Boolean),
    defaultFulfillmentType: op.defaultFulfillmentType === "DELIVERY" ? "DELIVERY" : op.defaultFulfillmentType === "PICKUP" ? "PICKUP" : null,
  };
}

/** Kept for callers that only need the id — null when the site has no operation at all. */
export function pickOperationId(operations: Raw[]): string | null {
  return resolveOperation(operations).operationId;
}

// ---- menu ordering settings (per operation) ---------------------------------------------------------

const DAYS: WeeklyWindow["day"][] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const hhmm = (t: Raw | undefined): string => `${String(t?.hours ?? 0).padStart(2, "0")}:${String(t?.minutes ?? 0).padStart(2, "0")}`;

/** One menu's ordering settings entry → the DTO (availability windows normalised to "HH:mm" / ISO). */
export function toMenuOrdering(raw: Raw): MenuOrderingInfo {
  const a: Raw = raw.availability ?? {};
  const type = String(a.type ?? "");
  return {
    menuId: raw.menuId ?? "",
    enabled: raw.onlineOrderingEnabled !== false,
    availability: {
      type: type === "ALWAYS_AVAILABLE" || type === "WEEKLY_SCHEDULE" || type === "TIMESTAMP_RANGES" ? type : "UNSPECIFIED",
      timeZone: a.timeZone ?? "",
      weekly: ((a.weeklyScheduleOptions?.availableTimes ?? []) as Raw[]).flatMap((d) =>
        ((d.timeRanges ?? []) as Raw[]).map((r): WeeklyWindow => ({ day: String(d.dayOfWeek) as WeeklyWindow["day"], start: hhmm(r.startTime), end: hhmm(r.endTime) })),
      ),
      ranges: ((a.timestampRangesOptions?.ranges ?? []) as Raw[])
        .map((r) => ({ startIso: isoOf(r.startTime) ?? "", endIso: isoOf(r.endTime) ?? "" }))
        .filter((r) => r.startIso && r.endIso),
    },
  };
}

/** The operation's menu settings keyed by menuId. */
export function toMenuOrderingMap(raws: Raw[]): Record<string, MenuOrderingInfo> {
  const out: Record<string, MenuOrderingInfo> = {};
  for (const raw of raws) {
    const info = toMenuOrdering(raw);
    if (info.menuId) out[info.menuId] = info;
  }
  return out;
}

const toMinutes = (s: string): number => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Whether the menu's availability window contains `now`, evaluated in the setting's own timezone. */
export function isMenuAvailable(info: MenuOrderingInfo, now: Date = new Date()): boolean {
  const { availability: a } = info;
  if (a.type === "TIMESTAMP_RANGES") {
    const t = now.getTime();
    return a.ranges.some((r) => new Date(r.startIso).getTime() <= t && t < new Date(r.endIso).getTime());
  }
  if (a.type !== "WEEKLY_SCHEDULE") return true; // ALWAYS_AVAILABLE, or an unspecified type: don't block on it
  const parts = zonedParts(now, a.timeZone);
  const minutes = zonedMinutes(now, a.timeZone);
  const today = DAYS[parts.weekday];
  const yesterday = DAYS[(parts.weekday + 6) % 7];
  return a.weekly.some((w) => {
    const start = toMinutes(w.start), end = toMinutes(w.end);
    if (w.day === today) return end > start ? start <= minutes && minutes < end : minutes >= start || minutes < end;
    // a window that wraps past midnight also covers the early hours of the next day
    return w.day === yesterday && end <= start && minutes < end;
  });
}

/**
 * Can dishes of `menuId` be added right now? true/false once the operation's menu settings are
 * known; null while they are still loading or could not be read (the add itself is still refused
 * server-side, with a message). A menu with no entry under the operation is not orderable.
 */
export function menuOrderable(map: Record<string, MenuOrderingInfo> | null, menuId: string, now: Date = new Date()): boolean | null {
  if (!map) return null;
  const info = map[menuId];
  return !!info && info.enabled && isMenuAvailable(info, now);
}

// ---- fulfillment methods ----------------------------------------------------------------------------------

/** The operation's enabled pickup/delivery methods (operation.fulfillmentIds, `enabled`), money formatted. */
export function toFulfillmentMethods(raws: Raw[], fulfillmentIds: string[], money: SiteMoney): FulfillmentMethodInfo[] {
  const wanted = new Set(fulfillmentIds);
  return raws
    .filter((m) => m.enabled === true && wanted.has(rawId(m)))
    .map((m): FulfillmentMethodInfo => ({
      id: rawId(m),
      type: m.type === "DELIVERY" ? "DELIVERY" : "PICKUP",
      name: m.name ?? "",
      fee: formatAmount(m.fee, money),
      feeAmount: m.fee ?? "0",
      minOrderPrice: formatAmount(m.minOrderPrice, money),
      minOrderPriceAmount: m.minOrderPrice ?? "0",
    }));
}

// ---- cart --------------------------------------------------------------------------------------------------------

export function toOrderLine(raw: Raw, currency: string, imgSrc: ImgSrc): OrderLine {
  return {
    lineItemId: rawId(raw), // the LINE id — what update/remove take, never the menu item id
    itemName: raw.name?.original ?? "",
    quantity: raw.quantityInfo?.confirmedQuantity ?? 0,
    unitPrice: formatMoney(raw.pricing?.unitPrice, currency),
    linePrice: formatMoney(raw.pricing?.totalPrice, currency),
    imageUrl: imgSrc(raw.attributes?.image, 300, 300),
    descriptionLines: ((raw.attributes?.descriptionLines ?? []) as Raw[])
      .map((d) => {
        const label = d.name?.original ?? "", value = d.plainText?.original ?? d.colorInfo?.original ?? "";
        return label && value ? `${label}: ${value}` : value || label;
      })
      .filter(Boolean),
    status: raw.status ?? "IN_STOCK", // not IN_STOCK → the line can't be checked out as-is
  };
}

export function toOrderCart(raw: Raw | null, subtotal: string, imgSrc: ImgSrc): OrderCart {
  const currency = cartCurrency(raw);
  const lines = ((raw?.lineItems ?? []) as Raw[]).map((l) => toOrderLine(l, currency, imgSrc));
  return { lines, itemCount: lines.reduce((n, l) => n + l.quantity, 0), subtotal, currency };
}

/** The after-discount subtotal from a cart estimate; "" when unknown. Fees, tax, delivery resolve at checkout. */
export function estimateSubtotal(estimate: Raw | null | undefined, raw: Raw): string {
  return formatMoney(estimate?.summary?.priceSummary?.subtotal, cartCurrency(raw));
}

/** The line-refusal reasons an add can't recover from — checked before any call. */
export function assertOrderContext(itemId: string, menuId: string, sectionId: string): void {
  if (!itemId || !menuId || !sectionId) throw new Error("addToOrder needs the item, menu, and section ids.");
}

/** Reject a dish that can't be ordered before any call is made — the message is what the visitor reads. */
export function assertOrderable(item: Pick<MenuItem, "marketPrice" | "soldOut" | "name">): void {
  if (item.marketPrice) throw new Error(`${item.name || "This dish"} is priced at the counter and can't be ordered online.`);
  if (item.soldOut) throw new Error(`${item.name || "This dish"} is sold out.`);
}

/**
 * The one catalogItems entry of an add — the Orders app id, the three context ids, and the
 * visitor's choices in the exact option keys Wix's ordering sends: `priceVariant` (id + its
 * formatted price), `modifierGroups` (the entity ids — a selection KEY resolves back to its id —
 * each with `price` as the decimal up-charge and `formattedPrice` only when charged), and
 * `specialRequests` when the item accepts one. Formatted strings are the DTO's (site currency).
 */
export function orderCatalogItem(
  item: MenuItem,
  ctx: { operationId: string; menuId: string; sectionId: string },
  quantity: number,
  selection: OrderSelection,
): Raw {
  const variant = item.variants.find((v) => v.variantId === selection.variantId);
  const modifierGroups = item.modifierGroups
    .map((g) => ({
      id: g.id,
      modifiers: (selection.modifiers[g.id] ?? [])
        .map((key) => g.modifiers.find((m) => m.key === key))
        .filter((m): m is MenuItem["modifierGroups"][number]["modifiers"][number] => !!m)
        .map((m) => ({ id: m.id, price: m.additionalChargeAmount, ...(Number(m.additionalChargeAmount) > 0 && m.additionalCharge ? { formattedPrice: m.additionalCharge } : {}) })),
    }))
    .filter((g) => g.modifiers.length > 0);
  const note = item.acceptsSpecialRequests ? selection.specialRequest.trim() : "";
  return {
    quantity,
    catalogReference: {
      catalogItemId: item.id,
      appId: RESTAURANTS_ORDERS_APP_ID,
      options: {
        operationId: ctx.operationId,
        menuId: ctx.menuId,
        sectionId: ctx.sectionId,
        ...(variant ? { priceVariant: { id: variant.variantId, formattedPrice: variant.price } } : {}),
        ...(modifierGroups.length ? { modifierGroups } : {}),
        ...(note ? { specialRequests: note } : {}),
      },
    },
  };
}

/** Read the add result — a refused add still returns 200: a line whose status isn't IN_STOCK, or no line, is a refusal. */
export function assertOrderAdded(cart: Raw | null | undefined, itemId: string): void {
  // V2 nests the reference under `source` — a top-level lineItem.catalogReference no longer exists.
  const line = ((cart?.lineItems ?? []) as Raw[]).find((l) => l.source?.catalogReference?.catalogItemId === itemId);
  if (line?.status && line.status !== "IN_STOCK") {
    throw new Error(`This dish isn't available right now (${String(line.status).toLowerCase().replace(/_/g, " ")}).`);
  }
  if (!line || line.quantityInfo?.confirmedQuantity === 0) {
    throw new Error("The dish couldn't be added to the order — please try again.");
  }
}

/** Refuse checkout for an empty order or any line not IN_STOCK — say which. */
export function assertOrderCheckoutable(raw: Raw | null): void {
  const lines: Raw[] = raw?.lineItems ?? [];
  if (!lines.length) throw new Error("Your order is empty.");
  const unavailable = lines.filter((l) => l.status && l.status !== "IN_STOCK");
  if (unavailable.length) {
    throw new Error(`Some dishes are no longer available: ${unavailable.map((l) => l.name?.original).filter(Boolean).join(", ")}.`);
  }
  if (!rawId(raw)) throw new Error("Checkout couldn't start: the order has no id.");
}

/** The message an add control shows when the operation refuses orders; "" when it accepts them. */
export function orderingUnavailableReason(status: OrderingStatus | null): string {
  if (!status) return "";
  switch (status.status) {
    case "ENABLED": return "";
    case "PAUSED_UNTIL": return "Ordering is paused right now";
    case "DISABLED": return "Ordering unavailable";
    default: return "Ordering unavailable";
  }
}
