// Client-side cart state — a module-scope store, deliberately NOT a React context.
// A context can't span Astro islands (each island is its own React root); a module
// singleton is shared by every island in the page bundle, and works identically in a
// single-root SPA. Consume it through useCart() (hooks/), or subscribe directly.
import type { Cart } from "./types";
import {
  addToCart as apiAdd,
  fetchCart,
  removeLine as apiRemove,
  updateQuantity as apiUpdate,
  checkoutUrl,
  type AddToCartExtras,
} from "./cart";

export interface CartState {
  cart: Cart | null;
  /** True while any cart operation is in flight. */
  busy: boolean;
  /** Last failed operation's message — render it; a new operation clears it. */
  error: string | null;
  /** Cart drawer visibility (CartButton opens it, CartDrawer renders by it). */
  open: boolean;
}

const EMPTY: CartState = { cart: null, busy: false, error: null, open: false };

let state: CartState = EMPTY;
const listeners = new Set<() => void>();
let loaded = false;

function setState(patch: Partial<CartState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getCartState(): CartState {
  return state;
}

export function subscribeCart(listener: () => void): () => void {
  listeners.add(listener);
  // First subscriber triggers the initial load (browser only — SSR renders the empty state).
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    void refreshCart();
  }
  return () => listeners.delete(listener);
}

async function run(op: () => Promise<Cart>): Promise<void> {
  setState({ busy: true, error: null });
  try {
    setState({ cart: await op(), busy: false });
  } catch (e) {
    setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function refreshCart(): Promise<void> {
  try {
    setState({ cart: await fetchCart() });
  } catch {
    /* no cart yet — leave the empty state */
  }
}

/** Add to cart and open the drawer. Throws (and sets .error) on refusal. */
export async function addLine(
  productId: string,
  variantId?: string | null,
  quantity = 1,
  extras?: AddToCartExtras,
): Promise<void> {
  await run(() => apiAdd(productId, variantId, quantity, extras));
  setState({ open: true });
}

export async function updateLineQuantity(lineItemId: string, quantity: number): Promise<void> {
  await run(() => apiUpdate(lineItemId, quantity));
}

export async function removeCartLine(lineItemId: string): Promise<void> {
  await run(() => apiRemove(lineItemId));
}

/** Navigate to the Wix-hosted checkout. Never hand-build a checkout URL. */
export async function goToCheckout(): Promise<void> {
  setState({ busy: true, error: null });
  try {
    const url = await checkoutUrl();
    window.location.href = url;
  } catch (e) {
    setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export function setCartOpen(open: boolean): void {
  setState({ open });
}
