// Slide-over cart with quantity stepper, remove, live subtotal, and Wix-hosted checkout.
// Mount ONCE per page, as-is; opens via useCart().openCart() / CartButton.
import { useCart } from "../../hooks/storefront/useCart";

export default function CartDrawer() {
  const { cart, open, closeCart, busy, error, updateQuantity, removeLine, checkout } = useCart();
  if (!open) return null;
  const lines = cart?.lines ?? [];

  return (
    <div className="sf-overlay" onClick={closeCart}>
      <aside className="sf-drawer" role="dialog" aria-label="Cart" onClick={(e) => e.stopPropagation()}>
        <div className="sf-drawer-head">
          <span>Cart{cart && cart.itemCount > 0 ? ` (${cart.itemCount})` : ""}</span>
          <button type="button" className="sf-drawer-close" aria-label="Close cart" onClick={closeCart}>
            ×
          </button>
        </div>

        <div className="sf-drawer-items">
          {lines.length === 0 && <p className="sf-empty">Your cart is empty.</p>}
          {lines.map((line) => (
            <div className="sf-line" key={line.lineItemId}>
              {line.imageUrl ? (
                <img className="sf-line-img" src={line.imageUrl} alt="" loading="lazy" />
              ) : (
                <div className="sf-line-img" aria-hidden="true" />
              )}
              <div className="sf-line-body">
                <p className="sf-line-name">{line.productName}</p>
                {line.descriptionLines.map((d) => (
                  <p className="sf-line-desc" key={d}>
                    {d}
                  </p>
                ))}
                {line.status !== "IN_STOCK" && (
                  <p className="sf-line-warn">No longer available at this quantity</p>
                )}
                <div className="sf-qty">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={busy || line.quantity <= 1}
                    onClick={() => updateQuantity(line.lineItemId, line.quantity - 1).catch(() => {})}
                  >
                    −
                  </button>
                  <span>{line.quantity}</span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={busy}
                    onClick={() => updateQuantity(line.lineItemId, line.quantity + 1).catch(() => {})}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="sf-remove"
                  disabled={busy}
                  onClick={() => removeLine(line.lineItemId).catch(() => {})}
                >
                  Remove
                </button>
              </div>
              <p className="sf-line-price">{line.linePrice}</p>
            </div>
          ))}
        </div>

        {lines.length > 0 && (
          <div className="sf-drawer-foot">
            {cart?.subtotal && (
              <div className="sf-subtotal">
                <span>Subtotal</span>
                <strong>{cart.subtotal}</strong>
              </div>
            )}
            {error && <p className="sf-error">{error}</p>}
            <button
              type="button"
              className="sf-btn sf-btn-full"
              disabled={busy}
              onClick={() => checkout().catch(() => {})}
            >
              {busy ? "One moment…" : "Checkout"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
