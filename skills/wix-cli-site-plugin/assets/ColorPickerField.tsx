// ColorPickerField — reusable component for site plugin settings panels.
// Opens the native Wix Editor color picker with theme colors, gradients, etc.
//
// Usage in your panel.tsx:
//   import { ColorPickerField } from './ColorPickerField';
//   <ColorPickerField label="Background Color" value={bgColor} onChange={handleBgColorChange} />
//
// Important: Always use this instead of <Input type="color"> — it provides
// the full Wix color picker experience with theme colors.

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
