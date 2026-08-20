// Slide-over cart. Reads everything from useCart(); mutate by lineItem.id (NOT catalogItemId),
// check out via the context (redirect-session URL). Styled with base44 design tokens (shadcn Tailwind classes).
//
// Load-bearing beyond the styling:
// • prices come from the SERVER cart. In Cart V2 each line total is `pricing.totalPrice`, a
//   ConvertedMoney { amount, convertedAmount } with NO formatted string — format it yourself with the
//   cart's currency (see formatCartMoney). Never compute a total in the client: tax, shipping and
//   promotions are resolved server-side, so the cart's `subtotal` is the only figure safe to show
//   pre-checkout. The V2 cart has no `subtotalAfterDiscounts`/`discount`/`appliedDiscounts` — the
//   discounted total comes from a currentCartV2 estimate/calculate `summary.priceSummary`, not the
//   cart; absent that call, show the raw `subtotal`.
// • `quantityInfo.availableQuantity` caps the stepper, so exceeding stock is refused here rather than
//   at checkout.
// • `status` is flagged per line here because checkout() refuses the whole cart when any item isn't
//   IN_STOCK — showing it on the row is what makes that refusal understandable.
import { useEffect } from "react";
import { useCart } from "@/context/CartContext";
import { storeImage } from "@/lib/storeImage";

// Cart V2 money is a ConvertedMoney { amount, convertedAmount } with NO formatted string — format it
// with the cart's currency (buyer's display currency when present, else the site currency).
function formatCartMoney(money, cart) {
  const value = money?.convertedAmount ?? money?.amount;
  const currency = cart?.customerInfo?.currencyCode ?? cart?.businessInfo?.currencyCode ?? "USD";
  return value == null ? "" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
}

export default function CartDrawer() {
  const { cart, isOpen, setIsOpen, removeItem, updateQuantity, checkout, loading, error, clearError } = useCart();
  const lineItems = cart?.lineItems ?? [];
  // The V2 cart carries only a raw `subtotal` (ConvertedMoney); discounted totals live on an
  // estimate/calculate `summary.priceSummary`, which this cart helper doesn't fetch — so show `subtotal`.
  const subtotal = formatCartMoney(cart?.subtotal, cart);
  const unavailable = lineItems.filter((li) => li.status && li.status !== "IN_STOCK");

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
            const image = storeImage(item.attributes?.image?.url);
            const paid = formatCartMoney(item.pricing?.totalPrice, cart);
            const isOut = item.status && item.status !== "IN_STOCK";
            const stock = item.quantityInfo?.availableQuantity;
            const qty = item.quantityInfo?.confirmedQuantity;
            const atStockLimit = Number.isFinite(stock) && qty >= stock;
            return (
              <div key={item.id} className="flex gap-3 py-3 px-0 border-b border-border">
                <div className="w-16 h-16 shrink-0 rounded-sm bg-card overflow-hidden">
                  {image && <img src={image} alt={item.name?.original || ""} className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <span className="font-semibold truncate">{item.name?.original}</span>
                  {/* V2 nests these under `attributes` — a top-level lineItem.descriptionLines no longer exists */}
                  {item.attributes?.descriptionLines?.map((dl, i) => (
                    <small key={i} className="text-muted-foreground">
                      {dl.name?.original}: {dl.plainText?.original || dl.colorInfo?.original}
                    </small>
                  ))}
                  {isOut ? (
                    <small className="text-destructive">
                      {item.status === "PARTIALLY_IN_STOCK" ? "Not enough stock" : "No longer available"}
                    </small>
                  ) : atStockLimit ? (
                    <small className="text-muted-foreground">Only {stock} left</small>
                  ) : null}
                  <div className="flex items-center gap-2 mt-1">
                    <QtyButton disabled={loading || qty <= 1} label="Decrease quantity"
                      onClick={() => updateQuantity(item.id, qty - 1)}>−</QtyButton>
                    <span className="min-w-5 text-center" aria-label={`Quantity ${qty}`}>{qty}</span>
                    <QtyButton disabled={loading || atStockLimit} label="Increase quantity"
                      onClick={() => updateQuantity(item.id, qty + 1)}>+</QtyButton>
                    <button onClick={() => removeItem(item.id)} disabled={loading}
                      className="ml-auto border-none bg-transparent cursor-pointer text-muted-foreground text-[13px] underline disabled:opacity-50">Remove</button>
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <span className="font-semibold">{paid}</span>
                </div>
              </div>
            );
          })}
        </div>

        {lineItems.length > 0 && (
          <footer className="p-4 border-t border-border flex flex-col gap-3">
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
