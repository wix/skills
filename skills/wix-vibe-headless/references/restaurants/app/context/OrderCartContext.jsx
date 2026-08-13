// Order-cart state — mirrors the Wix SERVER cart (never a local copy). Wrap the app in
// <OrderCartProvider>; every component reads useOrderCart(). It also resolves the ordering
// Operation once on mount (restaurant lines REQUIRE an operationId) and exposes `ordering` — false
// when no operation is configured, so the UI shows an "ordering unavailable" state instead of
// throwing. Data wiring is correct as-is — do not restyle or re-derive it.
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  getCurrentCart,
  getDefaultOperation,
  addItemToCart,
  removeFromCart as apiRemove,
  updateCartItemQuantity as apiQty,
  checkout as apiCheckout,
} from "@/rest/wix-restaurants-ordering";

const OrderCartContext = createContext(null);

export function OrderCartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [operation, setOperation] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshCart = useCallback(async () => setCart(await getCurrentCart()), []);
  useEffect(() => {
    getDefaultOperation().then(setOperation);              // null when no operation is configured
    refreshCart();
    const onVisible = () => document.visibilityState === "visible" && refreshCart();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCart]);

  const itemCount = (cart?.lineItems ?? []).reduce((n, li) => n + (li.quantity || 0), 0);

  // A menu item carries its menuId/sectionId from the getFullMenu tree — the caller passes both.
  // addItemToCart throws on a missing operation/menu/section or an unavailable line; let it propagate.
  const addItem = async (item, { menuId, sectionId }, qty = 1) => {
    if (!operation) throw new Error("Online ordering isn't available for this restaurant right now.");
    setLoading(true);
    try {
      setCart(await addItemToCart(item.id, { operationId: operation.id, menuId, sectionId, quantity: qty }));
      setIsOpen(true);
    } finally { setLoading(false); }
  };
  const removeItem = async (lineItemId) => { setLoading(true); try { setCart(await apiRemove(lineItemId)); } finally { setLoading(false); } };
  const updateQuantity = async (lineItemId, qty) => { setLoading(true); try { setCart(await apiQty(lineItemId, qty)); } finally { setLoading(false); } };
  const checkout = async () => { setLoading(true); try { window.location.href = await apiCheckout(); } finally { setLoading(false); } };

  return (
    <OrderCartContext.Provider value={{
      cart, operation, ordering: Boolean(operation), itemCount, isOpen, setIsOpen, loading,
      addItem, removeItem, updateQuantity, checkout, refreshCart,
    }}>
      {children}
    </OrderCartContext.Provider>
  );
}

export function useOrderCart() {
  const ctx = useContext(OrderCartContext);
  if (!ctx) throw new Error("useOrderCart must be used within <OrderCartProvider>");
  return ctx;
}
