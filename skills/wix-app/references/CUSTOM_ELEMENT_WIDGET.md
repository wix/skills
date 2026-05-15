
# Wix Custom Element Widget Builder

Custom element widgets are native web components (HTML custom elements) that appear in the Wix Editor. Site owners add interactive, configurable widgets to their pages and edit them through a built-in settings panel.

## Scaffold

Use `wix generate --params` with `extensionType: CUSTOM_ELEMENT`. `folder` must be a valid custom-element tag name (lowercase, starts with a letter, contains at least one hyphen). The CLI generates 4 files plus the `src/extensions.ts` registration:

| File | Purpose |
|------|---------|
| `<name>.tsx` | The widget — a class that extends `HTMLElement` |
| `<name>.panel.tsx` | The settings panel React component shown in the Editor sidebar |
| `<name>.module.css` | CSS Modules stylesheet pre-wired with a `.root` class and CSS custom-property tokens |
| `<name>.extension.ts` | Builder file (UUID, name, sizing defaults, auto-add, presets, tagName, file paths) |

After scaffolding, edit `<name>.tsx` for the widget logic, `<name>.panel.tsx` for the settings UI, `<name>.module.css` for the visual design, and the builder file only for non-default sizing, auto-add, or preset behavior.

## Widget Component (`<name>.tsx`)

Wix calls `customElements.define()` for you using the builder's `tagName`; do NOT call it in your code.

Key authoring rules:

