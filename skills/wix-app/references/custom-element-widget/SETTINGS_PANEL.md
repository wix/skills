# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. Build the panel with **plain React + CSS modules** — a co-located `<name>.panel.module.css`. Do NOT import `@wix/design-system`.

## Layout

The scaffolded `<name>.panel.tsx` is a plain React component. Wrap the fields in a CSS-module container and lay them out with flexbox. There is no provider and no `SidePanel` — use plain `<div>`, `<label>`, `<input>`, `<select>`, and `<button>` elements styled via `styles.*`.

```typescript
// <name>.panel.tsx (structure)
import styles from './<name>.panel.module.css';

<div className={styles.panel}>
  <label className={styles.field}>
    <span className={styles.label}>Display Name</span>
    <input className={styles.input} value={value} onChange={handleChange} />
  </label>
  {/* color / font picker fields go here */}
</div>
```

```css
/* <name>.panel.module.css */
.panel { display: flex; flex-direction: column; gap: 18px; padding: 18px; width: 300px; box-sizing: border-box; }
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 14px; color: #333; }
.input { padding: 8px 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
.select { padding: 8px 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
```

## Color & Font Picker Fields

Use the Wix Editor's native picker dialogs via `inputs.selectColor()` and `inputs.selectFont()` from `@wix/editor`. Both follow the same callback shape: `inputs.selectX(value, { onChange })`. Do NOT use `<input type="color">`, async/await, or a readOnly text input — those don't integrate with the Editor picker dialogs. The visual trigger is a **plain element** (a swatch `<button>` for color, a `<button>` for font), NOT a WDS component.

| Picker | API | Preview / trigger | Value type |
|---|---|---|---|
| Color | `inputs.selectColor(value, { onChange })` | swatch `<button className={styles.swatch}>` | `string` (CSS color) |
| Font | `inputs.selectFont(value, { onChange })` | `<button className={styles.button}>` | `{ font: string; textDecoration: string }` |

```typescript
// Color — swatch button trigger
<button
  type="button"
  className={styles.swatch}
  style={{ backgroundColor: value }}
  aria-label={label}
  onClick={() => inputs.selectColor(value, { onChange: (val) => { if (val) onChange(val); } })}
/>

// Font — button trigger
<button
  type="button"
  className={styles.button}
  onClick={() => inputs.selectFont(value, {
    onChange: (val) => onChange({ font: val.font, textDecoration: val.textDecoration || '' }),
  })}
>
  Change Font
</button>
```

```css
/* add to <name>.panel.module.css */
.swatch { width: 30px; height: 30px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; }
.button {
  width: 100%; padding: 8px 12px; font-size: 14px; cursor: pointer;
  background: #fff; border: 1px solid #ccc; border-radius: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.button:hover { background: #f5f5f5; }
```
