// Option/modifier selector — wire as-is on the PDP (color options render as swatches, text
// options as pills, modifiers as pills or a text input). Styled from the @theme tokens.
import type { ProductModifier } from "../../wix/storefront/types";
import type { OptionGroupView } from "../../hooks/storefront/useProductDetail";

export interface VariantPickerProps {
  optionGroups: OptionGroupView[];
  selectOption: (optionName: string, choiceName: string) => void;
  modifiers?: ProductModifier[];
  modifierValues?: Record<string, string>;
  setModifier?: (key: string, value: string) => void;
}

const chip = (selected: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through ${
    selected
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function VariantPicker({
  optionGroups,
  selectOption,
  modifiers = [],
  modifierValues = {},
  setModifier,
}: VariantPickerProps) {
  return (
    <div>
      {optionGroups.map((group) => (
        <div className="mb-5" key={group.id || group.name}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {group.choices.map((choice) =>
              group.isColor && choice.colorCode ? (
                <button
                  key={choice.choiceId || choice.name}
                  type="button"
                  style={{ background: choice.colorCode }}
                  title={choice.name}
                  aria-label={`${group.name}: ${choice.name}`}
                  aria-pressed={choice.selected}
                  disabled={!choice.inStock}
                  onClick={() => selectOption(group.name, choice.name)}
                  className={`h-8 w-8 rounded-full border transition-shadow disabled:cursor-not-allowed disabled:opacity-35 ${
                    choice.selected
                      ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "border-border"
                  }`}
                />
              ) : (
                <button
                  key={choice.choiceId || choice.name}
                  type="button"
                  aria-pressed={choice.selected}
                  disabled={!choice.inStock}
                  onClick={() => selectOption(group.name, choice.name)}
                  className={chip(choice.selected)}
                >
                  {choice.name}
                </button>
              ),
            )}
          </div>
        </div>
      ))}

      {modifiers.map((m) => (
        <div className="mb-5" key={m.key}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {m.name}
            {m.mandatory ? " *" : ""}
          </p>
          {m.type === "text" ? (
            <input
              type="text"
              value={modifierValues[m.key] ?? ""}
              onChange={(e) => setModifier?.(m.key, e.target.value)}
              aria-label={m.name}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary"
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {m.choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={modifierValues[m.key] === c.key}
                  onClick={() => setModifier?.(m.key, c.key)}
                  className={chip(modifierValues[m.key] === c.key)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