- Extend `HTMLElement` and export the class as the default export.
- Declare every reactive attribute in a static `observedAttributes` getter that returns an array of **kebab-case** strings (HTML attributes don't preserve camelCase).
- Initialize and start side effects (timers, listeners, fetches) in `connectedCallback`. Tear them down in `disconnectedCallback` to avoid leaks when the widget is unmounted in the Editor.
- Re-render in `attributeChangedCallback` when a watched attribute changes.
- Read attribute values with `this.getAttribute('attr-name')` and provide sensible defaults — attributes may be missing on first paint.
- Render output via `this.innerHTML = \`...\`` (template strings) or imperative DOM, not JSX.
- Pull design tokens from the generated `<name>.module.css` (e.g., apply the `.root` class) rather than hard-coding colors inline; the settings panel is the place for user-controlled colors.

## Settings Panel (`<name>.panel.tsx`)

React component shown in the Wix Editor sidebar.

- Uses Wix Design System components (see [SETTINGS_PANEL.md](custom-element-widget/SETTINGS_PANEL.md)).
- Manages widget properties via the `@wix/editor` `widget` API.
- Loads initial values with `widget.getProp('kebab-case-name')`.
- Updates properties with `widget.setProp('kebab-case-name', value)`.
- Wrapped in `WixDesignSystemProvider > SidePanel > SidePanel.Content`.
- For color pickers, use `inputs.selectColor()` from `@wix/editor` with `FillPreview` — NOT `<Input type="color">`.
- For font pickers, use `inputs.selectFont()` from `@wix/editor` with a `Button` — NOT a text Input.

## Builder file (`<name>.extension.ts`)

The CLI scaffolds the builder file with sensible defaults — edit it only to customize sizing, auto-add behavior, or presets.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `id` | UUID | generated | Extension ID. Don't change after scaffolding. |
| `name` | string | from scaffold param | Display name. |
| `tagName` | kebab-case | derived from `folder` | Custom-element tag the widget is registered under. Used by the Editor and by `customElements.define()`. |
| `width.defaultWidth` | number (px) | `450` | Initial width when the widget is added to a page. |
| `width.allowStretch` | boolean | `true` | Whether the site owner can stretch the widget to the page width. |
| `height.defaultHeight` | number (px) | `250` | Initial height. |
| `installation.autoAdd` | boolean | `true` | If true, the widget is auto-added to the site when the app is installed. Set to `false` for opt-in widgets. |
| `presets` | array | one default preset | Editor presets (saved configurations) the site owner can pick from. Each preset has its own `id`, `name`, and `thumbnailUrl`. |
| `presets[].thumbnailUrl` | string | `{{BASE_URL}}/<name>-thumbnail.png` | Path to a preview image. `{{BASE_URL}}` is resolved at build time. Replace the placeholder image at the same relative path with your actual asset. |
| `element` | path | `./extensions/site/widgets/<name>/<name>.tsx` | Path to the widget custom element file. Don't change unless renaming files. |
| `settings` | path | `./extensions/site/widgets/<name>/<name>.panel.tsx` | Path to the settings panel file. Don't change unless renaming files. |

## Settings Panel Pattern

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

**Key Points:**

- Prop names in `widget.getProp()` and `widget.setProp()` use **kebab-case** (e.g., `"target-date"`, `"bg-color"`)
- Always update both local state AND widget prop in onChange handlers
- Wrap content in `WixDesignSystemProvider > SidePanel > SidePanel.Content`
- Use WDS components from `@wix/design-system` (see [SETTINGS_PANEL.md](custom-element-widget/SETTINGS_PANEL.md))
- Import `@wix/design-system/styles.global.css` for styles
- For colors, use `ColorPickerField` with `inputs.selectColor()` from `@wix/editor` — NOT `<Input type="color">`
- For fonts, use `FontPickerField` with `inputs.selectFont()` from `@wix/editor` — NOT a text Input
- Font values are stored as JSON strings via `JSON.stringify()` / `JSON.parse()`

## Props Naming Convention

**Critical:** Props use different naming conventions in each file:

| File                           | Convention | Example                                       |
| ------------------------------ | ---------- | --------------------------------------------- |
| `widget.tsx` (Props interface) | camelCase  | `targetDate`, `bgColor`, `textColor`          |
| `panel.tsx` (widget API)       | kebab-case | `"target-date"`, `"bg-color"`, `"text-color"` |
| `reactToWebComponent` config   | camelCase  | `targetDate: 'string'`                        |

The web component automatically converts between camelCase (React props) and kebab-case (HTML attributes).

## Wix Data API Integration

When using Wix Data API in widgets, you **must** handle the Wix Editor environment gracefully:

```typescript
import { items } from "@wix/data";
import { window as wixWindow } from "@wix/site-window";

const CustomElement: FC<WidgetProps> = ({ collectionId }) => {
  const [data, setData] = useState(null);
  const [isEditor, setIsEditor] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const currentViewMode = await wixWindow.viewMode();

      if (currentViewMode === "Editor") {
        // Don't fetch data in editor - show placeholder
        setIsEditor(true);
        return;
      }

      // Fetch real data only on live site
      try {
        const results = await items.query(collectionId).limit(10).find();
        setData(results.items);
      } catch (error) {
        console.error("Failed to load data:", error);
      }
    };

    loadData();
  }, [collectionId]);

  if (isEditor) {
    return (
      <div style={{ padding: "20px", border: "2px dashed #ccc" }}>
        <p>Widget will display data on the live site</p>
        <p>Collection: {collectionId}</p>
      </div>
    );
  }

  // Render widget with real data
  return (
    <div>
      {data?.map((item) => (
        <div key={item._id}>{item.title}</div>
      ))}
    </div>
  );
};
```

**Requirements:**

- Import `{ window as wixWindow }` from `"@wix/site-window"`
- Check `await wixWindow.viewMode()` before fetching data
- If `viewMode === 'Editor'`, show a placeholder UI instead
- Only fetch and render real data when NOT in editor mode

## Color Selection

For color selection in settings panels, use `ColorPickerField` component with `inputs.selectColor()` from `@wix/editor`. Do NOT use `<Input type="color">`.

```typescript
// components/ColorPickerField.tsx
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

Usage in panel:

```typescript
const handleBgColorChange = (value: string) => {
  setBgColor(value);
  widget.setProp("bg-color", value);
};

<ColorPickerField label="Background Color" value={bgColor} onChange={handleBgColorChange} />
```

**Important:** Use `inputs.selectColor(value, { onChange })` from `@wix/editor` with `FillPreview` from WDS. This opens the native Wix color picker with theme colors, gradients, and more. Never use `<Input type="color">`.

## Font Selection

For font selection in settings panels, use `FontPickerField` component with `inputs.selectFont()` from `@wix/editor`. Do NOT use a text Input.

```typescript
// components/FontPickerField.tsx
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

Usage in panel:

```typescript
const [font, setFont] = useState<FontValue>({ font: "", textDecoration: "" });

const handleFontChange = (value: FontValue) => {
  setFont(value);
  widget.setProp("font", JSON.stringify(value));
};

<FontPickerField label="Text Font" value={font} onChange={handleFontChange} />
```

**Important:** Use `inputs.selectFont(value, { onChange })` from `@wix/editor` with the callback pattern. This provides a rich font picker dialog with bold, italic, size, and typography features. Font values are stored as JSON strings.

## Examples

### Countdown Timer Widget

**Request:** "Create a countdown timer widget"

**Output:**

- Widget with configurable title, target date/time, colors, and font
- Settings panel with date picker, time input, color pickers, font picker
- Real-time countdown display with days, hours, minutes, seconds

### Product Showcase Widget

**Request:** "Create a widget that displays products from a collection"

**Output:**

- Widget that queries Wix Data collection
- Editor environment handling (shows placeholder in editor)
- Settings panel for collection selection, display options, styling
- Responsive grid layout with product cards

### Interactive Calculator Widget

**Request:** "Create a calculator widget with customizable colors"

**Output:**

- Functional calculator component
- Settings panel for color customization (background, buttons, text)
- Inline styles for all styling
- No external dependencies

## Frontend Aesthetics

Avoid generic aesthetics. Create distinctive designs with unique fonts (avoid Inter, Roboto, Arial), cohesive color palettes, CSS animations for micro-interactions, and context-specific choices. Don't use clichéd color schemes or predictable layouts.

## Code Quality Requirements

- Strict TypeScript (no `any`, explicit return types)
- Functional React components with hooks
- Proper error handling and loading states
- No `@ts-ignore` comments
- Inline styles only (no CSS imports)
- Handle Wix Editor environment when using Wix Data API
- Consistent prop naming (camelCase in widget, kebab-case in panel)
