# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. All UI uses **CSS Modules** — see [REACT_CSS.md](../REACT_CSS.md).

## Layout

The scaffolded `<name>.panel.tsx` is a React component rendered in the Wix Editor sidebar. Create `<name>.panel.module.css` next to it. Use `<form className={styles.form}>` with `<label className={styles.field}>` for each field.

## Color & Font Picker Fields

Use the Wix Editor's native picker dialogs via `inputs.selectColor()` and `inputs.selectFont()` from `@wix/editor`. Both follow the same callback shape: `inputs.selectX(value, { onChange })`. Do NOT use `<input type="color">`, async/await, or a readOnly text input — those don't integrate with the Editor picker dialogs.

| Picker | API | Preview / trigger | Value type |
|---|---|---|---|
| Color | `inputs.selectColor(value, { onChange })` | Styled `<button className={styles.colorSwatch}>` with `style={{ backgroundColor: value }}` | `string` (CSS color) |
| Font | `inputs.selectFont(value, { onChange })` | `<button className={styles.fontButton}>` | `{ font: string; textDecoration: string }` |

Wrap each picker in a `<label className={styles.field}>` with a label `<span className={styles.label}>`. The picker handlers themselves:

```typescript
// Color
<button
  type="button"
  className={styles.colorSwatch}
  style={{ backgroundColor: value }}
  onClick={() => inputs.selectColor(value, { onChange: (val) => { if (val) onChange(val); } })}
  aria-label="Pick color"
/>

// Font
<button
  type="button"
  className={styles.fontButton}
  onClick={() => inputs.selectFont(value, {
    onChange: (val) => onChange({ font: val.font, textDecoration: val.textDecoration || '' }),
  })}
>
  Change Font
</button>
```
