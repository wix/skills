// Cart + checkout (Wix eCom Cart V2) — the only file that touches raw cart entities.
// Copy as-is; extend by calling these exports, never by editing them. The request shapes are
// exact (catalogItems wrapper, options.variantId, the redirect-session body) and rewriting
// them is how carts break.
//
// Failures are loud: these throw on out-of-stock lines, an empty cart at checkout, and a
// missing required selection — surface the message to the buyer, don't swallow it.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/update-line-items.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md
import { currentCartV2 } from "@wix/ecom";
import { redirects as redirectsModule } from "@wix/redirects";
import { productsV3 } from "@wix/stores";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { formatMoney } from "../money";
import type { Cart, CartLine } from "./types";

const cartApi = wixModule(currentCartV2);
const redirects = wixModule(redirectsModule);
const productsApi = wixModule(productsV3);

// The V2 cart does NOT return line-item images (attributes.image is typed but comes back
// absent — verified against a live cart), so images are joined from the catalog by the
// line's catalogItemId and cached for the session.
const lineImageCache = new Map<string, string>();

async function fillLineImages(lines: CartLine[], raws: RawCart[]): Promise<void> {
  const wanted = new Map<string, number[]>(); // productId -> line indexes
  raws.forEach((raw, i) => {
    if (lines[i].imageUrl) return;
    const pid = raw.source?.catalogReference?.catalogItemId;
    if (!pid) return;
    const cached = lineImageCache.get(pid);
    if (cached !== undefined) {
      lines[i].imageUrl = cached;
      return;
    }
    wanted.set(pid, [...(wanted.get(pid) ?? []), i]);
  });
  if (!wanted.size) return;
  try {
    const res = await productsApi
      .queryProducts()
      .in("_id", [...wanted.keys()])
      .find();
    for (const p of (res.items ?? []) as RawCart[]) {
      const url = imgSrc(p.media?.main, 300, 300);
      lineImageCache.set(p._id, url);
      for (const i of wanted.get(p._id) ?? []) lines[i].imageUrl = url;
    }
  } catch {
    /* images are a nicety — the cart stays correct without them */
  }
}

// Public app id of the Wix Stores catalog — required inside every catalogReference.
const WIX_STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

type RawCart = Record<string, any>;

function cartCurrency(raw: RawCart | null): string {
  return raw?.customerInfo?.currencyCode ?? raw?.businessInfo?.currencyCode ?? "";
}

// "Monthly plan · every 2 months · 6 payments" from the line's subscriptionInfo (Cart V2 carries the
// plan on the line); "" for a one-time purchase. Never invented — every word comes from the plan.
function subscriptionTerms(info: RawCart | undefined): string {
  if (!info) return "";
  const s: RawCart = info.subscriptionSettings ?? {};
  const unit: Record<string, string> = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };
  const parts: string[] = [];
  const title = info.title?.original ?? info.title?.translated ?? "";
  if (title) parts.push(title);
  const u = unit[String(s.frequency ?? "")];
  if (u) parts.push(`every ${s.interval && s.interval > 1 ? `${s.interval} ${u}s` : u}`);
  if (!s.autoRenewal && s.billingCycles) parts.push(`${s.billingCycles} payments`);
  return parts.join(" · ");
}

function toLine(raw: RawCart, currency: string): CartLine {
  const descriptionLines: string[] = (raw.attributes?.descriptionLines ?? [])
    .map((d: RawCart) => {
      const label = d.name?.original ?? "";
      const value = d.plainText?.original ?? d.colorInfo?.original ?? "";
      return label && value ? `${label}: ${value}` : value || label;
    })
    .filter(Boolean);
  return {
    lineItemId: raw._id ?? "",
    productName: raw.name?.original ?? "",
    quantity: raw.quantityInfo?.confirmedQuantity ?? 0,
    unitPrice: formatMoney(raw.pricing?.unitPrice, currency),
    linePrice: formatMoney(raw.pricing?.totalPrice, currency),
    imageUrl: imgSrc(raw.attributes?.image, 300, 300),
    descriptionLines,
    status: raw.status ?? "IN_STOCK",
    subscription: subscriptionTerms(raw.subscriptionInfo),
  };
}

function toCart(raw: RawCart | null, subtotal: string, discount = ""): Cart {
  const currency = cartCurrency(raw);
  const lines = (raw?.lineItems ?? []).map((l: RawCart) => toLine(l, currency));
  return {
    lines,
    itemCount: lines.reduce((sum: number, l: CartLine) => sum + l.quantity, 0),
    subtotal,
    discount,
    currency,
  };
}

