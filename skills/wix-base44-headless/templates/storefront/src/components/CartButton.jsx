// Header cart trigger with live item count. Drop into the app header; opens the CartDrawer.
import { useCart } from "@/context/CartContext";

export default function CartButton() {
  const { itemCount, setIsOpen } = useCart();
  return (
    <button onClick={() => setIsOpen(true)} aria-label="Open cart" style={{
      position: "relative", display: "inline-flex", alignItems: "center", gap: 6,
      padding: "8px 14px", cursor: "pointer",
      background: "var(--color-primary)", color: "var(--color-on-primary)",
      border: "none", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-body)",
    }}>
      Cart
      {itemCount > 0 && (
        <span style={{
          minWidth: 20, height: 20, padding: "0 6px", display: "inline-flex",
          alignItems: "center", justifyContent: "center", fontSize: 12,
          background: "var(--color-accent)", color: "#fff", borderRadius: 999,
        }}>{itemCount}</span>
      )}
    </button>
  );
}
