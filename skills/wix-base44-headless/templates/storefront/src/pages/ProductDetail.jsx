// PDP — thin view over useProductDetail (all logic lives in the hook). plainDescription is HTML
// despite the name; render via dangerouslySetInnerHTML. Token-styled; re-skin via theme.css.
import { useParams } from "react-router-dom";
import { useProductDetail } from "@/hooks/useProductDetail";
import VariantPicker from "@/components/VariantPicker";

function productImage(product) {
  const url = product?.media?.main?.image?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function ProductDetail() {
  const { slug } = useParams();
  const d = useProductDetail(slug);

  if (d.notFound) return <Centered>Product not found.</Centered>;
  if (!d.product) return <Centered>Loading…</Centered>;

  const image = productImage(d.product);
  return (
    <main style={{
      maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)",
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "calc(var(--space) * 2)",
    }}>
      <div style={{
        aspectRatio: "1 / 1", background: "var(--color-surface)",
        borderRadius: "var(--radius)", overflow: "hidden",
      }}>
        {image && <img src={image} alt={d.product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>

      <div>
        <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px" }}>{d.product.name}</h1>
        <p style={{ fontSize: 22, fontWeight: 600, margin: "0 0 var(--space)" }}>{d.price}</p>

        <div style={{ color: "var(--color-muted)", lineHeight: 1.6, marginBottom: "calc(var(--space) * 1.5)" }}
          dangerouslySetInnerHTML={{ __html: d.product.plainDescription || "" }} />

        <VariantPicker
          options={d.options} modifiers={d.modifiers}
          selectedOptions={d.selectedOptions} selectOption={d.selectOption}
          modifierValues={d.modifierValues} setModifier={d.setModifier}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "var(--space)" }}>
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
          }}>{d.inStock ? "Add to cart" : "Out of stock"}</button>
        </div>
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
