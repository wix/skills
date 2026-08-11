// Slide-over cart. Reads everything from useCart(); mutate by lineItem.id (NOT catalogItemId),
// check out via the context (redirect-session URL). Styled with base44 design tokens (shadcn Tailwind classes).
//
// Load-bearing beyond the styling:
// • prices come from the SERVER cart — `price` is post-discount, `fullPrice` is before it, so the
//   two together are the strikethrough. Never compute a total in the client: tax, shipping and
//   promotions are resolved server-side, so `subtotal` is the only figure safe to show pre-checkout.
//   Money objects carry { amount, convertedAmount, formattedAmount, formattedConvertedAmount }; use a
//   formatted one so the currency symbol and grouping come from Wix. Prefer `subtotalAfterDiscounts`
//   over `subtotal` — the two are equal until a cart-level coupon applies, and then `subtotal` is the
//   pre-discount figure, which would quote the buyer more than they'll pay.
// • `availability.quantityAvailable` caps the stepper, so exceeding stock is refused here rather than
//   at checkout.
// • `availability.status` is flagged per line here because checkout() refuses the whole cart when
//   any item isn't AVAILABLE — showing it on the row is what makes that refusal understandable.
import { useEffect } from "react";
import { useCart } from "@/context/CartContext";
import { storeImage } from "@/lib/storeImage";

export default function CartDrawer() {
  const { cart, isOpen, setIsOpen, removeItem, updateQuantity, checkout, loading, error, clearError } = useCart();
  const lineItems = cart?.lineItems ?? [];
  const money = (m) => m?.formattedConvertedAmount || m?.formattedAmount;
  const subtotal = money(cart?.subtotalAfterDiscounts) || money(cart?.subtotal);
  const discount = money(cart?.discount);
  const hasDiscount = (cart?.appliedDiscounts?.length || 0) > 0 && Number(cart?.discount?.amount) > 0;
  const unavailable = lineItems.filter((li) => li.availability?.status && li.availability.status !== "AVAILABLE");

  // Escape closes the drawer while it's open — expected of anything modal, and the only way out for
  // keyboard users (the backdrop click is pointer-only).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, setIsOpen]);

  if (!isOpen) return null;

  return (
    <div onClick={() => setIsOpen(false)} className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <aside onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Your cart"
        className="w-[min(420px,100%)] h-full flex flex-col bg-background text-foreground border-l border-border font-body">
        <header className="flex justify-between items-center p-4 border-b border-border">
          <strong className="font-display">Your cart{lineItems.length ? ` (${lineItems.length})` : ""}</strong>
          <button onClick={() => setIsOpen(false)} aria-label="Close cart"
            className="border-none bg-transparent cursor-pointer text-xl text-muted-foreground">×</button>
        </header>

        {error && (
          <div role="alert" className="m-4 mb-0 p-3 rounded-sm border border-destructive/40 bg-destructive/10 text-sm">
            <div className="flex items-start gap-2">
              <span className="flex-1">{error}</span>
              <button onClick={clearError} aria-label="Dismiss"
                className="border-none bg-transparent cursor-pointer text-muted-foreground leading-none">×</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {lineItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-10">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="text-muted-foreground/40" aria-hidden="true">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
              <p className="m-0 text-muted-foreground">Your cart is empty.</p>
              <button onClick={() => setIsOpen(false)}
                className="border border-border bg-card text-foreground rounded-sm py-2 px-4 cursor-pointer text-sm">Continue shopping</button>
            </div>
          ) : lineItems.map((item) => {
            const image = storeImage(item.image?.url);
            const struck = item.fullPrice?.formattedAmount;
            const paid = item.price?.formattedAmount;
            const isOut = item.availability?.status && item.availability.status !== "AVAILABLE";
            const stock = item.availability?.quantityAvailable;
            const atStockLimit = Number.isFinite(stock) && item.quantity >= stock;
            return (
              <div key={item.id} className="flex gap-3 py-3 px-0 border-b border-border">
                <div className="w-16 h-16 shrink-0 rounded-sm bg-card overflow-hidden">
                  {image && <img src={image} alt={item.productName?.original || ""} className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <span className="font-semibold truncate">{item.productName?.original}</span>
                  {item.descriptionLines?.map((dl, i) => (
                    <small key={i} className="text-muted-foreground">
                      {dl.name?.original}: {dl.plainText?.original || dl.colorInfo?.original}
                    </small>
                  ))}
                  {isOut ? (
                    <small className="text-destructive">
                      {item.availability.status === "NOT_AVAILABLE" ? "No longer available" : "Not enough stock"}
                    </small>
                  ) : atStockLimit ? (
                    <small className="text-muted-foreground">Only {stock} left</small>
                  ) : null}
                  <div className="flex items-center gap-2 mt-1">
                    <QtyButton disabled={loading || item.quantity <= 1} label="Decrease quantity"
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}>−</QtyButton>
                    <span className="min-w-5 text-center" aria-label={`Quantity ${item.quantity}`}>{item.quantity}</span>
                    <QtyButton disabled={loading || atStockLimit} label="Increase quantity"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</QtyButton>
                    <button onClick={() => removeItem(item.id)} disabled={loading}
                      className="ml-auto border-none bg-transparent cursor-pointer text-muted-foreground text-[13px] underline disabled:opacity-50">Remove</button>
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <span className="font-semibold">{paid}</span>
                  {struck && struck !== paid && (
                    <span className="text-muted-foreground line-through text-[13px]">{struck}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {lineItems.length > 0 && (
          <footer className="p-4 border-t border-border flex flex-col gap-3">
            {hasDiscount && (
              <div className="flex justify-between items-baseline text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span>−{discount}</span>
              </div>
            )}
            {subtotal && (
              <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground">Subtotal</span>
                <strong className="text-[17px]">{subtotal}</strong>
              </div>
            )}
            <p className="m-0 text-[12px] text-muted-foreground">Shipping and taxes are calculated at checkout.</p>
            <button disabled={loading || unavailable.length > 0} onClick={checkout}
              className="w-full p-3 bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? "Working…" : unavailable.length > 0 ? "Remove unavailable items to continue" : "Checkout"}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function QtyButton({ children, onClick, disabled, label }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}
      className="w-7 h-7 cursor-pointer leading-none bg-card text-foreground border border-border rounded-sm disabled:opacity-40 disabled:cursor-not-allowed">{children}</button>
  );
}
