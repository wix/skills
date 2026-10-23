// Client-side order-cart state — a module-scope store, deliberately NOT a React context.
// A context can't span Astro islands (each island is its own React root); a module singleton
// is shared by every island in the page bundle, and works identically in a single-root SPA.
// Consume it through useOrderCart() (hooks/), or subscribe directly. Besides the cart it holds
// the site's ordering gates: the operation's state and each menu's ordering settings, so an add
// control can read "accepting orders?" and "is THIS menu orderable now?" without a fetch of its own.
import type { DeliveryAddress, FulfillmentChoice, FulfillmentMethodInfo, FulfillmentTime, MenuItem, MenuOrderingInfo, OrderCart, OrderSelection, OrderingStatus } from "./types";
import { menuOrderable } from "./ordering-core";
import {
  addToOrder as apiAdd,
  fetchFulfillmentMethods,
  fetchFulfillmentTimes,
  fetchMenuOrdering,
  fetchOrderCart,
  orderCheckoutUrl,
  removeOrderLine as apiRemove,
  resolveOrdering,
  setOrderFulfillment,
  updateOrderQuantity as apiUpdate,
} from "./ordering";

export interface OrderCartState {
  cart: OrderCart | null;
  /** null while resolving; true only for an ENABLED operation; false → no ordering, disabled, or paused. */
  ordering: boolean | null;
  /** The operation's state (why `ordering` is false: NONE / DISABLED / PAUSED_UNTIL + pausedUntilIso). null while resolving. */
  orderingStatus: OrderingStatus | null;
  /** Per-menu ordering settings under the operation, keyed by menuId; null while loading or when unreadable. */
  menuOrdering: Record<string, MenuOrderingInfo> | null;
  /** The operation's enabled pickup/delivery methods (names, fees, minimums); null while loading. */
  fulfillment: FulfillmentMethodInfo[] | null;
  /** When the order can be fulfilled (ASAP first, then today's slots); null while loading or unreadable. */
  fulfillmentTimes: FulfillmentTime[] | null;
  /** The fulfillment last set on the cart through chooseFulfillment; null → none chosen (checkout uses pickup ASAP). */
  fulfillmentChoice: FulfillmentChoice | null;
  /**
   * True while any cart operation is in flight — the DRAWER's flag (its steppers, remove and
   * checkout controls), not a dish card's: a card disables its own add control on `pendingItemId`,
   * or every dish in the grid dims for every add.
   */
  busy: boolean;
  /** The menu item whose add is in flight, null otherwise — what a dish card's add control binds to. */
  pendingItemId: string | null;
  /** Last failed operation's message — render it; a new operation clears it. */
  error: string | null;
  /** Order drawer visibility (OrderCartButton opens it, OrderCartDrawer renders by it). */
  open: boolean;
}

const EMPTY: OrderCartState = { cart: null, ordering: null, orderingStatus: null, menuOrdering: null, fulfillment: null, fulfillmentTimes: null, fulfillmentChoice: null, busy: false, pendingItemId: null, error: null, open: false };

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
    void resolveOrdering().then((s) => setState({ ordering: s.status === "ENABLED", orderingStatus: s }));
    void fetchMenuOrdering().then((m) => setState({ menuOrdering: m })).catch(() => setState({ menuOrdering: null }));
    void fetchFulfillmentMethods().then((f) => setState({ fulfillment: f }));
    void loadFulfillmentTimes();
  }
  return () => listeners.delete(listener);
}

/**
 * Can dishes of `menuId` be added right now? false when the menu isn't enabled for online
 * ordering under the operation or is outside its availability window (render no add control);
 * null while the settings are still loading or could not be read — treat null as "try" (the add
 * itself is refused server-side with a message).
 */
export function isMenuOrderable(menuId: string): boolean | null {
  return menuOrderable(state.menuOrdering, menuId);
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

/**
 * Add a dish (the MenuItem DTO as rendered, with the menu/section ids it is rendered under and
 * the visitor's selection) to the order and open the drawer. Throws (and sets .error) on refusal.
 */
export async function addOrderLine(
  item: MenuItem,
  context: { menuId: string; sectionId: string },
  quantity = 1,
  selection?: OrderSelection,
): Promise<void> {
  setState({ pendingItemId: item.id });
  try {
    await run(() => apiAdd(item, context, quantity, selection));
  } finally {
    setState({ pendingItemId: null });
  }
  setState({ open: true });
}

export async function updateOrderLineQuantity(lineItemId: string, quantity: number): Promise<void> {
  await run(() => apiUpdate(lineItemId, quantity));
}

export async function removeLineFromOrder(lineItemId: string): Promise<void> {
  await run(() => apiRemove(lineItemId));
}

/**
 * Load the fulfillment times for `dayKey` ("YYYY-MM-DD" at the restaurant; default today). Pass the
 * delivery address once entered: delivery times then come only from methods that deliver there.
 */
export async function loadFulfillmentTimes(dayKey?: string, address?: DeliveryAddress): Promise<void> {
  try {
    setState({ fulfillmentTimes: await fetchFulfillmentTimes(dayKey, address) });
  } catch {
    setState({ fulfillmentTimes: null }); // unreadable — checkout still works on ASAP
  }
}

/**
 * Set pickup or delivery, the time (a fulfillmentTimes entry; omitted → ASAP) and, for delivery,
 * the address on the order. Throws (and sets .error) when the address isn't delivered to or the
 * time is gone.
 */
export async function chooseFulfillment(choice: FulfillmentChoice): Promise<void> {
  await run(() => setOrderFulfillment(choice));
  setState({ fulfillmentChoice: choice });
}

/** Navigate to the Wix-hosted checkout (pickup ASAP when no fulfillment was chosen). Never hand-build a checkout URL. */
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
