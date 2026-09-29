// Cart rules and DTO mapping — transport-agnostic, imported by both ./cart.ts (SDK) and the REST
// twin in templates/storefront/rest/cart.ts (fetch). Raw Cart V2 entities may carry `_id` (SDK)
// or `id` (REST). Has its own formatMoney (a copy of ../money.ts) so it stands alone when stripped.
import type { Cart, CartAmount, CartLine } from "./types";
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

const amountOf = (money: Raw | null | undefined): number => {
  const n = Number(money?.convertedAmount ?? money?.amount);
  return Number.isFinite(n) ? n : 0;
};

export const cartCurrency = (raw: Raw | null | undefined): string =>
  raw?.customerInfo?.currencyCode ?? raw?.businessInfo?.currencyCode ?? "";

/** A TranslatableString / DescriptionLineName in the buyer's language, else the merchant's. */
const translated = (t: Raw | string | null | undefined): string =>
  typeof t === "string" ? t : t?.translated ?? t?.original ?? "";

/**
 * "Monthly plan · every 2 months · 6 payments" from the line's `attributes.subscriptionInfo`
 * (where Cart V2 carries the plan); "" for a one-time purchase. Every word comes from the plan —
 * a subscription line must read as one in the cart, never a generic "recurring".
 */
export function subscriptionTerms(info: Raw | undefined): string {
  if (!info) return "";
  const s: Raw = info.subscriptionSettings ?? {};
  const unit: Record<string, string> = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };
  const parts: string[] = [];
  const title = translated(info.title);
  if (title) parts.push(title);
  const u = unit[String(s.frequency ?? "")];
  if (u) parts.push(`every ${s.interval && s.interval > 1 ? `${s.interval} ${u}s` : u}`);
  if (!s.autoRenewal && s.billingCycles) parts.push(`${s.billingCycles} payments`);
  return parts.join(" · ");
}

/**
 * The catalog price to strike on a discounted line: the sale price when the buyer pays less than
 * it, else the full price when the buyer pays less than that (an automatic discount or a coupon
 * on a sale item), × quantity. null when the line isn't discounted.
 */
export function compareAtLinePrice(pricing: Raw | undefined, quantity: number, currency: string): string | null {
  const unit = amountOf(pricing?.unitPrice);
  const b: Raw = pricing?.breakdown ?? {};
  const candidate = [b.salePrice, b.fullPrice].find((m) => m && amountOf(m) > unit);
  if (!candidate || quantity < 1) return null;
  return formatMoney({ amount: String(amountOf(candidate) * quantity) }, currency);
}

export function toLine(raw: Raw, currency: string, imgSrc: ImgSrc): CartLine {
  const quantity: number = raw.quantityInfo?.confirmedQuantity ?? 0;
  const url = raw.attributes?.url;
  return {
    lineItemId: rawId(raw), // the LINE id — what update/remove take, never the product id
    productName: translated(raw.name),
    quantity,
    unitPrice: formatMoney(raw.pricing?.unitPrice, currency),
    linePrice: formatMoney(raw.pricing?.totalPrice, currency),
    compareAtLinePrice: compareAtLinePrice(raw.pricing, quantity, currency),
    availableQuantity: typeof raw.quantityInfo?.availableQuantity === "number" ? raw.quantityInfo.availableQuantity : null,
    imageUrl: imgSrc(raw.attributes?.image, 300, 300),
    productUrl: typeof url === "string" ? url : url?.url ?? "",
    descriptionLines: ((raw.attributes?.descriptionLines ?? []) as Raw[])
      .map((d) => {
        const label = translated(d.name), value = translated(d.plainText) || translated(d.colorInfo);
        return label && value ? `${label}: ${value}` : value || label;
      })
      .filter(Boolean),
    status: raw.status ?? "IN_STOCK", // not IN_STOCK → the line can't be checked out as-is
    subscription: subscriptionTerms(raw.attributes?.subscriptionInfo),
  };
}

/** The estimate's totals, formatted; every field "" / [] until an estimate ran. */
export interface CartTotals {
  subtotal: string;
  discount: string;
  discounts: (CartAmount & { scope: "cart" | "item" | "delivery" })[];
  fees: CartAmount[];
  taxes: CartAmount[];
  pricesIncludeTax: boolean;
  total: string;
}

export const EMPTY_TOTALS: CartTotals = { subtotal: "", discount: "", discounts: [], fees: [], taxes: [], pricesIncludeTax: false, total: "" };

