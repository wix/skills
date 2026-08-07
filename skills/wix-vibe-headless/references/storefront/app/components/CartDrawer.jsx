// Slide-over cart. Reads everything from useCart(); mutate by lineItem.id (NOT catalogItemId),
// check out via the context (redirect-session URL). Token-styled; re-skin via theme.css.
import { useCart } from "@/context/CartContext";

export default function CartDrawer() {
  const { cart, isOpen, setIsOpen, removeItem, updateQuantity, checkout, loading } = useCart();
  const lineItems = cart?.lineItems ?? [];
  if (!isOpen) return null;

  return (
    <div onClick={() => setIsOpen(false)} style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,.4)", display: "flex", justifyContent: "flex-end",
    }}>
      <aside onClick={(e) => e.stopPropagation()} style={{
        width: "min(420px, 100%)", height: "100%", display: "flex", flexDirection: "column",
        background: "var(--color-bg)", color: "var(--color-text)",
        borderLeft: "1px solid var(--color-border)", fontFamily: "var(--font-body)",
      }}>
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "var(--space)", borderBottom: "1px solid var(--color-border)",
        }}>
          <strong style={{ fontFamily: "var(--font-display)" }}>Your cart</strong>
          <button onClick={() => setIsOpen(false)} aria-label="Close cart" style={{
            border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "var(--color-muted)",
          }}>×</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "var(--space)" }}>
          {lineItems.length === 0 ? (
            <p style={{ color: "var(--color-muted)" }}>Your cart is empty.</p>
          ) : lineItems.map((item) => (
            <div key={item.id} style={{
              display: "flex", gap: 12, padding: "12px 0",
              borderBottom: "1px solid var(--color-border)",
            }}>
              <img src={item.image?.url} alt={item.productName?.original} style={{
                width: 64, height: 64, objectFit: "cover", borderRadius: "var(--radius-sm)",
                background: "var(--color-surface)",
              }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600 }}>{item.productName?.original}</span>
                {item.descriptionLines?.map((dl, i) => (
                  <small key={i} style={{ color: "var(--color-muted)" }}>
                    {dl.name?.original}: {dl.plainText?.original || dl.colorInfo?.original}
                  </small>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <QtyButton onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}>−</QtyButton>
                  <span style={{ minWidth: 20, textAlign: "center" }}>{item.quantity}</span>
                  <QtyButton onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</QtyButton>
                  <button onClick={() => removeItem(item.id)} style={{
                    marginLeft: "auto", border: "none", background: "none", cursor: "pointer",
                    color: "var(--color-muted)", fontSize: 13, textDecoration: "underline",
                  }}>Remove</button>
                </div>
              </div>
              <span style={{ fontWeight: 600 }}>{item.price?.formattedAmount}</span>
            </div>
          ))}
        </div>

        {lineItems.length > 0 && (
          <footer style={{ padding: "var(--space)", borderTop: "1px solid var(--color-border)" }}>
            <button disabled={loading} onClick={checkout} style={{
              width: "100%", padding: "12px", cursor: loading ? "wait" : "pointer",
              background: "var(--color-primary)", color: "var(--color-on-primary)",
              border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}>Checkout</button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function QtyButton({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 28, height: 28, cursor: "pointer", lineHeight: 1,
      background: "var(--color-surface)", color: "var(--color-text)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
    }}>{children}</button>
  );
}
