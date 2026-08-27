// Header cart icon with a live count badge — mount once in your header, as-is.
// Opens the CartDrawer (mount that once too, anywhere in the page).
import { useCart } from "../../hooks/storefront/useCart";

export default function CartButton() {
  const { itemCount, openCart } = useCart();
  return (
    <button
      type="button"
      aria-label={`Cart, ${itemCount} items`}
      onClick={openCart}
      className="relative inline-flex items-center p-1.5 text-foreground transition-opacity hover:opacity-70"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
      {itemCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {itemCount}
        </span>
      )}
    </button>
  );
}
