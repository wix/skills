// Header order trigger — an icon button with a live item-count badge. Drop into the app header;
// opens the OrderCartDrawer. Icon-only by design (no text): reads the header's currentColor, so it
// inherits the brand automatically.
import { useOrderCart } from "@/context/OrderCartContext";

export default function OrderCartButton() {
  const { itemCount, setIsOpen } = useOrderCart();
  return (
    <button onClick={() => setIsOpen(true)} aria-label={`Open order${itemCount ? `, ${itemCount} item${itemCount > 1 ? "s" : ""}` : ""}`} style={{
      position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 40, height: 40, padding: 0, cursor: "pointer",
      background: "transparent", color: "currentColor",
      border: "none", borderRadius: "var(--radius-sm)",
    }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
      {itemCount > 0 && (
        <span style={{
          position: "absolute", top: -2, right: -2,
          minWidth: 18, height: 18, padding: "0 5px", display: "inline-flex",
          alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600,
          background: "var(--color-accent)", color: "#fff", borderRadius: 999,
        }}>{itemCount}</span>
      )}
    </button>
  );
}
