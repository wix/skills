// Online ordering (Restaurants Orders + Wix eCom Cart V2) — the only file that touches the
// raw cart and operation entities. Copy as-is; extend by calling these exports, never by
// editing them. The request shapes are exact and rewriting them is how carts break:
//   - the catalogReference appId is the ORDERS app (9a5d83fd-…), never the Stores id;
//   - options MUST carry operationId + menuId + sectionId (all three) — the restaurant
//     analog of the store's variantId; there is NO variantId here;
//   - modifier/variant selections on the cart line are NOT sent — that options shape isn't
//     documented for client add-to-cart (display modifiers; send quantity only).
// Failures are loud: throws on a missing ordering operation, unavailable lines, and an empty
// cart at checkout — surface the message, don't swallow it.
import { operations as operationsModule, fulfillmentMethods as fulfillmentModule, items as itemsModule } from "@wix/restaurants";
import { currentCartV2 } from "@wix/ecom";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { formatMoney } from "../money";
import type { FulfillmentMethodInfo, OrderCart, OrderLine } from "./types";

const operationsApi = wixModule(operationsModule);
const fulfillmentApi = wixModule(fulfillmentModule);
const itemsApi = wixModule(itemsModule);
const cartApi = wixModule(currentCartV2);
const redirects = wixModule(redirectsModule);

/** The Restaurants Orders app id — every restaurant cart line's catalogReference.appId. */
export const RESTAURANTS_ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";

type Raw = Record<string, any>;

// The ordering operation is site config — resolve once, reuse for every add.
let operationIdPromise: Promise<string | null> | null = null;

/**
 * The id of the operation to order through (ENABLED, else default, else first) — null when
 * the site has no online ordering configured (show an "ordering unavailable" state).
 */
export function resolveOperationId(): Promise<string | null> {
  operationIdPromise ??= operationsApi
    .listOperations()
    .then((res: Raw) => {
      const ops: Raw[] = res.operations ?? [];
      const op =
        ops.find((o: Raw) => o.onlineOrderingStatus === "ENABLED") ?? ops.find((o: Raw) => o.default) ?? ops[0];
      return op?._id ?? null;
    })
    .catch(() => {
      operationIdPromise = null; // transient failure — allow a retry on the next call
      return null;
    });
  return operationIdPromise;
}

/** Enabled pickup/delivery methods, for display — the buyer picks one on the hosted checkout. */
export async function fetchFulfillmentMethods(): Promise<FulfillmentMethodInfo[]> {
  try {
    const res: Raw = await fulfillmentApi.listFulfillmentMethods();
    return (res.fulfillmentMethods ?? [])
      .filter((m: Raw) => m.enabled === true)
      .map((m: Raw): FulfillmentMethodInfo => ({
        id: m._id ?? "",
        type: m.type === "DELIVERY" ? "DELIVERY" : "PICKUP",
        name: m.name ?? "",
        fee: m.fee ?? "0",
        minOrderPrice: m.minOrderPrice ?? "0",
      }))
      .filter((m: FulfillmentMethodInfo) => m.id);
  } catch {
    return []; // display nicety — ordering still works without the list
  }
}

// The V2 cart doesn't reliably return line-item images — join them from the menu items by
// the line's catalogItemId and cache for the session.
const lineImageCache = new Map<string, string>();

async function fillLineImages(lines: OrderLine[], raws: Raw[]): Promise<void> {
  const wanted = new Map<string, number[]>(); // itemId -> line indexes
  raws.forEach((raw: Raw, i: number) => {
    if (lines[i].imageUrl) return;
    const itemId = raw.source?.catalogReference?.catalogItemId;
    if (!itemId) return;
    const cached = lineImageCache.get(itemId);
    if (cached !== undefined) {
      lines[i].imageUrl = cached;
      return;
    }
    wanted.set(itemId, [...(wanted.get(itemId) ?? []), i]);
  });
  if (!wanted.size) return;
  try {
    const res: Raw = await itemsApi.listItems({ itemIds: [...wanted.keys()] });
    for (const item of (res.items ?? []) as Raw[]) {
      const url = imgSrc(item.image, 300, 300);
      lineImageCache.set(item._id, url);
      for (const i of wanted.get(item._id) ?? []) lines[i].imageUrl = url;
    }
  } catch {
    /* images are a nicety — the cart stays correct without them */
  }
}

function cartCurrency(raw: Raw | null): string {
  return raw?.customerInfo?.currencyCode ?? raw?.businessInfo?.currencyCode ?? "";
}

function toLine(raw: Raw, currency: string): OrderLine {
  const descriptionLines: string[] = (raw.attributes?.descriptionLines ?? [])
    .map((d: Raw) => {
      const label = d.name?.original ?? "";
      const value = d.plainText?.original ?? d.colorInfo?.original ?? "";
      return label && value ? `${label}: ${value}` : value || label;
    })
    .filter(Boolean);
  return {
    lineItemId: raw._id ?? "",
    itemName: raw.name?.original ?? "",
    quantity: raw.quantityInfo?.confirmedQuantity ?? 0,
    unitPrice: formatMoney(raw.pricing?.unitPrice, currency),
    linePrice: formatMoney(raw.pricing?.totalPrice, currency),
    imageUrl: imgSrc(raw.attributes?.image, 300, 300),
    descriptionLines,
    status: raw.status ?? "IN_STOCK",
  };
}

