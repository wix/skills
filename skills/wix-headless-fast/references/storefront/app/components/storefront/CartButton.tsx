// Header cart icon with a live count badge — mount once in your header, as-is.
// Opens the CartDrawer (mount that once too, anywhere in the page).
import { useCart } from "../../hooks/storefront/useCart";

export default function CartButton() {
  const { itemCount, openCart } = useCart();
  return (
    <button type="button" className="sf-cart-btn" aria-label={`Cart, ${itemCount} items`} onClick={openCart}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
      {itemCount > 0 && <span className="sf-cart-count">{itemCount}</span>}
    </button>
  );
}
