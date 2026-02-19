# Settings Panel Components Reference

This reference documents components and patterns specific to widget settings panels. For general WDS component documentation (FormField, Input, Dropdown, Checkbox, ToggleSwitch, DatePicker, Box, etc.), use the [wds-docs](../../wds-docs/SKILL.md) skill.

## Import

```typescript
import {
  SidePanel,
  FormField,
  Input,
  Dropdown,
  Checkbox,
  ToggleSwitch,
  DatePicker,
  TimeInput,
  Box,
  WixDesignSystemProvider,
} from "@wix/design-system";
import "@wix/design-system/styles.global.css";
```

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

## Widget API Integration Patterns

### TimeInput with widget.setProp

```typescript
const parseTimeValue = (timeString: string): Date => {
  const [hours, minutes] = timeString.split(':');
  const date = new Date();
  date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
  return date;
};

<TimeInput
  value={parseTimeValue(targetTime)}
  onChange={({ date }) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const newTime = `${hours}:${minutes}`;
    setTargetTime(newTime);
    widget.setProp("target-time", newTime);
  }}
/>
```

## Custom Components

### ColorPickerField

Custom component for color selection using `inputs.selectColor()` from `@wix/editor`. This opens the Wix color picker dialog with theme colors, gradients, and more — **NOT** a basic HTML `<input type="color">`.

```typescript
import React, { type FC } from 'react';
import { inputs } from '@wix/editor';
import { FormField, Box, FillPreview, SidePanel } from '@wix/design-system';

interface ColorPickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export const ColorPickerField: FC<ColorPickerFieldProps> = ({
  label,
  value,
  onChange,
}) => (
  <SidePanel.Field>
    <FormField label={label}>
      <Box width="30px" height="30px">
        <FillPreview
          fill={value}
          onClick={() => inputs.selectColor(value, { onChange: (val) => { if (val) onChange(val); } })}
        />
      </Box>
    </FormField>
  </SidePanel.Field>
);
```

**Important:** Always use `inputs.selectColor()` from `@wix/editor` with the `FillPreview` WDS component. Do NOT use `<Input type="color">` — it produces a basic browser color picker that doesn't match the Wix Editor UX.

### FontPickerField

Custom component for font selection using `inputs.selectFont()` from `@wix/editor`. This opens the Wix font picker dialog with font family, size, bold, italic, and other typography features.

```typescript
import React, { type FC } from 'react';
import { inputs } from '@wix/editor';
import { FormField, Button, Text, SidePanel } from '@wix/design-system';

interface FontValue {
  font: string;
  textDecoration: string;
}

interface FontPickerFieldProps {
  label: string;
  value: FontValue;
  onChange: (value: FontValue) => void;
}

export const FontPickerField: FC<FontPickerFieldProps> = ({
  label,
  value,
  onChange,
}) => (
  <SidePanel.Field>
    <FormField label={label}>
      <Button
        size="small"
        priority="secondary"
        onClick={() => inputs.selectFont(value, { onChange: (val) => onChange({ font: val.font, textDecoration: val.textDecoration || "" }) })}
        fullWidth
      >
        <Text size="small" ellipsis>Change Font</Text>
      </Button>
    </FormField>
  </SidePanel.Field>
);
```

**Important:** Always use `inputs.selectFont()` from `@wix/editor` with the callback pattern `inputs.selectFont(value, { onChange })`. Do NOT use an async/await pattern or a readOnly text Input — the callback pattern integrates directly with the Wix Editor font picker dialog.

## Complete Example

