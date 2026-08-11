// Header cart trigger — an icon button with a live item-count badge. Drop into the app header; opens the CartDrawer.
// Icon-only by design (no "Cart" text): reads the header's currentColor, so it inherits the brand automatically.
import { useCart } from "@/context/CartContext";

export default function CartButton() {
  const { itemCount, setIsOpen } = useCart();
  return (
    <button onClick={() => setIsOpen(true)} aria-label={`Open cart${itemCount ? `, ${itemCount} item${itemCount > 1 ? "s" : ""}` : ""}`}
      className="relative inline-flex items-center justify-center w-10 h-10 p-0 cursor-pointer bg-transparent text-current border-none rounded-sm">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
      {itemCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-[5px] py-0 inline-flex items-center justify-center text-[11px] font-semibold bg-primary text-white rounded-full">{itemCount}</span>
      )}
    </button>
  );
}
