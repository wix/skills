// Option/modifier selector — wire as-is on the PDP (color options render as swatches, text
// options as pills, modifiers as pills or a text input). Restyle via the --sf-* tokens.
import type { ProductModifier } from "../../wix/storefront/types";
import type { OptionGroupView } from "../../hooks/storefront/useProductDetail";

export interface VariantPickerProps {
  optionGroups: OptionGroupView[];
  selectOption: (optionName: string, choiceName: string) => void;
  modifiers?: ProductModifier[];
  modifierValues?: Record<string, string>;
  setModifier?: (key: string, value: string) => void;
}

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
        <div className="sf-opt" key={group.id || group.name}>
          <p className="sf-opt-label">{group.name}</p>
          <div className="sf-chips">
            {group.choices.map((choice) =>
              group.isColor && choice.colorCode ? (
                <button
                  key={choice.choiceId || choice.name}
                  type="button"
                  className={choice.selected ? "sf-swatch sf-on" : "sf-swatch"}
                  style={{ background: choice.colorCode }}
                  title={choice.name}
                  aria-label={`${group.name}: ${choice.name}`}
                  aria-pressed={choice.selected}
                  disabled={!choice.inStock}
                  onClick={() => selectOption(group.name, choice.name)}
                />
              ) : (
                <button
                  key={choice.choiceId || choice.name}
                  type="button"
                  className={choice.selected ? "sf-chip sf-on" : "sf-chip"}
                  aria-pressed={choice.selected}
                  disabled={!choice.inStock}
                  onClick={() => selectOption(group.name, choice.name)}
                >
                  {choice.name}
                </button>
              ),
            )}
          </div>
        </div>
      ))}

      {modifiers.map((m) => (
        <div className="sf-opt" key={m.key}>
          <p className="sf-opt-label">
            {m.name}
            {m.mandatory ? " *" : ""}
          </p>
          {m.type === "text" ? (
            <input
              className="sf-modifier-input"
              type="text"
              value={modifierValues[m.key] ?? ""}
              onChange={(e) => setModifier?.(m.key, e.target.value)}
              aria-label={m.name}
            />
          ) : (
            <div className="sf-chips">
              {m.choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={modifierValues[m.key] === c.key ? "sf-chip sf-on" : "sf-chip"}
                  aria-pressed={modifierValues[m.key] === c.key}
                  onClick={() => setModifier?.(m.key, c.key)}
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
