// Slide-over cart with quantity stepper, remove, live subtotal, and Wix-hosted checkout.
// Mount ONCE per page, as-is; opens via useCart().openCart() / CartButton. Styled from the
// @theme tokens.
import { useEffect, useRef } from "react";
import { useCart } from "../../hooks/storefront/useCart";

export default function CartDrawer() {
  const { cart, open, closeCart, busy, error, updateQuantity, removeLine, checkout } = useCart();

  // The overlay contract, done here rather than assumed from CSS: Escape closes (the backdrop
  // click is pointer-only), the page behind stops scrolling, focus moves into the panel on open
  // and returns to whatever opened it on close. Hooks run before the early return below.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeCart();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, closeCart]);

  if (!open) return null;
  const lines = cart?.lines ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-foreground/40 backdrop-blur-[2px]"
      onClick={closeCart}
    >
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Cart"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-background text-foreground shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <span className="text-base font-semibold">
            Cart{cart && cart.itemCount > 0 ? ` (${cart.itemCount})` : ""}
          </span>
          <button
            type="button"
            aria-label="Close cart"
            onClick={closeCart}
            className="text-xl leading-none text-muted-foreground transition-colors hover:text-foreground"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {lines.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">Your cart is empty.</p>
          )}
          {lines.map((line) => (
            <div className="mb-6 flex gap-4" key={line.lineItemId}>
              {line.imageUrl ? (
                <img
                  src={line.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 flex-shrink-0 rounded-md bg-secondary object-cover"
                />
              ) : (
                <div aria-hidden="true" className="h-16 w-16 flex-shrink-0 rounded-md bg-secondary" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{line.productName}</p>
                {line.descriptionLines.map((d) => (
                  <p className="mt-0.5 text-xs text-muted-foreground" key={d}>
                    {d}
                  </p>
                ))}
                {line.status !== "IN_STOCK" && (
                  <p className="mt-1 text-xs text-red-600">No longer available at this quantity</p>
                )}
                <div className="mt-2 flex items-center">
                  <div className="inline-flex items-center gap-3 rounded-full border border-border px-2 py-0.5">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      disabled={busy || line.quantity <= 1}
                      onClick={() => updateQuantity(line.lineItemId, line.quantity - 1).catch(() => {})}
                      className="px-1 text-base disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="text-sm tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      disabled={busy}
                      onClick={() => updateQuantity(line.lineItemId, line.quantity + 1).catch(() => {})}
                      className="px-1 text-base disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeLine(line.lineItemId).catch(() => {})}
                    className="ml-3 text-xs text-muted-foreground underline transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="text-sm font-medium">{line.linePrice}</p>
            </div>
          ))}
        </div>

        {lines.length > 0 && (
          <div className="border-t border-border px-6 py-5">
            {cart?.discount && (
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span>−{cart.discount}</span>
              </div>
            )}
            {cart?.subtotal && (
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <strong className="font-semibold">{cart.subtotal}</strong>
              </div>
            )}
            <p className="mb-4 text-xs text-muted-foreground">Shipping and taxes are calculated at checkout.</p>
            {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => checkout().catch(() => {})}
              className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "One moment…" : "Continue to secure checkout"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
