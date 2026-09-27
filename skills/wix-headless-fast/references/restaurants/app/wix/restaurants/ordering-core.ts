// Online-ordering rules and DTO mapping — transport-agnostic, imported by both ./ordering.ts (SDK)
// and the REST twin in references/restaurants/rest/ordering.ts (fetch). The restaurant cart rides
// on the eCom current cart (Cart V2); what makes a line a RESTAURANT line is the catalogReference
// built here: the Orders app id plus options { operationId, menuId, sectionId } — all three, and
// no variantId. Raw entities carry `_id` (SDK) or `id` (REST). Has its own formatMoney (a copy of
// ../money.ts) so it stands alone when stripped. Imports are type-only.
import type { FulfillmentMethodInfo, OrderCart, OrderLine } from "./types";
import type { ImgSrc, Raw } from "./menu-core";

/** The Restaurants Orders app id — every restaurant cart line's catalogReference.appId. */
export const RESTAURANTS_ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/**
 * Cart V2 money is ConvertedMoney { amount, convertedAmount } with NO formatted string, and the
 * currency lives on the cart, not on the money. Never hardcode a symbol or assume USD.
 */
export function formatMoney(money: Raw | null | undefined, currencyCode: string | null | undefined): string {
  const value = money?.convertedAmount ?? money?.amount;
  if (value == null || value === "") return "";
  const currency = currencyCode || "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

export const cartCurrency = (raw: Raw | null | undefined): string =>
  raw?.customerInfo?.currencyCode ?? raw?.businessInfo?.currencyCode ?? "";

/** The operation to order through: ENABLED, else the default, else the first; null when none exists. */
export function pickOperationId(operations: Raw[]): string | null {
  const op = operations.find((o) => o.onlineOrderingStatus === "ENABLED") ?? operations.find((o) => o.default) ?? operations[0];
  return op ? rawId(op) || null : null;
}

/** Enabled pickup/delivery methods, for display — fees and minimums as decimal strings. */
export function toFulfillmentMethods(raws: Raw[]): FulfillmentMethodInfo[] {
  return raws
    .filter((m) => m.enabled === true)
    .map((m): FulfillmentMethodInfo => ({
      id: rawId(m),
      type: m.type === "DELIVERY" ? "DELIVERY" : "PICKUP",
      name: m.name ?? "",
      fee: m.fee ?? "0",
      minOrderPrice: m.minOrderPrice ?? "0",
    }))
    .filter((m) => m.id);
}

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

/**
 * The one catalogItems entry of an add: the Orders app id and the three context ids — the
 * restaurant analog of the store's variantId. Modifier/variant selections are NOT sent (that
 * options shape isn't documented for a client add); quantity only.
 */
export function orderCatalogItem(itemId: string, ctx: { operationId: string; menuId: string; sectionId: string }, quantity: number): Raw {
  return {
    quantity,
    catalogReference: {
      catalogItemId: itemId,
      appId: RESTAURANTS_ORDERS_APP_ID,
      options: { operationId: ctx.operationId, menuId: ctx.menuId, sectionId: ctx.sectionId },
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
