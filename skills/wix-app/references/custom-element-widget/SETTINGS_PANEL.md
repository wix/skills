# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. All UI uses **Tailwind CSS** — see [TAILWIND.md](../TAILWIND.md).

## Layout

The scaffolded `<name>.panel.tsx` is a React component rendered in the Wix Editor sidebar. Use a `<form className="flex flex-col gap-4 p-4">` wrapper with `<label className="flex flex-col gap-1">` for each field.

## Color & Font Picker Fields

Use the Wix Editor's native picker dialogs via `inputs.selectColor()` and `inputs.selectFont()` from `@wix/editor`. Both follow the same callback shape: `inputs.selectX(value, { onChange })`. Do NOT use `<input type="color">`, async/await, or a readOnly text input — those don't integrate with the Editor picker dialogs.

| Picker | API | Preview / trigger | Value type |
|---|---|---|---|
| Color | `inputs.selectColor(value, { onChange })` | Styled `<button>` with `style={{ backgroundColor: value }}` | `string` (CSS color) |
| Font | `inputs.selectFont(value, { onChange })` | `<button>` | `{ font: string; textDecoration: string }` |

Wrap each picker in a `<label className="flex flex-col gap-1">` with a label `<span>`. The picker handlers themselves:

```typescript
// Color
<button
  type="button"
  className="h-8 w-8 rounded border border-gray-300"
  style={{ backgroundColor: value }}
  onClick={() => inputs.selectColor(value, { onChange: (val) => { if (val) onChange(val); } })}
  aria-label="Pick color"
/>

// Font
<button
  type="button"
  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
  onClick={() => inputs.selectFont(value, {
    onChange: (val) => onChange({ font: val.font, textDecoration: val.textDecoration || '' }),
  })}
>
  Change Font
</button>
```
