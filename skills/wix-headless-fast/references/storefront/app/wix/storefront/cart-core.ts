// Cart rules and DTO mapping — transport-agnostic, imported by both ./cart.ts (SDK) and the REST
// twin in references/storefront/rest/cart.ts (fetch). Raw Cart V2 entities may carry `_id` (SDK)
// or `id` (REST). Has its own formatMoney (a copy of ../money.ts) so it stands alone when stripped.
import type { Cart, CartLine } from "./types";
import type { ImgSrc, Raw } from "./catalog-core";

/** Public app id of the Wix Stores catalog — required inside every catalogReference. */
export const WIX_STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/**
 * Cart V2 money is ConvertedMoney { amount, convertedAmount } with NO formatted string, and the
 * currency lives on the cart, not on the money. Format with the buyer's display currency when
 * present, else the site's. Never hardcode "$" or assume USD.
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

/**
 * "Monthly plan · every 2 months · 6 payments" from the line's subscriptionInfo (Cart V2 carries
 * the plan on the line); "" for a one-time purchase. Every word comes from the plan — a
 * subscription line must read as one in the cart, never a generic "recurring".
 */
export function subscriptionTerms(info: Raw | undefined): string {
  if (!info) return "";
  const s: Raw = info.subscriptionSettings ?? {};
  const unit: Record<string, string> = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };
  const parts: string[] = [];
  const title = info.title?.original ?? info.title?.translated ?? "";
  if (title) parts.push(title);
  const u = unit[String(s.frequency ?? "")];
  if (u) parts.push(`every ${s.interval && s.interval > 1 ? `${s.interval} ${u}s` : u}`);
  if (!s.autoRenewal && s.billingCycles) parts.push(`${s.billingCycles} payments`);
  return parts.join(" · ");
}

export function toLine(raw: Raw, currency: string, imgSrc: ImgSrc): CartLine {
  return {
    lineItemId: rawId(raw), // the LINE id — what update/remove take, never the product id
    productName: raw.name?.original ?? "",
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
    subscription: subscriptionTerms(raw.subscriptionInfo),
  };
}

export function toCart(raw: Raw | null, subtotal: string, discount: string, imgSrc: ImgSrc): Cart {
  const currency = cartCurrency(raw);
  const lines = ((raw?.lineItems ?? []) as Raw[]).map((l) => toLine(l, currency, imgSrc));
  return { lines, itemCount: lines.reduce((n, l) => n + l.quantity, 0), subtotal, discount, currency };
}

/** The after-discount subtotal and the CART-level discount from an estimate; "" when unknown. */
export function summaryTotals(estimate: Raw | null | undefined, raw: Raw): { subtotal: string; discount: string } {
  const s = estimate?.summary?.priceSummary;
  const currency = cartCurrency(raw);
  const d = s?.discount;
  return {
    subtotal: formatMoney(s?.subtotal, currency),
    discount: Number(d?.convertedAmount ?? d?.amount ?? 0) > 0 ? formatMoney(d, currency) : "",
  };
}

/** The catalogReference.options object for an add — omits every key the buyer didn't use. */
export function addOptions({ variantId, modifierChoices, customTextFields, subscriptionOptionId, preorder }: {
  variantId?: string | null; modifierChoices?: Record<string, string>; customTextFields?: Record<string, string>;
  subscriptionOptionId?: string; preorder?: boolean;
}): Raw {
  const o: Raw = {};
  if (variantId) o.variantId = variantId;                                            // REQUIRED for any product with options
  if (modifierChoices && Object.keys(modifierChoices).length) o.options = modifierChoices; // MODIFIERS only, never Size/Color
  if (customTextFields && Object.keys(customTextFields).length) o.customTextFields = customTextFields;
  if (subscriptionOptionId) o.subscriptionOptionId = subscriptionOptionId;
  if (preorder) o.preOrderRequested = true;
  return o;
}

/** Read the add result — a refused add still returns 200: a line whose status isn't IN_STOCK, or no line, is a refusal. */
export function assertAdded(cart: Raw | null | undefined, productId: string, variantId?: string | null): void {
  const line = ((cart?.lineItems ?? []) as Raw[]).find(
    (l) => l.source?.catalogReference?.catalogItemId === productId && (!variantId || l.source?.catalogReference?.options?.variantId === variantId),
  );
  if (line?.status && line.status !== "IN_STOCK") {
    throw new Error(`This item isn't available right now (${String(line.status).toLowerCase().replace(/_/g, " ")}).`);
  }
  if (!line || line.quantityInfo?.confirmedQuantity === 0) {
    throw new Error("The item couldn't be added. Make sure every required selection was made (options for a product with variants, and all mandatory customizations).");
  }
}

/** Refuse checkout for an empty cart or any line not IN_STOCK — say which. */
export function assertCheckoutable(raw: Raw | null): void {
  const lines: Raw[] = raw?.lineItems ?? [];
  if (!lines.length) throw new Error("Your cart is empty.");
  const unavailable = lines.filter((l) => l.status && l.status !== "IN_STOCK");
  if (unavailable.length) {
    throw new Error(`Some items are no longer available: ${unavailable.map((l) => l.name?.original).filter(Boolean).join(", ")}.`);
  }
  if (!rawId(raw)) throw new Error("Checkout couldn't start: the cart has no id.");
}
