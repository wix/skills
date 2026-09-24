// The card's purchase control — the three gallery purchase paths, decided from the product:
//   • no options            → Direct Add: one click, the cheapest variant, quantity 1
//   • options / choice mods → Quick Add: a picker on the card (bottom sheet on small screens)
//   • free-text modifier    → the product page (the gallery can't collect the text)
// Mount inside a `relative` card:  <QuickAdd product={product} />   Wire as-is; base44 tokens.
import { useEffect, useRef, useState } from "react";
import { Link } from "@/lib/nav";
import { useCart } from "@/context/CartContext";
import { useProductCard } from "@/hooks/useProductCard";
import { useProductDetail } from "@/hooks/useProductDetail";
import { useVariantOptions } from "@/hooks/useVariantOptions";

export default function QuickAdd({ product }) {
  const { addToCart, loading } = useCart();
  const { isSoldOut, isPreorder, isQuickAddable, directAddVariantId } = useProductCard(product);
  const [open, setOpen] = useState(false);
  const mandatoryModifier = (product?.modifiers ?? []).some((m) => m.mandatory);
  const hasText = (product?.modifiers ?? []).some((m) => m.modifierRenderType === "FREE_TEXT");

  if (isSoldOut && !isPreorder) return <span className="text-sm text-muted-foreground">Out of stock</span>;
  if (hasText) {
    return (
      <Link to={`/product/${product.slug}`} className="block w-full rounded-full border border-foreground py-2 text-center text-sm font-medium no-underline transition-colors hover:bg-foreground hover:text-background">
        Customize
      </Link>
    );
  }
  if (isQuickAddable && !mandatoryModifier) {
    return (
      <button type="button" disabled={loading} onClick={() => addToCart(product.id, directAddVariantId, 1)}
        className="w-full rounded-full border border-foreground py-2 text-sm font-medium transition-colors hover:bg-foreground hover:text-background disabled:opacity-50">
        Add to cart
      </button>
    );
  }
  // Options to pick, a mandatory choice modifier, or a pre-order: the picker resolves it through
  // useProductDetail, exactly as the PDP would.
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="w-full rounded-full border border-foreground py-2 text-sm font-medium transition-colors hover:bg-foreground hover:text-background">
        {product.options?.length ? "Choose options" : isPreorder ? "Pre-order" : "Add to cart"}
      </button>
      {open && <QuickAddPicker product={product} onClose={() => setOpen(false)} />}
    </>
  );
}

// The picker fetches the full product only when it opens — cards never carry PDP data.
function QuickAddPicker({ product, onClose }) {
  const d = useProductDetail(product.slug);
  const { optionGroups, modifierGroups } = useVariantOptions(d.options, d.modifiers, d.selectedOptions, d.modifierValues);
  const panelRef = useRef(null);

  // Overlay contract: Escape closes, scroll locks under md, focus moves in and back.
  useEffect(() => {
    const opener = document.activeElement;
    const isSmall = window.matchMedia("(max-width: 767px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (isSmall) document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  const submit = async () => {
    const result = await d.submit();
    if (result !== null) onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/40 md:hidden" onClick={onClose} />
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Choose options for ${product.name}`}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background p-5 text-foreground shadow-2xl outline-none md:absolute md:inset-x-0 md:bottom-0 md:max-h-none md:rounded-lg md:p-4">
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

        {d.error && <p className="text-sm text-muted-foreground">{d.error} <button type="button" className="underline" onClick={d.retry}>Retry</button></p>}
        {d.notFound && <p className="text-sm text-muted-foreground">This product isn't available anymore.</p>}
        {!d.product && !d.notFound && !d.error && <p className="text-sm text-muted-foreground">Loading options…</p>}

        {d.product && (
          <div className="flex flex-col gap-3">
            {optionGroups.map((g) => (
              <fieldset key={g.id}>
                <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.name}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {g.choices.map((c) => c.isColorSwatch ? (
                    <button key={c.choiceId} type="button" aria-label={c.name} title={c.name} aria-pressed={c.selected} disabled={!c.inStock}
                      onClick={() => d.selectOption(g.id, c.choiceId)}
                      className={`h-8 w-8 rounded-full border-2 disabled:opacity-30 ${c.selected ? "border-foreground" : "border-border"}`} style={{ backgroundColor: c.colorCode }} />
                  ) : (
                    <button key={c.choiceId} type="button" aria-pressed={c.selected} disabled={!c.inStock} onClick={() => d.selectOption(g.id, c.choiceId)}
                      className={`rounded-full border px-3 py-1 text-sm disabled:line-through disabled:opacity-40 ${c.selected ? "border-foreground bg-foreground text-background" : "border-border"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            {modifierGroups.filter((m) => m.type === "choices").map((m) => (
              <fieldset key={m.key}>
                <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.name}{m.mandatory ? " *" : ""}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {m.choices.map((c) => (
                    <button key={c.key} type="button" aria-pressed={c.selected} onClick={() => d.setModifier(m.key, c.key)}
                      className={`rounded-full border px-3 py-1 text-sm ${c.selected ? "border-foreground bg-foreground text-background" : "border-border"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            <button type="button" disabled={!d.canAdd || d.adding} onClick={submit}
              className="rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {d.adding ? "Adding…" : d.isPreorder ? "Pre-order" : "Add to cart"}
            </button>
            {d.blockedReason && !d.canAdd && <p className="text-xs text-muted-foreground">{d.blockedReason}</p>}
          </div>
        )}
      </section>
    </>
  );
}
