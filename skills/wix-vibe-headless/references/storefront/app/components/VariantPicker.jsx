// PDP choice controls: one OptionSelector per product.options[] (variant choices) and one
// ModifierSelector per product.modifiers[] (TEXT_CHOICES → buttons, FREE_TEXT → input). Driven by
// useProductDetail — pass its selection state/handlers in. Styled with base44 design tokens (shadcn Tailwind classes).

const chipBase = "py-1.5 px-3 cursor-pointer text-sm font-body border rounded-sm";
const chipIdle = "border-border bg-card text-foreground";
const chipActive = "border-primary bg-primary text-primary-foreground";
const label = "block mb-1.5 text-[13px] font-semibold text-muted-foreground";

// A colour/swatch option renders as swatches, a text option as pills — the render type is on the
// option (`optionRenderType`) and mirrored per choice (`choiceType`: ONE_COLOR vs CHOICE_TEXT).
// Colour choices carry `colorCode` (hex) and usually `linkedMedia`, so a swatch is real colour, and
// picking one moves the gallery to that colour's photo.
const isColorChoice = (option, choice) =>
  option?.optionRenderType === "COLOR_CHOICES" ||
  option?.optionRenderType === "SWATCH_CHOICES" ||
  choice?.choiceType === "ONE_COLOR";

function OptionSelector({ option, selected, onSelect }) {
  // `visible: false` is a choice the merchant retired — it stays in the payload, so filter it out or
  // the buyer can pick something the catalogue no longer offers.
  const choices = (option.choicesSettings?.choices || []).filter((c) => c.visible !== false);
  if (!choices.length) return null;
  const swatches = choices.some((c) => isColorChoice(option, c) && c.colorCode);

  return (
    <div className="mb-4">
      <label className={label}>
        {option.name}
        {/* With swatches the chosen colour's name isn't otherwise on screen — echo it. */}
        {swatches && selected && (
          <span className="ml-1.5 font-normal text-foreground">
            {choices.find((c) => c.choiceId === selected)?.name}
          </span>
        )}
      </label>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => {
          const active = selected === c.choiceId;
          const out = c.inStock === false;
          if (swatches && c.colorCode) {
            return (
              <button
                key={c.choiceId}
                type="button"
                disabled={out}
                onClick={() => onSelect(option.id, c.choiceId)}
                aria-pressed={active}
                aria-label={`${c.name}${out ? " (out of stock)" : ""}`}
                title={c.name}
                className={`relative w-9 h-9 rounded-full cursor-pointer transition-shadow ring-1 ring-inset ring-black/15 ${
                  active ? "ring-2 ring-offset-2 ring-offset-background ring-primary" : ""
                } ${out ? "opacity-40 cursor-not-allowed" : "hover:ring-2 hover:ring-offset-1 hover:ring-offset-background hover:ring-border"}`}
                style={{ backgroundColor: c.colorCode }}
              >
                {/* A struck line reads as "unavailable" without hiding which colour it was. */}
                {out && (
                  <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                    <span className="w-full h-px bg-destructive rotate-45" />
                  </span>
                )}
              </button>
            );
          }
          return (
            <button
              key={c.choiceId}
              type="button"
              disabled={out}
              aria-pressed={active}
              onClick={() => onSelect(option.id, c.choiceId)}
              className={`${chipBase} ${active ? chipActive : chipIdle} ${out ? "opacity-40 line-through" : ""}`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModifierSelector({ modifier, value, onChange }) {
  const key = modifier.modifierRenderType === "FREE_TEXT" ? modifier.freeTextSettings?.key : modifier.key;
  if (modifier.modifierRenderType === "FREE_TEXT") {
    return (
      <div className="mb-4">
        <label className={label}>{modifier.name}{modifier.mandatory && " *"}</label>
        <input value={value || ""} onChange={(e) => onChange(key, e.target.value)}
          className="w-full py-2 px-3 font-body border border-input rounded-sm bg-background text-foreground" />
      </div>
    );
  }
  return (
    <div className="mb-4">
      <label className={label}>{modifier.name}{modifier.mandatory && " *"}</label>
      <div className="flex flex-wrap gap-2">
        {modifier.choicesSettings?.choices?.map((c) => (
          <button key={c.key} aria-pressed={value === c.key} onClick={() => onChange(key, c.key)}
            className={`${chipBase} ${value === c.key ? chipActive : chipIdle}`}>{c.name}</button>
        ))}
      </div>
    </div>
  );
}

export default function VariantPicker({ options, modifiers, selectedOptions, selectOption, modifierValues, setModifier }) {
  return (
    <>
      {options.map((o) => (
        <OptionSelector key={o.id} option={o} selected={selectedOptions[o.id]} onSelect={selectOption} />
      ))}
      {modifiers.map((m) => (
        <ModifierSelector key={m.key || m.freeTextSettings?.key} modifier={m}
          value={modifierValues[m.key || m.freeTextSettings?.key]} onChange={setModifier} />
      ))}
    </>
  );
}