function toCart(raw: Raw | null, subtotal: string): OrderCart {
  const currency = cartCurrency(raw);
  const lines = (raw?.lineItems ?? []).map((l: Raw) => toLine(l, currency));
  return {
    lines,
    itemCount: lines.reduce((sum: number, l: OrderLine) => sum + l.quantity, 0),
    subtotal,
    currency,
  };
}

async function readCartWithSubtotal(raw: Raw | null): Promise<OrderCart> {
  if (!raw?.lineItems?.length) return toCart(raw, "");
  // The authoritative after-discount subtotal comes from the cart estimate, never from
  // hand-summing line items (fees, tax, and delivery resolve at checkout).
  let subtotal = "";
  try {
    const estimate: Raw = await cartApi.estimateCurrentCart();
    subtotal = formatMoney(estimate?.summary?.priceSummary?.subtotal, cartCurrency(raw));
  } catch {
    /* estimate is a display nicety — the cart itself is still valid */
  }
  const cart = toCart(raw, subtotal);
  await fillLineImages(cart.lines, raw.lineItems as Raw[]);
  return cart;
}

/** Read the visitor's current order cart. An empty cart (not an error) when none exists yet. */
export async function fetchOrderCart(): Promise<OrderCart> {
  try {
    const { cart } = await cartApi.getCurrentCart();
    return readCartWithSubtotal(cart as Raw);
  } catch {
    return toCart(null, "");
  }
}

/**
 * Add a menu item to the current order. `menuId` and `sectionId` are the ids of the menu and
 * section the item is RENDERED UNDER — thread them from the render context (the fetchMenus
 * tree), never re-derive them. Throws when ordering isn't configured or the line is refused.
 */
export async function addToOrder(
  itemId: string,
  { menuId, sectionId }: { menuId: string; sectionId: string },
  quantity = 1,
): Promise<OrderCart> {
  const operationId = await resolveOperationId();
  if (!operationId) throw new Error("Online ordering isn't available right now.");
  if (!itemId || !menuId || !sectionId) throw new Error("addToOrder needs the item, menu, and section ids.");

  const { cart } = await cartApi.addLineItemsToCurrentCart({
    catalogItems: [
      {
        quantity,
        catalogReference: {
          catalogItemId: itemId,
          appId: RESTAURANTS_ORDERS_APP_ID,
          options: { operationId, menuId, sectionId },
        },
      },
    ],
  });

  // V2 nests the reference under `source` — a top-level lineItem.catalogReference no longer exists.
  const line = ((cart as Raw)?.lineItems ?? []).find(
    (l: Raw) => l.source?.catalogReference?.catalogItemId === itemId,
  );
  if (line?.status && line.status !== "IN_STOCK") {
    throw new Error(`This dish isn't available right now (${line.status.toLowerCase().replace(/_/g, " ")}).`);
  }
  if (!line || line.quantityInfo?.confirmedQuantity === 0) {
    throw new Error("The dish couldn't be added to the order — please try again.");
  }
  return readCartWithSubtotal(cart as Raw);
}

/** Change a line's quantity. `lineItemId` is OrderLine.lineItemId, never the menu item id. */
export async function updateOrderQuantity(lineItemId: string, quantity: number): Promise<OrderCart> {
  const { cart } = await cartApi.updateLineItemsInCurrentCart({
    lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }],
  });
  return readCartWithSubtotal(cart as Raw);
}

/** Remove a line from the order by OrderLine.lineItemId. */
export async function removeOrderLine(lineItemId: string): Promise<OrderCart> {
  const { cart } = await cartApi.removeLineItemsFromCurrentCart([lineItemId]);
  return readCartWithSubtotal(cart as Raw);
}

/**
 * Start the Wix-hosted checkout for the current order and return the URL to navigate to.
 * The cart's id IS the checkout id — no separate checkout-creation call. Fulfillment
 * (pickup/delivery + time) and payment are collected on the hosted page. Call from the
 * browser: the return origin must be window.location.origin (https), never a server-derived
 * request origin (http behind the proxy → the return redirect 403s).
 */
export async function orderCheckoutUrl(): Promise<string> {
  const { cart } = await cartApi.getCurrentCart();
  const raw = cart as Raw;
  const lines: Raw[] = raw?.lineItems ?? [];
  if (!lines.length) throw new Error("Your order is empty.");
  const unavailable = lines.filter((l) => l.status && l.status !== "IN_STOCK");
  if (unavailable.length) {
    const names = unavailable.map((l) => l.name?.original).filter(Boolean).join(", ");
    throw new Error(`Some dishes are no longer available: ${names}.`);
  }
  if (!raw?._id) throw new Error("Checkout couldn't start: the order has no id.");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const session = await redirects.createRedirectSession({
    ecomCheckout: { checkoutId: raw._id },
    callbacks: {
      postFlowUrl: origin ? `${origin}/` : undefined,
      thankYouPageUrl: origin ? `${origin}/` : undefined,
    },
  });
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start: no redirect URL returned.");
  return url;
}
