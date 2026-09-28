// React binding for the order-cart store. Works in any React root — Astro islands (several
// on one page share the same store) and SPAs alike.
import { useSyncExternalStore } from "react";
import {
  addOrderLine,
  getOrderCartState,
  goToOrderCheckout,
  isMenuOrderable,
  refreshOrderCart,
  removeLineFromOrder,
  setOrderCartOpen,
  subscribeOrderCart,
  updateOrderLineQuantity,
  type OrderCartState,
} from "../../wix/restaurants/order-store";
import type { MenuItem, OrderSelection } from "../../wix/restaurants/types";

const SERVER_STATE = getOrderCartState();

export interface UseOrderCart extends OrderCartState {
  itemCount: number;
  /**
   * Add a dish: the MenuItem DTO as rendered, the menu/section ids it is rendered under (the
   * fetchMenus tree — never looked up again), the quantity, and the visitor's selection (from
   * initialSelection(item) + toggleModifier; omit for a dish with nothing to choose).
   */
  addToOrder: (item: MenuItem, context: { menuId: string; sectionId: string }, quantity?: number, selection?: OrderSelection) => Promise<void>;
  /** false → this menu takes no online orders right now (no add control); null while unknown. */
  menuOrderable: (menuId: string) => boolean | null;
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
    menuOrderable: isMenuOrderable,
    updateQuantity: updateOrderLineQuantity,
    removeLine: removeLineFromOrder,
    checkout: goToOrderCheckout,
    openCart: () => setOrderCartOpen(true),
    closeCart: () => setOrderCartOpen(false),
    refresh: refreshOrderCart,
  };
}
