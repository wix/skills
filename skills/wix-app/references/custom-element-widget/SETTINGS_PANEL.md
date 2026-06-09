# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels.

## Layout

The scaffolded `<name>.panel.tsx` already wraps everything in `SidePanel > Header > Content > Footer`. Wrap each `FormField` in `SidePanel.Field`.

## Color & Font Picker Fields

Use the Wix Editor's native picker dialogs via `inputs.selectColor()` and `inputs.selectFont()` from `@wix/editor`. Both follow the same callback shape: `inputs.selectX(value, { onChange })`. Do NOT use `<input type="color">`, async/await, or a readOnly text Input — those don't integrate with the Editor picker dialogs.

| Picker | API | Preview / trigger | Value type |
|---|---|---|---|
| Color | `inputs.selectColor(value, { onChange })` | `FillPreview` | `string` (CSS color) |
| Font | `inputs.selectFont(value, { onChange })` | `Button` | `{ font: string; textDecoration: string }` |

Wrap each picker in the standard `<SidePanel.Field><FormField label={label}>…</FormField></SidePanel.Field>`. The picker handlers themselves:

```typescript
// Color
<FillPreview
  fill={value}
  onClick={() => inputs.selectColor(value, { onChange: (val) => { if (val) onChange(val); } })}
/>

// Font
<Button onClick={() => inputs.selectFont(value, {
  onChange: (val) => onChange({ font: val.font, textDecoration: val.textDecoration || '' }),
})}>
  Change Font
</Button>
```

