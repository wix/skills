// Client-side cart state — a module-scope store, deliberately NOT a React context.
// A context can't span Astro islands (each island is its own React root); a module
// singleton is shared by every island in the page bundle, and works identically in a
// single-root SPA. Consume it through useCart() (hooks/), or subscribe directly.
import type { Cart } from "./types";
import {
  addToCart as apiAdd,
  applyCoupon as apiApplyCoupon,
  fetchCart,
  removeCoupon as apiRemoveCoupon,
  removeLine as apiRemove,
  setNote as apiSetNote,
  updateQuantity as apiUpdate,
  checkoutUrl,
  type AddToCartExtras,
} from "./cart";

export interface CartState {
  cart: Cart | null;
  /**
   * True while any cart operation is in flight — the DRAWER's flag (its steppers, remove, coupon
   * and checkout controls), not a card's: a product card disables its own add control on
   * `pendingProductId`, or every card in the grid dims for every add.
   */
  busy: boolean;
  /** The product whose add is in flight, null otherwise — what a card's add control binds to. */
  pendingProductId: string | null;
  /** Last failed operation's message — render it; a new operation clears it. */
  error: string | null;
  /** Cart drawer visibility (CartButton opens it, CartDrawer renders by it). */
  open: boolean;
}

const EMPTY: CartState = { cart: null, busy: false, pendingProductId: null, error: null, open: false };

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
  setState({ pendingProductId: productId });
  try {
    await run(() => apiAdd(productId, variantId, quantity, extras));
  } finally {
    setState({ pendingProductId: null });
    // Open either way. On success this shows the new line; on refusal it's the only thing that
    // makes .error visible — the drawer renders it, and a drawer that stays shut on failure
    // turns a refused add (out of stock, a digital product with no file) into silence.
    setState({ open: true });
  }
}

export async function updateLineQuantity(lineItemId: string, quantity: number): Promise<void> {
  await run(() => apiUpdate(lineItemId, quantity));
}

export async function removeCartLine(lineItemId: string): Promise<void> {
  await run(() => apiRemove(lineItemId));
}

/** Apply a coupon code; rejects (and sets .error with buyer copy) when the code is unknown, expired, or doesn't apply. */
export async function applyCartCoupon(code: string): Promise<void> {
  if (!code.trim()) return;
  await run(() => apiApplyCoupon(code));
}

export async function removeCartCoupon(): Promise<void> {
  await run(() => apiRemoveCoupon());
}

/** Save the buyer's note to the merchant (commit on blur, not on every keystroke). */
export async function setCartNote(note: string): Promise<void> {
  if ((state.cart?.note ?? "") === note.trim()) return;
  await run(() => apiSetNote(note));
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
