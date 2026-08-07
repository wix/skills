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

  const refreshCart = useCallback(async () => setCart(await getCurrentCart()), []);
  useEffect(() => {
    refreshCart();
    const onVisible = () => document.visibilityState === "visible" && refreshCart();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCart]);

  const itemCount = (cart?.lineItems ?? []).reduce((n, li) => n + (li.quantity || 0), 0);
  const addToCart = async (id, variantId, qty = 1, extras) => {
    setLoading(true);
    try { setCart(await apiAdd(id, variantId, qty, extras)); setIsOpen(true); } finally { setLoading(false); }
  };
  const removeItem = async (lineItemId) => { setLoading(true); try { setCart(await apiRemove(lineItemId)); } finally { setLoading(false); } };
  const updateQuantity = async (lineItemId, qty) => { setLoading(true); try { setCart(await apiQty(lineItemId, qty)); } finally { setLoading(false); } };
  const checkout = async () => { setLoading(true); try { window.location.href = await apiCheckout(); } finally { setLoading(false); } };

  return (
    <CartContext.Provider value={{ cart, itemCount, isOpen, setIsOpen, loading, addToCart, removeItem, updateQuantity, checkout, refreshCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
