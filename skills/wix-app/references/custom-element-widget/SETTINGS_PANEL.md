# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. For general WDS component documentation (FormField, Input, Dropdown, Checkbox, ToggleSwitch, DatePicker, Box, etc.), use the the `wix-design-system` skill.

## SidePanel Components

### SidePanel

Main container for the settings panel. Always wrap panel content in this component.

```typescript
<SidePanel width="300" height="100vh">
  <SidePanel.Header title="Widget Settings" />
  <SidePanel.Content noPadding stretchVertically>
    {/* Form fields */}
  </SidePanel.Content>
</SidePanel>
```

**Props:**

- `width`: Panel width (default: "300")
- `height`: Panel height (default: "100vh")

### SidePanel.Header

Header section with title.

```typescript
<SidePanel.Header title="Widget Settings" />
```

**Props:**

- `title`: Header title text

### SidePanel.Content

Content area for form fields.

```typescript
<SidePanel.Content noPadding stretchVertically>
  {/* Form content */}
</SidePanel.Content>
```

**Props:**

- `noPadding`: Remove default padding
- `stretchVertically`: Stretch to fill available height

### SidePanel.Field

Wrapper for individual form fields. Use this to wrap each `FormField`.

```typescript
<SidePanel.Field>
  <FormField label="Title">
    <Input value={title} onChange={handleChange} />
  </FormField>
</SidePanel.Field>
```

### SidePanel.Footer

Optional footer rendered below `SidePanel.Content`. The CLI scaffolds one containing a `SectionHelper` linking to docs. Use it for contextual help, doc links, or secondary actions.

```typescript
<SidePanel.Footer noPadding>
  <SectionHelper fullWidth appearance="success" border="topBottom">
    Footer content (e.g., docs link).
  </SectionHelper>
</SidePanel.Footer>
```

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

