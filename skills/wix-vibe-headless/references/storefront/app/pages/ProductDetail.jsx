// PDP — thin view over useProductDetail (all logic lives in the hook). plainDescription is HTML
// despite the name; render via dangerouslySetInnerHTML. Styled with base44 design tokens (shadcn Tailwind classes).
//
// The price shown follows the selection: once options resolve to a variant the hook returns that
// variant's price, so a picked size can cost more than the "from" figure the grid tile showed.
import { Link, useParams } from "react-router-dom";
import { useProductDetail } from "@/hooks/useProductDetail";
import { productGallery } from "@/lib/storeImage";
import ProductGallery from "@/components/ProductGallery";
import VariantPicker from "@/components/VariantPicker";

export default function ProductDetail() {
  const { slug } = useParams();
  const d = useProductDetail(slug);

  if (d.error) {
    return (
      <Centered>
        <p className="m-0">{d.error}</p>
        <button onClick={d.retry} className="border border-border bg-card text-foreground rounded-sm py-2 px-4 cursor-pointer text-sm">Try again</button>
      </Centered>
    );
  }
  if (d.notFound) {
    return (
      <Centered>
        <p className="m-0">We couldn't find that product.</p>
        <Link to="/shop" className="text-primary">Back to shop</Link>
      </Centered>
    );
  }
  if (!d.product) return <ProductDetailSkeleton />;

  const images = productGallery(d.product);
  const compareAt = d.product?.compareAtPriceRange?.minValue?.formattedAmount;

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link to="/shop" className="text-muted-foreground hover:text-foreground">Shop</Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{d.product.name}</span>
      </nav>

      <div className="grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <ProductGallery images={images} name={d.product.name} />

        <div>
          <h1 className="font-display m-0 mb-2">{d.product.name}</h1>

          <div className="flex items-baseline gap-2 mb-4">
            <p className="text-[22px] font-semibold m-0">{d.price}</p>
            {compareAt && compareAt !== d.price && (
              <span className="text-muted-foreground line-through">{compareAt}</span>
            )}
          </div>

          {d.product.plainDescription && (
            <div className="text-muted-foreground leading-relaxed mb-6"
              dangerouslySetInnerHTML={{ __html: d.product.plainDescription }} />
          )}

          <VariantPicker
            options={d.options} modifiers={d.modifiers}
            selectedOptions={d.selectedOptions} selectOption={d.selectOption}
            modifierValues={d.modifierValues} setModifier={d.setModifier}
          />

          {/* Tell the buyer WHY the button is dead: an unresolvable combination reads as a broken page. */}
          {d.options.length > 0 && !d.variant && (
            <p className="text-[13px] text-muted-foreground m-0 mt-1">Pick an option from each list to continue.</p>
          )}

          <div className="flex items-center gap-3 mt-4">
            <label className="sr-only" htmlFor="pdp-qty">Quantity</label>
            <input id="pdp-qty" type="number" min={1} value={d.quantity}
              onChange={(e) => d.setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="w-[72px] p-2.5 text-center border border-border rounded-sm bg-background text-foreground" />
            <button disabled={!d.canAdd || d.adding} onClick={d.submit}
              className="flex-1 py-3 px-6 bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {d.adding ? "Adding…" : d.inStock ? "Add to cart" : "Out of stock"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function ProductDetailSkeleton() {
  return (
    <main className="max-w-[1200px] mx-auto p-4" aria-busy="true">
      <div className="grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <div className="aspect-square bg-muted rounded-lg animate-pulse" />
        <div className="flex flex-col gap-3">
          <div className="h-7 w-2/3 bg-muted rounded-sm animate-pulse" />
          <div className="h-6 w-24 bg-muted rounded-sm animate-pulse" />
          <div className="h-4 w-full bg-muted rounded-sm animate-pulse mt-3" />
          <div className="h-4 w-5/6 bg-muted rounded-sm animate-pulse" />
          <div className="h-11 w-full bg-muted rounded-sm animate-pulse mt-6" />
        </div>
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 flex flex-col items-center gap-3 text-center text-muted-foreground">{children}</div>;
}