export function toCart(raw: Raw | null, totals: CartTotals, imgSrc: ImgSrc): Cart {
  const currency = cartCurrency(raw);
  const lines = ((raw?.lineItems ?? []) as Raw[]).map((l) => toLine(l, currency, imgSrc));
  const coupon: Raw | undefined = (raw?.coupons ?? [])[0];
  return {
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: totals.subtotal,
    discount: totals.discount,
    // item-level discounts already live inside the line prices (the struck compareAtLinePrice)
    discounts: totals.discounts.filter((d) => d.scope !== "item").map(({ name, amount }) => ({ name, amount })),
    fees: totals.fees,
    taxes: totals.taxes,
    pricesIncludeTax: totals.pricesIncludeTax || raw?.taxInfo?.pricesIncludeTax === true,
    total: totals.total,
    coupon: coupon && rawId(coupon) ? { id: rawId(coupon), code: coupon.code ?? "" } : null,
    note: raw?.note ?? "",
    currency,
  };
}

/**
 * The totals from a cart estimate: the after-discount subtotal, the CART-level discount, every
 * named discount / additional fee / tax, whether prices already include tax, and the total before
 * delivery. Item-scope discounts are marked so the cart can skip them (already in the lines).
 */
export function summaryTotals(estimate: Raw | null | undefined, raw: Raw): CartTotals {
  const s: Raw = estimate?.summary ?? {};
  const currency = cartCurrency(raw) || cartCurrency(estimate?.cart);
  const ps: Raw = s.priceSummary ?? {};
  const named = (list: Raw[] | undefined, key: string): CartAmount[] =>
    (list ?? [])
      .filter((x) => x && amountOf(x[key]) > 0)
      .map((x) => ({ name: translated(x.name) || translated(x.translatedName), amount: formatMoney(x[key], currency) }));
  const scopeOf = (d: Raw): "cart" | "item" | "delivery" => (d.scope === "LINE_ITEM" ? "item" : d.scope === "DELIVERY" ? "delivery" : "cart");
  return {
    subtotal: formatMoney(ps.subtotal, currency),
    discount: amountOf(ps.discount) > 0 ? formatMoney(ps.discount, currency) : "",
    discounts: ((s.discounts ?? []) as Raw[]).filter((d) => d && amountOf(d.total) > 0).map((d) => ({ name: translated(d.name), amount: formatMoney(d.total, currency), scope: scopeOf(d) })),
    fees: named(s.additionalFees, "price"),
    taxes: named(s.taxSummary?.taxes, "amount"),
    pricesIncludeTax: s.taxSummary?.pricesIncludeTax === true,
    total: formatMoney(ps.total, currency),
  };
}

/**
 * The catalogReference.options object for an add — omits every key the buyer didn't use. Wix's
 * own storefront sends the variant id AND every option's `key: choice.key` pair (plus the choice
 * modifiers' pairs) under `options`; free text goes under `customTextFields` by the free-text key;
 * `subscriptionOptionId` only for a recurring plan.
 */
export function addOptions({ variantId, optionChoices, modifierChoices, customTextFields, subscriptionOptionId, preorder }: {
  variantId?: string | null; optionChoices?: Record<string, string>; modifierChoices?: Record<string, string>;
  customTextFields?: Record<string, string>; subscriptionOptionId?: string; preorder?: boolean;
}): Raw {
  const o: Raw = {};
  if (variantId) o.variantId = variantId; // REQUIRED for any product with options
  const options = { ...(optionChoices ?? {}), ...(modifierChoices ?? {}) };
  if (Object.keys(options).length) o.options = options;
  if (customTextFields && Object.keys(customTextFields).length) o.customTextFields = customTextFields;
  if (subscriptionOptionId) o.subscriptionOptionId = subscriptionOptionId;
  if (preorder) o.preOrderRequested = true;
  return o;
}

/** The application error code of an SDK or REST failure (`details.applicationError.code`), if any. */
export function errorCode(err: unknown): string | undefined {
  const e = err as Raw | null | undefined;
  const code = e?.details?.applicationError?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

// Buyer copy for the codes Wix's own storefront maps; anything else keeps the API's message.
const CART_ERRORS: Record<string, string> = {
  ITEM_NOT_FOUND_IN_CATALOG: "This item is no longer available.",
  INSUFFICIENT_INVENTORY: "This item is now out of stock.",
  ERROR_COUPON_DOES_NOT_EXIST: "That code doesn't exist. Check it and try again.",
  ERROR_COUPON_EXPIRED: "That code has expired.",
  ERROR_COUPON_NOT_APPLICABLE: "That code doesn't apply to this cart.",
};

/** A buyer-facing message for a failed cart call. */
export function cartErrorMessage(err: unknown, fallback = "Something went wrong with your cart. Please try again."): string {
  const code = errorCode(err);
  if (code && CART_ERRORS[code]) return CART_ERRORS[code];
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message || fallback;
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
    throw new Error(`Some items are no longer available: ${unavailable.map((l) => translated(l.name)).filter(Boolean).join(", ")}.`);
  }
  if (!rawId(raw)) throw new Error("Checkout couldn't start: the cart has no id.");
}
