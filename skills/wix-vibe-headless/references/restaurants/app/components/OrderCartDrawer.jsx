// Slide-over order cart. Reads everything from useOrderCart(); mutate by lineItem.id (NOT the menu
// item id), check out via the context (redirect-session URL). The eCom Cart V2 line price is
// `pricing.totalPrice`, a ConvertedMoney { amount, convertedAmount } with NO formatted string —
// format it with the cart's currency (formatCartMoney below). Styled with base44 design tokens
// (shadcn Tailwind classes). Mount it once in the Layout.
import { useOrderCart } from "@/context/OrderCartContext";

// Cart V2 money is a ConvertedMoney { amount, convertedAmount } with NO formatted string — format it
// with the cart's currency (buyer's display currency when present, else the site currency).
function formatCartMoney(money, cart) {
  const value = money?.convertedAmount ?? money?.amount;
  const currency = cart?.customerInfo?.currencyCode ?? cart?.businessInfo?.currencyCode ?? "USD";
  return value == null ? "" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
}

export default function OrderCartDrawer() {
  const { cart, isOpen, setIsOpen, removeItem, updateQuantity, checkout, loading } = useOrderCart();
  const lineItems = cart?.lineItems ?? [];
  if (!isOpen) return null;

  return (
    <div onClick={() => setIsOpen(false)} className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <aside onClick={(e) => e.stopPropagation()}
        className="w-[min(420px,100%)] h-full flex flex-col bg-background text-foreground border-l border-border font-body">
        <header className="flex justify-between items-center p-4 border-b border-border">
          <strong className="font-display">Your order</strong>
          <button onClick={() => setIsOpen(false)} aria-label="Close order"
            className="border-none bg-transparent cursor-pointer text-xl text-muted-foreground">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {lineItems.length === 0 ? (
            <p className="text-muted-foreground">Your order is empty.</p>
          ) : lineItems.map((line) => {
            const qty = line.quantityInfo?.confirmedQuantity;
            return (
            <div key={line.id} className="flex gap-3 py-3 border-b border-border">
              {/* line.id is the lineItemId for mutations — NOT the menu item id */}
              <div className="flex-1 flex flex-col gap-1">
                <span className="font-semibold">{line.name?.original}</span>
                <div className="flex items-center gap-2 mt-1">
                  <QtyButton onClick={() => updateQuantity(line.id, Math.max(1, qty - 1))}>−</QtyButton>
                  <span className="min-w-[20px] text-center">{qty}</span>
                  <QtyButton onClick={() => updateQuantity(line.id, qty + 1)}>+</QtyButton>
                  <button onClick={() => removeItem(line.id)}
                    className="ml-auto border-none bg-transparent cursor-pointer text-muted-foreground text-[13px] underline">Remove</button>
                </div>
              </div>
              {/* Cart V2 has no formatted string — format the ConvertedMoney client-side */}
              <span className="font-semibold">{formatCartMoney(line.pricing?.totalPrice, cart)}</span>
            </div>
            );
          })}
        </div>

        {lineItems.length > 0 && (
          <footer className="p-4 border-t border-border">
            <button disabled={loading} onClick={checkout}
              className="w-full p-3 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold disabled:opacity-60 disabled:cursor-wait">Checkout</button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function QtyButton({ children, onClick }) {
  return (
    <button onClick={onClick}
      className="w-7 h-7 cursor-pointer leading-none bg-card text-foreground border border-border rounded-sm">{children}</button>
  );
}
