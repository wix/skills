# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. Build the panel with **plain React elements + Tailwind utilities** — do NOT import `@wix/design-system`.

## Layout

The scaffolded `<name>.panel.tsx` renders the settings UI. Wrap the panel in a plain Tailwind container and lay out fields with flex/gap utilities. Import the app's `styles/tailwind.css` once in the panel entry file.

```tsx
import '../../styles/tailwind.css'; // adjust relative depth to reach src/styles/tailwind.css

const Panel = () => (
  <div className="flex w-[300px] flex-col gap-4 p-4">
    {/* fields */}
  </div>
);
```

Build each field as a `<label className="flex flex-col gap-1 text-sm"><span>Label</span>{control}</label>`. Common controls map to plain HTML elements:

| Field | Plain React + Tailwind |
| --- | --- |
| Text / number input | `<input className="rounded border border-gray-300 px-2 py-1" />` |
| Dropdown / select | `<select className="rounded border border-gray-300 px-2 py-1">` |
| Checkbox / toggle | `<input type="checkbox" />` |
| Section heading | `<h3 className="text-sm font-medium text-gray-700">` |
| Helper text | `<p className="text-xs text-gray-500">` |

## Color & Font Picker Fields

Use the Wix Editor's native picker dialogs via `inputs.selectColor()` and `inputs.selectFont()` from `@wix/editor`. Both follow the same callback shape: `inputs.selectX(value, { onChange })`. Do NOT use `<input type="color">`, async/await, or a readOnly text input — those don't integrate with the Editor picker dialogs.

| Picker | API | Preview / trigger | Value type |
|---|---|---|---|
| Color | `inputs.selectColor(value, { onChange })` | swatch `<button>` (Tailwind) | `string` (CSS color) |
| Font | `inputs.selectFont(value, { onChange })` | `<button>` (Tailwind) | `{ font: string; textDecoration: string }` |

Wrap each picker in a plain `<label className="flex flex-col gap-1 text-sm">…</label>`. The picker triggers:

```tsx
// Color — swatch button
<button
  type="button"
  aria-label={label}
  style={{ backgroundColor: value }}
  className="h-8 w-8 rounded border border-gray-300"
  onClick={() => inputs.selectColor(value, { onChange: (val) => { if (val) onChange(val); } })}
/>

// Font — plain button
<button
  type="button"
  className="w-full truncate rounded border border-gray-300 px-3 py-1.5 text-sm"
  onClick={() => inputs.selectFont(value, {
    onChange: (val) => onChange({ font: val.font, textDecoration: val.textDecoration || '' }),
  })}
>
  Change Font
</button>
```
