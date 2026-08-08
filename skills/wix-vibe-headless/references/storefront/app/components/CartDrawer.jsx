// Slide-over cart. Reads everything from useCart(); mutate by lineItem.id (NOT catalogItemId),
// check out via the context (redirect-session URL). Styled with base44 design tokens (shadcn Tailwind classes).
import { useCart } from "@/context/CartContext";

export default function CartDrawer() {
  const { cart, isOpen, setIsOpen, removeItem, updateQuantity, checkout, loading } = useCart();
  const lineItems = cart?.lineItems ?? [];
  if (!isOpen) return null;

  return (
    <div onClick={() => setIsOpen(false)} className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <aside onClick={(e) => e.stopPropagation()}
        className="w-[min(420px,100%)] h-full flex flex-col bg-background text-foreground border-l border-border font-body">
        <header className="flex justify-between items-center p-4 border-b border-border">
          <strong className="font-display">Your cart</strong>
          <button onClick={() => setIsOpen(false)} aria-label="Close cart"
            className="border-none bg-transparent cursor-pointer text-xl text-muted-foreground">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {lineItems.length === 0 ? (
            <p className="text-muted-foreground">Your cart is empty.</p>
          ) : lineItems.map((item) => (
            <div key={item.id} className="flex gap-3 py-3 px-0 border-b border-border">
              <img src={item.image?.url} alt={item.productName?.original}
                className="w-16 h-16 object-cover rounded-sm bg-card" />
              <div className="flex-1 flex flex-col gap-1">
                <span className="font-semibold">{item.productName?.original}</span>
                {item.descriptionLines?.map((dl, i) => (
                  <small key={i} className="text-muted-foreground">
                    {dl.name?.original}: {dl.plainText?.original || dl.colorInfo?.original}
                  </small>
                ))}
                <div className="flex items-center gap-2 mt-1">
                  <QtyButton onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}>−</QtyButton>
                  <span className="min-w-5 text-center">{item.quantity}</span>
                  <QtyButton onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</QtyButton>
                  <button onClick={() => removeItem(item.id)}
                    className="ml-auto border-none bg-transparent cursor-pointer text-muted-foreground text-[13px] underline">Remove</button>
                </div>
              </div>
              <span className="font-semibold">{item.price?.formattedAmount}</span>
            </div>
          ))}
        </div>

        {lineItems.length > 0 && (
          <footer className="p-4 border-t border-border">
            <button disabled={loading} onClick={checkout}
              className={`w-full p-3 bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold ${loading ? "cursor-wait opacity-60" : "cursor-pointer opacity-100"}`}>Checkout</button>
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
