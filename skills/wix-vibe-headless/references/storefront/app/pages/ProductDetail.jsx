// PDP — thin view over useProductDetail (all logic lives in the hook). plainDescription is HTML
// despite the name; render via dangerouslySetInnerHTML. Styled with base44 design tokens (shadcn Tailwind classes).
//
// The price shown follows the selection: once options resolve to a variant the hook returns that
// variant's price, so a picked size can cost more than the "from" figure the grid tile showed.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useProductDetail } from "@/hooks/useProductDetail";
import { productGallery } from "@/lib/storeImage";
import ProductGallery from "@/components/ProductGallery";
import VariantPicker from "@/components/VariantPicker";

export default function ProductDetail() {
  const { slug } = useParams();
  const d = useProductDetail(slug);
  // Memoised so the gallery keeps its selected image across re-renders (see ProductGallery).
  const images = useMemo(() => productGallery(d.product), [d.product]);

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

  const compareAt = d.product?.compareAtPriceRange?.minValue?.formattedAmount;

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link to="/shop" className="text-muted-foreground hover:text-foreground">Shop</Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{d.product.name}</span>
      </nav>

      <div className="grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <ProductGallery images={images} name={d.product.name} focusUrl={d.focusMediaUrl} />

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

          <div className="flex items-stretch gap-3 mt-4">
            <QuantityStepper value={d.quantity} onChange={d.setQuantity} disabled={!d.inStock} />
            <button disabled={!d.canAdd || d.adding} onClick={d.submit}
              className="flex-1 h-12 px-6 bg-primary text-primary-foreground border-none rounded-md text-[15px] font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
              {d.adding ? "Adding…" : d.inStock ? "Add to cart" : "Out of stock"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// Segmented −/+ stepper, height-matched to the Add-to-cart button so the row reads as one control.
// A native number input is avoided on purpose: its spinners are ~10px, OS-rendered (so they ignore
// the app's tokens), effectively untappable, and they accept "e"/"+"/"1e5" plus scroll-wheel edits.
// The value stays typeable — inputMode="numeric" brings up a keypad — but only digits survive, and
// blur restores 1 when the field is left empty. `tabular-nums` keeps the width steady across digits.
function QuantityStepper({ value, onChange, disabled }) {
  const set = (n) => onChange(Math.max(1, n));
  return (
    <div data-disabled={disabled || undefined}
      className="inline-flex items-stretch h-12 rounded-md border border-input bg-background overflow-hidden data-[disabled]:opacity-50">
      <StepButton label="Decrease quantity" disabled={disabled || value <= 1} onClick={() => set(value - 1)}>−</StepButton>
      <label className="sr-only" htmlFor="pdp-qty">Quantity</label>
      <input id="pdp-qty" type="text" inputMode="numeric" autoComplete="off" disabled={disabled}
        value={value} aria-live="polite"
        onChange={(e) => { const n = e.target.value.replace(/\D/g, ""); onChange(n === "" ? "" : Math.max(1, Number(n))); }}
        onBlur={(e) => { if (!e.target.value) set(1); }}
        className="w-12 text-center bg-transparent text-foreground font-semibold tabular-nums border-x border-input outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed" />
      <StepButton label="Increase quantity" disabled={disabled} onClick={() => set(Number(value || 0) + 1)}>+</StepButton>
    </div>
  );
}

function StepButton({ children, label, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className="w-11 grid place-items-center text-lg leading-none text-muted-foreground bg-transparent border-none cursor-pointer transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
      {children}
    </button>
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
