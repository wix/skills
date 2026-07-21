# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. For general WDS component documentation (FormField, Input, Dropdown, Checkbox, ToggleSwitch, DatePicker, Box, etc.), use the `wix-design-system` skill. Retrieve `component SidePanel` plus the relevant `Header`, `Content`, `Footer`, and `Field` examples before changing the settings-panel shell.

## Layout

The scaffolded `<name>.panel.tsx` already wraps everything in `SidePanel > Header > Content > Footer`. Wrap each `FormField` in `SidePanel.Field`. For component-level props (`SidePanel`, `SidePanel.Header`/`Content`/`Field`/`Footer`, `SectionHelper`), use the retrieved `wix-design-system` component documentation rather than copying dashboard overlay geometry; an editor settings panel and a floating dashboard SidePanel have different hosts.

## Color & Font Picker Fields

Use the Wix Editor's native picker dialogs via `inputs.selectColor()` and `inputs.selectFont()` from `@wix/editor`. Both follow the same callback shape: `inputs.selectX(value, { onChange })`. Do NOT use `<input type="color">`, async/await, or a readOnly text Input — those don't integrate with the Editor picker dialogs.

| Picker | API | Preview / trigger | Value type |
|---|---|---|---|
| Color | `inputs.selectColor(value, { onChange })` | `FillPreview` (WDS) | `string` (CSS color) |
| Font | `inputs.selectFont(value, { onChange })` | `Button` (WDS) | `{ font: string; textDecoration: string }` |

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