async function readCartWithSubtotal(raw: RawCart | null): Promise<Cart> {
  // Only estimate a cart WITH lines — on an absent/empty cart the endpoint returns 404.
  if (!raw?.lineItems?.length) return toCart(raw, "");
  // The authoritative after-discount subtotal and the CART-level discount come from the cart
  // estimate, never from hand-summing lines. Its delivery/tax/fees read "0" when nothing was
  // calculated — never render those as "Free"; shipping and tax resolve at checkout.
  let subtotal = "";
  let discount = "";
  try {
    const estimate: RawCart = await cartApi.estimateCurrentCart();
    const summary = estimate?.summary?.priceSummary;
    const currency = cartCurrency(raw);
    subtotal = formatMoney(summary?.subtotal, currency);
    const d = summary?.discount;
    if (Number(d?.convertedAmount ?? d?.amount ?? 0) > 0) discount = formatMoney(d, currency);
  } catch {
    /* estimate is a display nicety — the cart itself is still valid */
  }
  const cart = toCart(raw, subtotal, discount);
  await fillLineImages(cart.lines, raw.lineItems as RawCart[]);
  return cart;
}

/** Read the visitor's current cart. An empty Cart (not an error) when none exists yet. */
export async function fetchCart(): Promise<Cart> {
  try {
    const { cart } = await cartApi.getCurrentCart();
    return readCartWithSubtotal(cart as RawCart);
  } catch {
    return toCart(null, "");
  }
}

export interface AddToCartExtras {
  /** TEXT_CHOICES modifier selections: modifier key -> choice key. */
  modifierChoices?: Record<string, string>;
  /** FREE_TEXT modifier inputs: freeTextSettings key -> the buyer's text. */
  customTextFields?: Record<string, string>;
  /** The variant is out of stock but pre-orderable — sends preOrderRequested. */
  preorder?: boolean;
  /** A chosen recurring plan (subscriptionPricesInfo); omit for a one-time purchase. */
  subscriptionOptionId?: string;
}

/**
 * Add a product to the current cart.
 * For a product WITH options, `variantId` is mandatory — resolve it with
 * `resolveVariant()` from ./catalog first. Mandatory modifiers must be included.
 */
export async function addToCart(
  productId: string,
  variantId?: string | null,
  quantity = 1,
  { modifierChoices, customTextFields, preorder, subscriptionOptionId }: AddToCartExtras = {},
): Promise<Cart> {
  const options: Record<string, unknown> = {};
  if (variantId) options.variantId = variantId;
  if (modifierChoices && Object.keys(modifierChoices).length) options.options = modifierChoices;
  if (customTextFields && Object.keys(customTextFields).length) options.customTextFields = customTextFields;
  if (subscriptionOptionId) options.subscriptionOptionId = subscriptionOptionId;
  if (preorder) options.preOrderRequested = true;

  const { cart } = await cartApi.addLineItemsToCurrentCart({
    catalogItems: [
      {
        quantity,
        catalogReference: {
          catalogItemId: productId,
          appId: WIX_STORES_APP_ID,
          ...(Object.keys(options).length ? { options } : {}),
        },
      },
    ],
  });

  const line = ((cart as RawCart)?.lineItems ?? []).find(
    (l: RawCart) =>
      l.source?.catalogReference?.catalogItemId === productId &&
      (!variantId || l.source?.catalogReference?.options?.variantId === variantId),
  );
  if (line?.status && line.status !== "IN_STOCK") {
    throw new Error(`This item isn't available right now (${line.status.toLowerCase().replace(/_/g, " ")}).`);
  }
  if (!line || line.quantityInfo?.confirmedQuantity === 0) {
    throw new Error(
      "The item couldn't be added. Make sure every required selection was made " +
        "(options for a product with variants, and all mandatory customizations).",
    );
  }
  return readCartWithSubtotal(cart as RawCart);
}

/** Change a line's quantity. `lineItemId` is CartLine.lineItemId, never the product id. */
export async function updateQuantity(lineItemId: string, quantity: number): Promise<Cart> {
  const { cart } = await cartApi.updateLineItemsInCurrentCart({
    lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }],
  });
  return readCartWithSubtotal(cart as RawCart);
}

/** Remove a line from the cart by CartLine.lineItemId. */
export async function removeLine(lineItemId: string): Promise<Cart> {
  const { cart } = await cartApi.removeLineItemsFromCurrentCart([lineItemId]);
  return readCartWithSubtotal(cart as RawCart);
}

/**
 * Start the Wix-hosted checkout for the current cart and return the URL to navigate to.
 * The cart's id IS the checkout id — no separate checkout-creation call.
 * Call from the browser: the return origin must be the site's real https origin
 * (window.location.origin), never a server-derived request origin.
 */
export async function checkoutUrl(): Promise<string> {
  const { cart } = await cartApi.getCurrentCart();
  const raw = cart as RawCart;
  const lines: RawCart[] = raw?.lineItems ?? [];
  if (!lines.length) throw new Error("Your cart is empty.");
  const unavailable = lines.filter((l) => l.status && l.status !== "IN_STOCK");
  if (unavailable.length) {
    const names = unavailable.map((l) => l.name?.original).filter(Boolean).join(", ");
    throw new Error(`Some items are no longer available: ${names}.`);
  }
  if (!raw?._id) throw new Error("Checkout couldn't start: the cart has no id.");

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