```typescript
import React, { type FC, useState, useEffect, useCallback } from "react";
import { widget } from "@wix/editor";
import {
  SidePanel,
  WixDesignSystemProvider,
  Input,
  FormField,
  TimeInput,
  Box,
} from "@wix/design-system";
import "@wix/design-system/styles.global.css";
import { ColorPickerField } from "./components/ColorPickerField";
import { FontPickerField } from "./components/FontPickerField";
import { parseTimeValue } from "./utils";

const DEFAULT_BG_COLOR = "#0a0e27";
const DEFAULT_TEXT_COLOR = "#00ff88";
const DEFAULT_TEXT_FONT = "";
const DEFAULT_TEXT_DECORATION = "";

const Panel: FC = () => {
  const [title, setTitle] = useState<string>("Countdown");
  const [targetDate, setTargetDate] = useState<string>("");
  const [targetTime, setTargetTime] = useState<string>("00:00");
  const [bgColor, setBgColor] = useState<string>(DEFAULT_BG_COLOR);
  const [textColor, setTextColor] = useState<string>(DEFAULT_TEXT_COLOR);
  const [font, setFont] = useState({ font: DEFAULT_TEXT_FONT, textDecoration: DEFAULT_TEXT_DECORATION });

  useEffect(() => {
    Promise.all([
      widget.getProp("title"),
      widget.getProp("target-date"),
      widget.getProp("target-time"),
      widget.getProp("bg-color"),
      widget.getProp("text-color"),
      widget.getProp("font"),
    ])
      .then(([titleVal, dateVal, timeVal, bgColorVal, textColorVal, fontString]) => {
        setTitle(titleVal || "Countdown");
        setTargetDate(dateVal || "");
        setTargetTime(timeVal || "00:00");
        setBgColor(bgColorVal || DEFAULT_BG_COLOR);
        setTextColor(textColorVal || DEFAULT_TEXT_COLOR);
        setFont(JSON.parse(fontString || "{}"));
      })
      .catch((error) => console.error("Failed to fetch widget properties:", error));
  }, []);

  const handleTitleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = event.target.value;
    setTitle(newTitle);
    widget.setProp("title", newTitle);
  }, []);

  const handleDateChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = event.target.value;
    setTargetDate(newDate);
    widget.setProp("target-date", newDate);
  }, []);

  const handleTimeChange = useCallback(({ date }: { date: Date }) => {
    if (date) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const newTime = `${hours}:${minutes}`;
      setTargetTime(newTime);
      widget.setProp("target-time", newTime);
    }
  }, []);

  const handleBgColorChange = (value: string) => {
    setBgColor(value);
    widget.setProp("bg-color", value);
  };

  const handleTextColorChange = (value: string) => {
    setTextColor(value);
    widget.setProp("text-color", value);
  };

  const handleFontChange = (value: { font: string; textDecoration: string }) => {
    setFont(value);
    widget.setProp("font", JSON.stringify(value));
  };

  return (
    <WixDesignSystemProvider>
      <SidePanel width="300" height="100vh">
        <SidePanel.Header title="Countdown Settings" />
        <SidePanel.Content noPadding stretchVertically>
          <Box direction="vertical" gap="24px">
            <SidePanel.Field>
              <FormField label="Title" required>
                <Input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="Enter countdown title"
                />
              </FormField>
            </SidePanel.Field>

            <SidePanel.Field>
              <FormField label="Target Date" required>
                <Input
                  type="date"
                  value={targetDate}
                  onChange={handleDateChange}
                />
              </FormField>
            </SidePanel.Field>

            <SidePanel.Field>
              <FormField label="Target Time" required>
                <TimeInput
                  value={parseTimeValue(targetTime)}
                  onChange={handleTimeChange}
                />
              </FormField>
            </SidePanel.Field>

            <ColorPickerField
              label="Background Color"
              value={bgColor}
              onChange={handleBgColorChange}
            />

            <ColorPickerField
              label="Text Color"
              value={textColor}
              onChange={handleTextColorChange}
            />

            <FontPickerField
              label="Text Font"
              value={font}
              onChange={handleFontChange}
            />
          </Box>
        </SidePanel.Content>
      </SidePanel>
    </WixDesignSystemProvider>
  );
};

export default Panel;
```

## Notes

- Always import `@wix/design-system/styles.global.css` for proper styling
- Use `SidePanel.Field` to wrap each `FormField`
- Update both local state AND `widget.setProp()` in onChange handlers
- Prop names in `widget.getProp()` and `widget.setProp()` use kebab-case
- For color selection, use `inputs.selectColor()` from `@wix/editor` with `FillPreview` — do NOT use `<Input type="color">`
- For font selection, use `inputs.selectFont()` from `@wix/editor` with a `Button` — do NOT use a text Input
- Both `inputs.selectColor()` and `inputs.selectFont()` use the callback pattern: `inputs.selectColor(value, { onChange })` and `inputs.selectFont(value, { onChange })`
- Font values are stored as JSON strings via `widget.setProp("font", JSON.stringify(value))` and parsed back with `JSON.parse()`
