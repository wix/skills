// The purchase controls for one product — option groups (swatches for a color option, pills
// otherwise, choices unavailable WITH the current selection disabled), choice and free-text
// modifiers (with the merchant's character limit), the plan picker for a subscription product, an
// optional quantity stepper capped at the stock left, and the buy button gated by the hook:
// disabled with a plain reason ("Choose Size") until every choice is made, "Pre-order" (with the
// merchant's pre-order note) when the resolved variant is pre-orderable, "Only N left" when stock
// runs low, an email form to be notified when a sold-out item returns, the hook's error inline.
// QuickAdd's picker and your product page mount the same component, so buying behaves the same
// in the gallery and on the PDP. Wire as-is; style via the tokens.
//
//   const d = useProductDetail({ initial });            // the PDP
//   <OptionPicker detail={d} showQuantity />
//
// Price, name, gallery, description, and layout stay yours — render d.price / d.compareAtPrice /
// d.pricePerUnit beside this (the range until every option is picked, then the variant's price).
import { useState } from "react";
import { ONE_TIME_PLAN, type UseProductDetail } from "../../hooks/storefront/useProductDetail";

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
  const legend = "mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground";
  return (
    <div className="flex flex-col gap-3">
      {d.optionGroups.map((g) => (
        <fieldset key={g.id}>
          <legend className={legend}>{g.name}</legend>
          <div className="flex flex-wrap gap-1.5">
            {g.choices.map((c) => {
              // unavailable = sold out with the other picks, or no variant has this combination
              const unavailable = !c.inStock || !c.exists;
              return g.isColor && c.colorCode ? (
                <button key={c.choiceId} type="button" aria-label={c.name} title={unavailable ? `${c.name} (unavailable)` : c.name} aria-pressed={c.selected}
                  disabled={unavailable} onClick={() => d.selectOption(g.id, c.choiceId)}
                  className={`h-8 w-8 rounded-full border-2 disabled:opacity-30 ${c.selected ? "border-foreground" : "border-border"}`}
                  style={{ backgroundColor: c.colorCode }} />
              ) : (
                <button key={c.choiceId} type="button" aria-pressed={c.selected} disabled={unavailable}
                  onClick={() => d.selectOption(g.id, c.choiceId)}
                  className={`rounded-control border px-3 py-1 text-sm disabled:line-through disabled:opacity-40 ${c.selected ? "border-foreground bg-foreground text-background" : "border-border"}`}>
                  {c.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {d.product.modifiers.filter((m) => m.type === "choices").map((m) => (
        <fieldset key={m.key}>
          <legend className={legend}>
            {m.name}{m.mandatory ? " *" : ""}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {m.choices.map((c) => {
              const on = d.modifierValues[m.key] === c.key;
              return (
                <button key={c.key} type="button" aria-pressed={on}
                  // an optional modifier can be un-picked; a mandatory one only re-picked
                  onClick={() => d.setModifier(m.key, on && !m.mandatory ? "" : c.key)}
                  className={`rounded-control border px-3 py-1 text-sm ${on ? "border-foreground bg-foreground text-background" : "border-border"}`}>
                  {c.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {d.product.modifiers.filter((m) => m.type === "text").map((m) => {
        const value = d.modifierValues[m.key] ?? "";
        return (
          <label key={m.key} className={`flex flex-col gap-1.5 ${legend} mb-0`}>
            <span className="flex justify-between">
              <span>{m.title}{m.mandatory ? " *" : ""}</span>
              {m.maxChars && <span className="tabular-nums normal-case tracking-normal">{value.length}/{m.maxChars}</span>}
            </span>
            <textarea rows={2} value={value} maxLength={m.maxChars ?? undefined} onChange={(e) => d.setModifier(m.key, e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground" />
          </label>
        );
      })}
      {d.plans.length > 0 && (
        <fieldset>
          <legend className={legend}>Purchase option</legend>
          <div className="flex flex-col gap-1.5">
            {d.plans.map((p) => (
              <label key={p.id} className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${p.selected ? "border-foreground" : "border-border"}`}>
                <span className="flex items-start gap-2">
                  <input type="radio" name="purchase-option" className="mt-1" checked={p.selected} onChange={() => d.selectPlan(p.id)} />
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.terms}{p.description ? ` · ${p.description}` : ""}</span>
                  </span>
                </span>
                {p.price && <span className="whitespace-nowrap tabular-nums">{p.price}</span>}
              </label>
            ))}
            {d.product.allowOneTimePurchase && (
              <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${d.subscriptionPlanId === ONE_TIME_PLAN ? "border-foreground" : "border-border"}`}>
                <input type="radio" name="purchase-option" checked={d.subscriptionPlanId === ONE_TIME_PLAN} onChange={() => d.selectPlan(ONE_TIME_PLAN)} />
                <span className="font-medium">One-time purchase</span>
                {d.variant && <span className="ml-auto tabular-nums">{d.variant.price}</span>}
              </label>
            )}
          </div>
        </fieldset>
      )}
      <div className="flex items-stretch gap-2">
        {showQuantity && (
          <div className="flex items-center rounded-control border border-border">
            <button type="button" aria-label="Decrease quantity" disabled={d.quantity <= 1} onClick={() => d.setQuantity(d.quantity - 1)}
              className="px-3 py-2 text-sm disabled:opacity-40">−</button>
            <span className="min-w-6 text-center text-sm tabular-nums">{d.quantity}</span>
            <button type="button" aria-label="Increase quantity" disabled={d.quantity >= d.maxQuantity} onClick={() => d.setQuantity(d.quantity + 1)}
              className="px-3 py-2 text-sm disabled:opacity-40">+</button>
          </div>
        )}
        <button
          type="button"
          disabled={!d.canAdd || d.adding}
          onClick={() => d.add().then(() => onAdded?.()).catch(() => {})}
          className="flex-1 rounded-control bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {d.adding ? "Adding…" : d.isPreorder ? "Pre-order" : "Add to cart"}
        </button>
      </div>
      {d.remaining !== null && d.remaining > 0 && d.remaining <= 10 && d.canAdd && !d.isPreorder && (
        <p className="text-xs text-muted-foreground">Only {d.remaining} left in stock</p>
      )}
      {d.isPreorder && d.preorderMessage && <p className="text-xs text-muted-foreground">{d.preorderMessage}</p>}
      {d.blockedReason && !d.canAdd && <p className="text-xs text-muted-foreground">{d.blockedReason}</p>}
      {d.canNotify && <NotifyMe detail={d} />}
      {d.error && <p className="text-xs text-destructive">{d.error}</p>}
    </div>
  );
}

// "Notify me when it's back": one email field; the store validates, calls Wix, and reports
// "created" / "already-subscribed".
function NotifyMe({ detail: d }: { detail: UseProductDetail }) {
  const [email, setEmail] = useState("");
  if (d.notifyResult === "created") return <p className="text-xs text-muted-foreground">We'll email you when it's back in stock.</p>;
  if (d.notifyResult === "already-subscribed") return <p className="text-xs text-muted-foreground">You're already on the list for this item.</p>;
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        d.notify(email).catch(() => {});
      }}
    >
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="notify-email">Notify me when it's back</label>
      <div className="flex gap-2">
        <input id="notify-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        <button type="submit" disabled={d.notifying} className="rounded-control border border-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
          {d.notifying ? "Saving…" : "Notify me"}
        </button>
      </div>
      {d.notifyError && <p className="text-xs text-destructive">{d.notifyError}</p>}
    </form>
  );
}
