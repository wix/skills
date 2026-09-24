// The card's purchase control — the three gallery purchase paths, decided from the product:
//   • no options            → Direct Add: one click, the cheapest variant, quantity 1
//   • options / choice mods → Quick Add: a picker on the card (bottom sheet on small screens)
//   • free-text modifier    → the product page (the gallery can't collect the text)
// Mount as the LAST ROW of the tile's text block (under name and price), as a direct child of the
// tile root that carries `relative` — the picker anchors to that root and takes its width. Never
// overlay it on the image, never wrap it in a narrower positioned box.
//   <QuickAdd product={p} />   Wire as-is; style via the tokens.
import { useEffect, useRef, useState } from "react";
import { useCart } from "../../hooks/storefront/useCart";
import { useProductDetail } from "../../hooks/storefront/useProductDetail";
import type { ProductSummary } from "../../wix/storefront/types";

export default function QuickAdd({ product }: { product: ProductSummary }) {
  const { addToCart, busy } = useCart();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (product.availability === "OUT_OF_STOCK" && !product.preorder) {
    return <span className="text-sm text-muted-foreground">Out of stock</span>;
  }
  if (product.quickAddable) {
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            addToCart(product.id, product.minPriceVariantId, 1).catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
          className="w-full rounded-full border border-foreground py-2 text-sm font-medium transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
        >
          {product.preorder ? "Pre-order" : "Add to cart"}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  // Options to pick, or a single variant that isn't plainly in stock (pre-order, partial stock):
  // the picker resolves it through useProductDetail, exactly as the PDP would.
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-full border border-foreground py-2 text-sm font-medium transition-colors hover:bg-foreground hover:text-background"
      >
        {product.optionsSummary ? "Choose options" : product.preorder ? "Pre-order" : "Add to cart"}
      </button>
      {open && <QuickAddPicker product={product} onClose={() => setOpen(false)} />}
    </>
  );
}

// The picker fetches the full product only when it opens — cards never carry PDP data.
function QuickAddPicker({ product, onClose }: { product: ProductSummary; onClose: () => void }) {
  const d = useProductDetail({ slug: product.slug });
  const panelRef = useRef<HTMLElement>(null);

  // Overlay contract: Escape closes, scroll locks under md, focus moves in and back.
  useEffect(() => {
    const opener = document.activeElement;
    const isSmall = window.matchMedia("(max-width: 767px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (isSmall) document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  const needsPdp = (d.product?.modifiers ?? []).some((m) => m.type === "text");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/40 md:hidden" onClick={onClose} />
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Choose options for ${product.name}`}
        // md+: anchored to the tile (its nearest `relative` ancestor), the tile's full width — and never
        // narrower than 18rem even when mounted inside a small wrapper.
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background p-5 text-foreground shadow-2xl outline-none md:absolute md:inset-x-auto md:bottom-0 md:right-0 md:w-[max(100%,18rem)] md:max-h-none md:rounded-lg md:p-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{product.name}</p>
            <p className="text-sm">
              {d.price}
              {d.compareAtPrice && <span className="ml-2 text-muted-foreground line-through">{d.compareAtPrice}</span>}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-xl leading-none text-muted-foreground">×</button>
        </div>

        {!d.product && !d.notFound && <p className="text-sm text-muted-foreground">Loading options…</p>}
        {d.notFound && <p className="text-sm text-muted-foreground">This product isn't available anymore.</p>}

        {d.product && needsPdp && (
          <a href={`/products/${product.slug}`} className="block rounded-full bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground">
            Customize on the product page
          </a>
        )}

        {d.product && !needsPdp && (
          <div className="flex flex-col gap-3">
            {d.optionGroups.map((g) => (
              <fieldset key={g.id}>
                <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.name}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {g.choices.map((c) =>
                    g.isColor && c.colorCode ? (
                      <button key={c.choiceId} type="button" aria-label={c.name} title={c.name} aria-pressed={c.selected}
                        disabled={!c.inStock} onClick={() => d.selectOption(g.name, c.name)}
                        className={`h-8 w-8 rounded-full border-2 disabled:opacity-30 ${c.selected ? "border-foreground" : "border-border"}`}
                        style={{ backgroundColor: c.colorCode }} />
                    ) : (
                      <button key={c.choiceId} type="button" aria-pressed={c.selected} disabled={!c.inStock}
                        onClick={() => d.selectOption(g.name, c.name)}
                        className={`rounded-full border px-3 py-1 text-sm disabled:line-through disabled:opacity-40 ${c.selected ? "border-foreground bg-foreground text-background" : "border-border"}`}>
                        {c.name}
                      </button>
                    ),
                  )}
                </div>
              </fieldset>
            ))}
            {d.product.modifiers.filter((m) => m.type === "choices").map((m) => (
              <fieldset key={m.key}>
                <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {m.name}{m.mandatory ? " *" : ""}
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {m.choices.map((c) => (
                    <button key={c.key} type="button" aria-pressed={d.modifierValues[m.key] === c.key}
                      onClick={() => d.setModifier(m.key, c.key)}
                      className={`rounded-full border px-3 py-1 text-sm ${d.modifierValues[m.key] === c.key ? "border-foreground bg-foreground text-background" : "border-border"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            <button
              type="button"
              disabled={!d.canAdd || d.adding}
              onClick={() => d.add().then(onClose).catch(() => {})}
              className="rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {d.adding ? "Adding…" : d.isPreorder ? "Pre-order" : "Add to cart"}
            </button>
            {d.blockedReason && !d.canAdd && <p className="text-xs text-muted-foreground">{d.blockedReason}</p>}
            {d.error && <p className="text-xs text-red-600">{d.error}</p>}
          </div>
        )}
      </section>
    </>
  );
}
