// Item detail modal — thin view over useItemOrder (all add-to-cart logic lives in the hook). Shows
// the dish's image, description, price/variants, and modifier groups (name + rule + each modifier's
// up-charge / stock), a quantity stepper, and an add-to-cart button. Modifier groups are shown for
// the diner's information only — the shipped addItemToCart does not send selections (see the hook).
// Token-styled; re-skin via theme.css. Pass the item plus the { menuId, sectionId } it was shown under.
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
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 60,
      background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(560px, 100%)", maxHeight: "92vh", overflowY: "auto",
        background: "var(--color-bg)", color: "var(--color-text)",
        borderTopLeftRadius: "var(--radius)", borderTopRightRadius: "var(--radius)",
        fontFamily: "var(--font-body)",
      }}>
        {image && (
          <div style={{ aspectRatio: "16 / 9", background: "var(--color-surface)" }}>
            <img src={image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}
        <div style={{ padding: "var(--space)", display: "flex", flexDirection: "column", gap: "var(--space)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>{item.name}</h2>
            <button onClick={onClose} aria-label="Close" style={{
              border: "none", background: "none", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "var(--color-muted)",
            }}>×</button>
          </div>
          {item.description && <p style={{ margin: 0, color: "var(--color-muted)", lineHeight: 1.55 }}>{item.description}</p>}

          {/* price: single string OR one-of variants — neither carries a currency symbol */}
          {item.price != null
            ? <p style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{formatPrice(item.price)}</p>
            : item.variants?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {item.variants.map((v) => (
                    <span key={v.variantId}>{v.name}: <strong>{formatPrice(v.price)}</strong></span>
                  ))}
                </div>
              )}

          {/* modifier groups — displayed for the diner; selections are not sent by the shipped add-to-cart */}
          {item.modifierGroups?.map((group) => (
            <div key={group.id} style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space)" }}>
              <h4 style={{ margin: "0 0 8px", fontFamily: "var(--font-display)" }}>
                {group.name}
                {group.rule?.required && <span style={{ color: "var(--color-accent)", fontSize: 13 }}> · required</span>}
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {group.modifiers.map((m) => (
                  <div key={m.id} style={{ display: "flex", justifyContent: "space-between", color: m.inStock ? "var(--color-text)" : "var(--color-muted)" }}>
                    <span>{m.name}{!m.inStock && " (sold out)"}</span>
                    {m.additionalCharge && m.additionalCharge !== "0" && <span>+{formatPrice(m.additionalCharge)}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
            <input type="number" min={1} value={d.quantity}
              onChange={(e) => d.setQuantity(Math.max(1, Number(e.target.value) || 1))}
              style={{
                width: 72, padding: "10px", textAlign: "center",
                border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
                background: "var(--color-bg)", color: "var(--color-text)",
              }} />
            <button disabled={!d.canAdd} onClick={d.submit} style={{
              flex: 1, padding: "12px 24px", cursor: d.canAdd ? "pointer" : "not-allowed",
              background: "var(--color-primary)", color: "var(--color-on-primary)",
              border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
              opacity: d.canAdd ? 1 : 0.5,
            }}>
              {!d.ordering ? "Ordering unavailable" : d.inStock ? (d.adding ? "Adding…" : "Add to order") : "Sold out"}
            </button>
          </div>
          {d.error && <p style={{ margin: 0, color: "var(--color-danger)", fontSize: 14 }}>{d.error}</p>}
        </div>
      </div>
    </div>
  );
}
