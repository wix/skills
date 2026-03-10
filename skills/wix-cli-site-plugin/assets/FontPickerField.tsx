// FontPickerField — reusable component for site plugin settings panels.
// Opens the native Wix Editor font picker with font family, size, bold, italic, etc.
//
// Usage in your panel.tsx:
//   import { FontPickerField } from './FontPickerField';
//   <FontPickerField label="Title Font" value={titleFont} onChange={handleFontChange} />

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
