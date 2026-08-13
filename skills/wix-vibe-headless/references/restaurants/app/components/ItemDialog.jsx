// Item detail modal — thin view over useItemOrder (all add-to-cart logic lives in the hook). Shows
// the dish's image, description, price/variants, and modifier groups (name + rule + each modifier's
// up-charge / stock), a quantity stepper, and an add-to-cart button. Modifier groups are shown for
// the diner's information only — the shipped addItemToCart does not send selections (see the hook).
// Styled with base44 design tokens (shadcn Tailwind classes). Pass the item plus the { menuId, sectionId } it was shown under.
import { useItemOrder } from "@/hooks/useItemOrder";

function imageUrl(img) {
  const url = img?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}
function formatPrice(price) {
  return price == null ? "" : `$${price}`; // swap "$" for the site's currency
}

export default function ItemDialog({ item, menuId, sectionId, onClose }) {
  const d = useItemOrder(item, { menuId, sectionId });
  if (!item) return null;
  const image = imageUrl(item.image);

  return (
    <div onClick={onClose} className="fixed inset-0 z-[60] bg-black/45 flex items-end justify-center">
      <div onClick={(e) => e.stopPropagation()}
        className="w-[min(560px,100%)] max-h-[92vh] overflow-y-auto bg-background text-foreground rounded-t-lg font-body">
        {image && (
          <div className="aspect-[16/9] bg-card">
            <img src={image} alt={item.name} className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-4 flex flex-col gap-4">
          <div className="flex justify-between items-start gap-3">
            <h2 className="m-0 font-display">{item.name}</h2>
            <button onClick={onClose} aria-label="Close"
              className="border-none bg-transparent cursor-pointer text-[22px] leading-none text-muted-foreground">×</button>
          </div>
          {item.description && <p className="m-0 text-muted-foreground leading-[1.55]">{item.description}</p>}

          {/* price: single string OR one-of variants — neither carries a currency symbol */}
          {item.price != null
            ? <p className="m-0 text-xl font-semibold">{formatPrice(item.price)}</p>
            : item.variants?.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {item.variants.map((v) => (
                    <span key={v.variantId}>{v.name}: <strong>{formatPrice(v.price)}</strong></span>
                  ))}
                </div>
              )}

          {/* modifier groups — displayed for the diner; selections are not sent by the shipped add-to-cart */}
          {item.modifierGroups?.map((group) => (
            <div key={group.id} className="border-t border-border pt-4">
              <h4 className="m-0 mb-2 font-display">
                {group.name}
                {group.rule?.required && <span className="text-primary text-[13px]"> · required</span>}
              </h4>
              <div className="flex flex-col gap-1">
                {group.modifiers.map((m) => (
                  <div key={m.id} className={`flex justify-between ${m.inStock ? "text-foreground" : "text-muted-foreground"}`}>
                    <span>{m.name}{!m.inStock && " (sold out)"}</span>
                    {m.additionalCharge && m.additionalCharge !== "0" && <span>+{formatPrice(m.additionalCharge)}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3 mt-1">
            <input type="number" min={1} value={d.quantity}
              onChange={(e) => d.setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="w-[72px] p-2.5 text-center border border-input rounded-sm bg-background text-foreground" />
            <button disabled={!d.canAdd} onClick={d.submit}
              className="flex-1 py-3 px-6 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              {!d.ordering ? "Ordering unavailable" : d.inStock ? (d.adding ? "Adding…" : "Add to order") : "Sold out"}
            </button>
          </div>
          {d.error && <p className="m-0 text-destructive text-sm">{d.error}</p>}
        </div>
      </div>
    </div>
  );
}
