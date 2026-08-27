// React binding for the order-cart store. Works in any React root — Astro islands (several
// on one page share the same store) and SPAs alike.
import { useSyncExternalStore } from "react";
import {
  addOrderLine,
  getOrderCartState,
  goToOrderCheckout,
  refreshOrderCart,
  removeLineFromOrder,
  setOrderCartOpen,
  subscribeOrderCart,
  updateOrderLineQuantity,
  type OrderCartState,
} from "../../wix/restaurants/order-store";

const SERVER_STATE = getOrderCartState();

export interface UseOrderCart extends OrderCartState {
  itemCount: number;
  /** menuId/sectionId come from the render context (the fetchMenus tree) — pass both. */
  addToOrder: (itemId: string, context: { menuId: string; sectionId: string }, quantity?: number) => Promise<void>;
  updateQuantity: (lineItemId: string, quantity: number) => Promise<void>;
  removeLine: (lineItemId: string) => Promise<void>;
  checkout: () => Promise<void>;
  openCart: () => void;
  closeCart: () => void;
  refresh: () => Promise<void>;
}

export function useOrderCart(): UseOrderCart {
  const state = useSyncExternalStore(subscribeOrderCart, getOrderCartState, () => SERVER_STATE);
  return {
    ...state,
    itemCount: state.cart?.itemCount ?? 0,
    addToOrder: addOrderLine,
    updateQuantity: updateOrderLineQuantity,
    removeLine: removeLineFromOrder,
    checkout: goToOrderCheckout,
    openCart: () => setOrderCartOpen(true),
    closeCart: () => setOrderCartOpen(false),
    refresh: refreshOrderCart,
  };
}
