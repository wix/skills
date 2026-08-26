// The full product detail surface: gallery, price, option/modifier picker, quantity,
// add-to-cart. Mount as-is (Astro: an island with the server-fetched `initial` product;
// SPA: pass the `slug`). All selection→variant logic lives in useProductDetail — never
// bypass it to add a product with options.
import { useState } from "react";
import { useProductDetail } from "../../hooks/storefront/useProductDetail";
import type { ProductDetail } from "../../wix/storefront/types";
import VariantPicker from "./VariantPicker";

export interface ProductDetailViewProps {
  /** Server-fetched product (Astro/Next SSR). */
  initial?: ProductDetail | null;
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

  if (notFound) return <p className="sf-empty">This product doesn't exist (anymore).</p>;
  if (!product) return <div className="sf-skeleton" style={{ maxWidth: 480 }} />;

  const soldOut = product.availability === "OUT_OF_STOCK" && !product.preorder;
  const mainImage = product.gallery[imageIndex] ?? product.imageUrl;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 40 }}>
      <div>
        <div className="sf-card-media">
          {mainImage && <img src={mainImage} alt={product.name} />}
        </div>
        {product.gallery.length > 1 && (
          <div className="sf-chips" style={{ marginTop: 12 }}>
            {product.gallery.map((url, i) => (
              <button
                key={url}
                type="button"
                className={i === imageIndex ? "sf-swatch sf-on" : "sf-swatch"}
                style={{ backgroundImage: `url(${url})`, backgroundSize: "cover", width: 56, height: 56, borderRadius: 8 }}
                aria-label={`Image ${i + 1}`}
                onClick={() => setImageIndex(i)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h1 style={{ marginTop: 0 }}>{product.name}</h1>
        <p className="sf-card-price" style={{ fontSize: 20 }}>
          <span>{price}</span>
          {compareAtPrice && <span className="sf-compare">{compareAtPrice}</span>}
        </p>
        {soldOut && <p className="sf-error">Out of stock</p>}
        {product.preorder && <p className="sf-card-options">Available for pre-order</p>}

        {product.descriptionHtml && (
          // plainDescription is HTML (despite the name) — render it, don't print it.
          <div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
        )}

        <VariantPicker
          optionGroups={optionGroups}
          selectOption={selectOption}
          modifiers={product.modifiers}
          modifierValues={modifierValues}
          setModifier={setModifier}
        />

        {!soldOut && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
            <div className="sf-qty">
              <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
                −
              </button>
              <span>{quantity}</span>
              <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)}>
                +
              </button>
            </div>
            <button type="button" className="sf-btn" disabled={!canAdd || adding} onClick={() => add().catch(() => {})}>
              {adding ? "Adding…" : canAdd ? "Add to cart" : "Select options"}
            </button>
          </div>
        )}
        {error && <p className="sf-error">{error}</p>}
      </div>
    </div>
  );
}
