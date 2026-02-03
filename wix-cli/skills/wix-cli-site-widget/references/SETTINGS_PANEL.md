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

Custom component for color selection. Create this component in your widget:

```typescript
import { FormField, Input } from "@wix/design-system";

interface ColorPickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export const ColorPickerField: FC<ColorPickerFieldProps> = ({
  label,
  value,
  onChange,
}) => {
  return (
    <SidePanel.Field>
      <FormField label={label}>
        <Input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    </SidePanel.Field>
  );
};
```

### FontPickerField

Custom component for font selection using `inputs.selectFont()` from `@wix/editor`:

```typescript
import { FormField, Input, Button } from "@wix/design-system";
import { inputs } from "@wix/editor";

interface FontPickerFieldProps {
  label: string;
  value: { font: string; textDecoration: string };
  onChange: (value: { font: string; textDecoration: string }) => void;
}

export const FontPickerField: FC<FontPickerFieldProps> = ({
  label,
  value,
  onChange,
}) => {
  const handleFontSelect = async () => {
    const selectedFont = await inputs.selectFont();
    if (selectedFont) {
      onChange({
        font: selectedFont.fontFamily || "",
        textDecoration: selectedFont.textDecoration || "",
      });
    }
  };

  return (
    <SidePanel.Field>
      <FormField label={label}>
        <Box direction="horizontal" gap="8px">
          <Input
            type="text"
            value={value.font || "Select font"}
            readOnly
            placeholder="Select font"
          />
          <Button onClick={handleFontSelect}>Select</Button>
        </Box>
      </FormField>
    </SidePanel.Field>
  );
};
```

**Important:** Always use `inputs.selectFont()` from `@wix/editor` for font selection, NOT a text Input. This provides a rich font picker dialog.

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
  ToggleSwitch,
  Box,
} from "@wix/design-system";
import "@wix/design-system/styles.global.css";
import { ColorPickerField } from "./components/ColorPickerField";
import { FontPickerField } from "./components/FontPickerField";

const Panel: FC = () => {
  const [title, setTitle] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [targetTime, setTargetTime] = useState<string>("00:00");
  const [bgColor, setBgColor] = useState<string>("#ffffff");
  const [isEnabled, setIsEnabled] = useState<boolean>(true);

  useEffect(() => {
    Promise.all([
      widget.getProp("title"),
      widget.getProp("target-date"),
      widget.getProp("target-time"),
      widget.getProp("bg-color"),
      widget.getProp("enabled"),
    ])
      .then(([titleVal, dateVal, timeVal, bgColorVal, enabledVal]) => {
        setTitle(titleVal || "");
        setTargetDate(dateVal || "");
        setTargetTime(timeVal || "00:00");
        setBgColor(bgColorVal || "#ffffff");
        setIsEnabled(enabledVal === "true" || enabledVal === true);
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

  const handleEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    setIsEnabled(enabled);
    widget.setProp("enabled", String(enabled));
  }, []);

  return (
    <WixDesignSystemProvider>
      <SidePanel width="300" height="100vh">
        <SidePanel.Header title="Widget Settings" />
        <SidePanel.Content noPadding stretchVertically>
          <Box direction="vertical" gap="24px">
            <SidePanel.Field>
              <FormField label="Title" required>
                <Input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="Enter title"
                />
              </FormField>
            </SidePanel.Field>

            <SidePanel.Field>
              <FormField label="Target Date">
                <Input
                  type="date"
                  value={targetDate}
                  onChange={handleDateChange}
                />
              </FormField>
            </SidePanel.Field>

            <SidePanel.Field>
              <FormField label="Target Time">
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

            <SidePanel.Field>
              <FormField label="Enabled">
                <ToggleSwitch
                  checked={isEnabled}
                  onChange={handleEnabledChange}
                />
              </FormField>
            </SidePanel.Field>
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
- For font selection, use `inputs.selectFont()` from `@wix/editor`, not a text Input
