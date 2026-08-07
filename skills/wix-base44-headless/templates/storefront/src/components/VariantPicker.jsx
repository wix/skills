// PDP choice controls: one OptionSelector per product.options[] (variant choices) and one
// ModifierSelector per product.modifiers[] (TEXT_CHOICES → buttons, FREE_TEXT → input). Driven by
// useProductDetail — pass its selection state/handlers in. Token-styled; re-skin via theme.css.

const chipBase = {
  padding: "6px 12px", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)", color: "var(--color-text)",
};
const chipActive = { background: "var(--color-primary)", color: "var(--color-on-primary)", borderColor: "var(--color-primary)" };
const label = { display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-muted)" };

function OptionSelector({ option, selected, onSelect }) {
  return (
    <div style={{ marginBottom: "var(--space)" }}>
      <label style={label}>{option.name}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {option.choicesSettings?.choices?.map((c) => (
          <button key={c.choiceId} disabled={c.inStock === false}
            aria-pressed={selected === c.choiceId} onClick={() => onSelect(option.id, c.choiceId)}
            style={{
              ...chipBase, ...(selected === c.choiceId ? chipActive : null),
              opacity: c.inStock === false ? 0.4 : 1,
              textDecoration: c.inStock === false ? "line-through" : "none",
            }}>{c.name}</button>
        ))}
      </div>
    </div>
  );
}

function ModifierSelector({ modifier, value, onChange }) {
  const key = modifier.modifierRenderType === "FREE_TEXT" ? modifier.freeTextSettings?.key : modifier.key;
  if (modifier.modifierRenderType === "FREE_TEXT") {
    return (
      <div style={{ marginBottom: "var(--space)" }}>
        <label style={label}>{modifier.name}{modifier.mandatory && " *"}</label>
        <input value={value || ""} onChange={(e) => onChange(key, e.target.value)} style={{
          width: "100%", padding: "8px 12px", fontFamily: "var(--font-body)",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
          background: "var(--color-bg)", color: "var(--color-text)",
        }} />
      </div>
    );
  }
  return (
    <div style={{ marginBottom: "var(--space)" }}>
      <label style={label}>{modifier.name}{modifier.mandatory && " *"}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {modifier.choicesSettings?.choices?.map((c) => (
          <button key={c.key} aria-pressed={value === c.key} onClick={() => onChange(key, c.key)}
            style={{ ...chipBase, ...(value === c.key ? chipActive : null) }}>{c.name}</button>
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
