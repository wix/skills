// The purchase controls for one product — option groups (swatches for a color option, pills
// otherwise, out-of-stock choices disabled), choice modifiers, an optional quantity stepper, and
// the buy button gated by the hook: disabled with a plain reason ("Choose Size") until every
// choice is made, "Pre-order" when the resolved variant is pre-orderable, the hook's error inline.
// QuickAdd's picker and your product page mount the same component, so buying behaves the same
// in the gallery and on the PDP. Wire as-is; style via the tokens.
//
//   const d = useProductDetail({ initial });            // the PDP
//   <OptionPicker detail={d} showQuantity />
//
// Price, name, gallery, description, and layout stay yours — render d.price / d.compareAtPrice
// beside this (the range until every option is picked, then the variant's price).
import type { UseProductDetail } from "../../hooks/storefront/useProductDetail";

export default function OptionPicker({
  detail: d,
  showQuantity = false,
  onAdded,
}: {
  detail: UseProductDetail;
  /** The PDP shows a quantity stepper; a tile picker adds one. */
  showQuantity?: boolean;
  /** Called after a successful add (a tile picker closes itself here). */
  onAdded?: () => void;
}) {
  if (!d.product) return null;
  return (
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
      {d.product.modifiers.filter((m) => m.type === "text").map((m) => (
        <label key={m.key} className="flex flex-col gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {m.name}{m.mandatory ? " *" : ""}
          <input type="text" value={d.modifierValues[m.key] ?? ""} onChange={(e) => d.setModifier(m.key, e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground" />
        </label>
      ))}
      <div className="flex items-stretch gap-2">
        {showQuantity && (
          <div className="flex items-center rounded-full border border-border">
            <button type="button" aria-label="Decrease quantity" disabled={d.quantity <= 1} onClick={() => d.setQuantity(d.quantity - 1)}
              className="px-3 py-2 text-sm disabled:opacity-40">−</button>
            <span className="min-w-6 text-center text-sm tabular-nums">{d.quantity}</span>
            <button type="button" aria-label="Increase quantity" onClick={() => d.setQuantity(d.quantity + 1)} className="px-3 py-2 text-sm">+</button>
          </div>
        )}
        <button
          type="button"
          disabled={!d.canAdd || d.adding}
          onClick={() => d.add().then(() => onAdded?.()).catch(() => {})}
          className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {d.adding ? "Adding…" : d.isPreorder ? "Pre-order" : "Add to cart"}
        </button>
      </div>
      {d.blockedReason && !d.canAdd && <p className="text-xs text-muted-foreground">{d.blockedReason}</p>}
      {d.error && <p className="text-xs text-red-600">{d.error}</p>}
    </div>
  );
}
