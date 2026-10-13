# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. For general WDS component documentation (FormField, Input, Dropdown, Checkbox, ToggleSwitch, DatePicker, Box, etc.), use the the `wix-design-system` skill.

## Layout

The scaffolded `<name>.panel.tsx` already wraps everything in `SidePanel > Header > Content > Footer`. Wrap each `FormField` in `SidePanel.Field`. For component-level props (`SidePanel`, `SidePanel.Header`/`Content`/`Field`/`Footer`, `SectionHelper`), use the wix-design-system skill.

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

## Date & Time Fields

Use WDS `DatePicker` and `TimeInput` directly (no `@wix/editor` picker dialog involved) — but their `onChange` shapes differ, verified against the installed package's own types:

| Field | Value type | `onChange` signature |
|---|---|---|
| `DatePicker` | `Date` | `(date: Date) => void` — receives the date directly |
| `TimeInput` | `Date \| null` | `({ date }: { date: Date \| null }) => void` — receives a **destructured object**, not the date directly |

```typescript
import { FormField, DatePicker, TimeInput } from '@wix/design-system';

<FormField label="Target date">
  <DatePicker value={targetDate} onChange={(date) => onDateChange(date)} />
</FormField>

<FormField label="Target time">
  <TimeInput value={targetTime} onChange={({ date }) => onTimeChange(date)} />
</FormField>
```

