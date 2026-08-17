// PDP choice controls built on useVariantOptions — swap this component for your own if you want
// a different look; the data contract (optionGroups / modifierGroups) stays the same.
// Styled with base44 design tokens (shadcn Tailwind classes).
import { useVariantOptions } from "@/hooks/useVariantOptions";

const chipBase = "py-1.5 px-3 cursor-pointer text-sm font-body border rounded-sm";
const chipIdle = "border-border bg-card text-foreground";
const chipActive = "border-primary bg-primary text-primary-foreground";
const label = "block mb-1.5 text-[13px] font-semibold text-muted-foreground";

export default function VariantPicker({ options, modifiers, selectedOptions, selectOption, modifierValues, setModifier }) {
  const { optionGroups, modifierGroups } = useVariantOptions(options, modifiers, selectedOptions, modifierValues);

  return (
    <>
      {optionGroups.map((group) => (
        <div key={group.id} className="mb-4">
          <label className={label}>
            {group.name}
            {group.isColor && (
              <span className="ml-1.5 font-normal text-foreground">
                {group.choices.find((c) => c.selected)?.name}
              </span>
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            {group.choices.map((c) =>
              c.isColorSwatch ? (
                <button
                  key={c.choiceId}
                  type="button"
                  disabled={!c.inStock}
                  onClick={() => selectOption(group.id, c.choiceId)}
                  aria-pressed={c.selected}
                  aria-label={`${c.name}${!c.inStock ? " (out of stock)" : ""}`}
                  title={c.name}
                  className={`relative w-9 h-9 rounded-full cursor-pointer transition-shadow ring-1 ring-inset ring-black/15 ${
                    c.selected ? "ring-2 ring-offset-2 ring-offset-background ring-primary" : ""
                  } ${!c.inStock ? "opacity-40 cursor-not-allowed" : "hover:ring-2 hover:ring-offset-1 hover:ring-offset-background hover:ring-border"}`}
                  style={{ backgroundColor: c.colorCode }}
                >
                  {!c.inStock && (
                    <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                      <span className="w-full h-px bg-destructive rotate-45" />
                    </span>
                  )}
                </button>
              ) : (
                <button
                  key={c.choiceId}
                  type="button"
                  disabled={!c.inStock}
                  aria-pressed={c.selected}
                  onClick={() => selectOption(group.id, c.choiceId)}
                  className={`${chipBase} ${c.selected ? chipActive : chipIdle} ${!c.inStock ? "opacity-40 line-through" : ""}`}
                >
                  {c.name}
                </button>
              )
            )}
          </div>
        </div>
      ))}

      {modifierGroups.map((m) => (
        <div key={m.key} className="mb-4">
          <label className={label}>{m.name}{m.mandatory && " *"}</label>
          {m.type === "text" ? (
            <input
              value={m.value}
              onChange={(e) => setModifier(m.key, e.target.value)}
              className="w-full py-2 px-3 font-body border border-input rounded-sm bg-background text-foreground"
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {m.choices.map((c) => (
                <button
                  key={c.key}
                  aria-pressed={c.selected}
                  onClick={() => setModifier(m.key, c.key)}
                  className={`${chipBase} ${c.selected ? chipActive : chipIdle}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
