// Client-side order-cart state — a module-scope store, deliberately NOT a React context.
// A context can't span Astro islands (each island is its own React root); a module singleton
// is shared by every island in the page bundle, and works identically in a single-root SPA.
// Consume it through useOrderCart() (hooks/), or subscribe directly.
import type { OrderCart } from "./types";
import {
  addToOrder as apiAdd,
  fetchOrderCart,
  orderCheckoutUrl,
  removeOrderLine as apiRemove,
  resolveOperationId,
  updateOrderQuantity as apiUpdate,
} from "./ordering";

export interface OrderCartState {
  cart: OrderCart | null;
  /** null while resolving; false → no ordering operation configured (show "unavailable"). */
  ordering: boolean | null;
  /** True while any cart operation is in flight. */
  busy: boolean;
  /** Last failed operation's message — render it; a new operation clears it. */
  error: string | null;
  /** Order drawer visibility (OrderCartButton opens it, OrderCartDrawer renders by it). */
  open: boolean;
}

const EMPTY: OrderCartState = { cart: null, ordering: null, busy: false, error: null, open: false };

let state: OrderCartState = EMPTY;
const listeners = new Set<() => void>();
let loaded = false;

function setState(patch: Partial<OrderCartState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getOrderCartState(): OrderCartState {
  return state;
}

export function subscribeOrderCart(listener: () => void): () => void {
  listeners.add(listener);
  // First subscriber triggers the initial load (browser only — SSR renders the empty state).
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    void refreshOrderCart();
    void resolveOperationId().then((id) => setState({ ordering: id !== null }));
  }
  return () => listeners.delete(listener);
}

async function run(op: () => Promise<OrderCart>): Promise<void> {
  setState({ busy: true, error: null });
  try {
    setState({ cart: await op(), busy: false });
  } catch (e) {
    setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function refreshOrderCart(): Promise<void> {
  try {
    setState({ cart: await fetchOrderCart() });
  } catch {
    /* no cart yet — leave the empty state */
  }
}

/** Add a menu item to the order and open the drawer. Throws (and sets .error) on refusal. */
export async function addOrderLine(
  itemId: string,
  context: { menuId: string; sectionId: string },
  quantity = 1,
): Promise<void> {
  await run(() => apiAdd(itemId, context, quantity));
  setState({ open: true });
}

export async function updateOrderLineQuantity(lineItemId: string, quantity: number): Promise<void> {
  await run(() => apiUpdate(lineItemId, quantity));
}

export async function removeLineFromOrder(lineItemId: string): Promise<void> {
  await run(() => apiRemove(lineItemId));
}

/** Navigate to the Wix-hosted checkout. Never hand-build a checkout URL. */
export async function goToOrderCheckout(): Promise<void> {
  setState({ busy: true, error: null });
  try {
    const url = await orderCheckoutUrl();
    window.location.href = url;
  } catch (e) {
    setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export function setOrderCartOpen(open: boolean): void {
  setState({ open });
}
