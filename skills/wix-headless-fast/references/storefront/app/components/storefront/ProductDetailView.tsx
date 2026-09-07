// The full product detail surface: gallery, price, option/modifier picker, quantity,
// add-to-cart — styled from the @theme tokens. Mount as-is (Astro: an island with the
// server-fetched `initial` product; SPA: pass the `slug`). All selection→variant logic lives
// in useProductDetail — never bypass it to add a product with options.
import { useState } from "react";
import { useProductDetail } from "../../hooks/storefront/useProductDetail";
import VariantPicker from "./VariantPicker";

export interface ProductDetailViewProps {
  /** Server-fetched product (Astro/Next SSR). */
  initial?: import("../../wix/storefront/types").ProductDetail | null;
  /** SPA alternative: fetch by slug on mount. */
  slug?: string;
}

export default function ProductDetailView({ initial, slug }: ProductDetailViewProps) {
  const {
    product,
    notFound,
    optionGroups,
    selectOption,
    modifierValues,
    setModifier,
    price,
    compareAtPrice,
    canAdd,
    quantity,
    setQuantity,
    add,
    adding,
    error,
  } = useProductDetail({ initial, slug });
  const [imageIndex, setImageIndex] = useState(0);

  if (notFound)
    return <p className="py-16 text-center text-muted-foreground">This product doesn't exist (anymore).</p>;
  if (!product) return <div className="aspect-square max-w-md animate-pulse rounded-xl bg-secondary" />;

  const soldOut = product.availability === "OUT_OF_STOCK" && !product.preorder;
  const mainImage = product.gallery[imageIndex] ?? product.imageUrl;

  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div>
        <div className="aspect-square overflow-hidden rounded-xl bg-secondary">
          {mainImage && <img src={mainImage} alt={product.name} className="h-full w-full object-cover" />}
        </div>
        {product.gallery.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {product.gallery.map((url, i) => (
              <button
                key={url}
                type="button"
                aria-label={`Image ${i + 1}`}
                onClick={() => setImageIndex(i)}
                className={`h-16 w-16 overflow-hidden rounded-md border-2 transition-colors ${
                  i === imageIndex ? "border-primary" : "border-transparent hover:border-border"
                }`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
        <p className="mt-2 flex items-baseline gap-3">
          <span className="text-xl font-medium">{price}</span>
          {compareAtPrice && <span className="text-base text-muted-foreground line-through">{compareAtPrice}</span>}
        </p>
        {soldOut && <p className="mt-2 text-sm font-medium text-red-600">Out of stock</p>}
        {product.preorder && <p className="mt-2 text-sm text-muted-foreground">Available for pre-order</p>}

        {product.descriptionHtml && (
          // plainDescription is HTML (despite the name) — render it, don't print it.
          <div
            className="mt-4 space-y-2 text-sm leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground"
            dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
          />
        )}

        <div className="mt-6">
          <VariantPicker
            optionGroups={optionGroups}
            selectOption={selectOption}
            modifiers={product.modifiers}
            modifierValues={modifierValues}
            setModifier={setModifier}
          />
        </div>

        {!soldOut && (
          <div className="mt-2 flex items-center gap-3">
            <div className="inline-flex items-center gap-3 rounded-full border border-border px-3 py-2">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity(quantity - 1)}
                className="px-1 text-base disabled:opacity-40"
              >
                −
              </button>
              <span className="text-sm tabular-nums">{quantity}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity(quantity + 1)}
                className="px-1 text-base"
              >
                +
              </button>
            </div>
            <button
              type="button"
              disabled={!canAdd || adding}
              onClick={() => add().catch(() => {})}
              className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {adding ? "Adding…" : canAdd ? "Add to cart" : "Select options"}
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
