// PDP — thin view over useProductDetail (all logic lives in the hook). plainDescription is HTML
// despite the name; render via dangerouslySetInnerHTML. Styled with base44 design tokens (shadcn Tailwind classes).
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
    <main className="max-w-[1200px] mx-auto p-4 grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <div className="aspect-square bg-card rounded-lg overflow-hidden">
        {image && <img src={image} alt={d.product.name} className="w-full h-full object-cover" />}
      </div>

      <div>
        <h1 className="font-display m-0 mb-2">{d.product.name}</h1>
        <p className="text-[22px] font-semibold m-0 mb-4">{d.price}</p>

        <div className="text-muted-foreground leading-relaxed mb-6"
          dangerouslySetInnerHTML={{ __html: d.product.plainDescription || "" }} />

        <VariantPicker
          options={d.options} modifiers={d.modifiers}
          selectedOptions={d.selectedOptions} selectOption={d.selectOption}
          modifierValues={d.modifierValues} setModifier={d.setModifier}
        />

        <div className="flex items-center gap-3 mt-4">
          <input type="number" min={1} value={d.quantity}
            onChange={(e) => d.setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="w-[72px] p-2.5 text-center border border-border rounded-sm bg-background text-foreground" />
          <button disabled={!d.canAdd} onClick={d.submit}
            className="flex-1 py-3 px-6 bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{d.inStock ? "Add to cart" : "Out of stock"}</button>
        </div>
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
