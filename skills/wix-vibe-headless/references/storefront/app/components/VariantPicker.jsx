// PDP choice controls: one OptionSelector per product.options[] (variant choices) and one
// ModifierSelector per product.modifiers[] (TEXT_CHOICES → buttons, FREE_TEXT → input). Driven by
// useProductDetail — pass its selection state/handlers in. Styled with base44 design tokens (shadcn Tailwind classes).

const chipBase = "py-1.5 px-3 cursor-pointer text-sm font-body border rounded-sm";
const chipIdle = "border-border bg-card text-foreground";
const chipActive = "border-primary bg-primary text-primary-foreground";
const label = "block mb-1.5 text-[13px] font-semibold text-muted-foreground";

function OptionSelector({ option, selected, onSelect }) {
  return (
    <div className="mb-4">
      <label className={label}>{option.name}</label>
      <div className="flex flex-wrap gap-2">
        {option.choicesSettings?.choices?.map((c) => (
          <button key={c.choiceId} disabled={c.inStock === false}
            aria-pressed={selected === c.choiceId} onClick={() => onSelect(option.id, c.choiceId)}
            className={`${chipBase} ${selected === c.choiceId ? chipActive : chipIdle} ${c.inStock === false ? "opacity-40 line-through" : ""}`}>{c.name}</button>
        ))}
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
          className="w-full py-2 px-3 font-body border border-border rounded-sm bg-background text-foreground" />
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
