// Cart state — mirrors the Wix SERVER cart (never a local copy). Wrap the app in <CartProvider>;
// every component reads useCart(). Data wiring is correct as-is — do not restyle or re-derive it.
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  getCurrentCart,
  addToCart as apiAdd,
  removeFromCart as apiRemove,
  updateCartItemQuantity as apiQty,
  checkout as apiCheckout,
} from "@/rest/wix-store-cart";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // The cart helpers throw on refusal with a buyer-readable reason — an empty cart, or line items
  // whose availability.status isn't AVAILABLE. Hold the message so the drawer can show it; without
  // this the rejection is unhandled and the shopper sees the spinner stop with nothing said.
  const [error, setError] = useState(null);

  const refreshCart = useCallback(async () => setCart(await getCurrentCart()), []);
  useEffect(() => {
    refreshCart();
    const onVisible = () => document.visibilityState === "visible" && refreshCart();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCart]);

  const itemCount = (cart?.lineItems ?? []).reduce((n, li) => n + (li.quantity || 0), 0);

  // Every mutation runs through here so a rejection always lands somewhere visible. `run` keeps the
  // cart untouched on failure — the server stays the source of truth — and re-reads it for anything
  // that may have changed underneath (an item selling out between page load and checkout).
  const run = async (fn, { reread = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e?.message || "Something went wrong. Please try again.");
      if (reread) await refreshCart().catch(() => {});
      return null;
    } finally {
      setLoading(false);
    }
  };

  const addToCart = async (id, variantId, qty = 1, extras) =>
    run(async () => {
      setCart(await apiAdd(id, variantId, qty, extras));
      setIsOpen(true);
    });
  const removeItem = (lineItemId) => run(async () => setCart(await apiRemove(lineItemId)));
  const updateQuantity = (lineItemId, qty) => run(async () => setCart(await apiQty(lineItemId, qty)));
  const checkout = () =>
    run(async () => { window.location.href = await apiCheckout(); }, { reread: true });

  return (
    <CartContext.Provider value={{ cart, itemCount, isOpen, setIsOpen, loading, error, clearError: () => setError(null), addToCart, removeItem, updateQuantity, checkout, refreshCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
