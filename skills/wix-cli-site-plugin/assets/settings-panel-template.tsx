// {{PLUGIN_NAME}}.panel.tsx
// Settings panel shown in the Wix Editor sidebar.
//
// How to adapt this template:
// 1. Add state variables for each configurable property
// 2. Load initial values in useEffect with widget.getProp('kebab-case-name')
// 3. Create onChange handlers that update both local state AND widget.setProp()
// 4. Add WDS form fields for each setting inside SidePanel.Content
//
// Important:
// - Prop names in widget.getProp/setProp use kebab-case (e.g., 'display-name')
// - Always update both local state AND widget prop in onChange handlers
// - For color pickers, use the ColorPickerField component from assets/
// - For font pickers, use the FontPickerField component from assets/

import React, { type FC, useState, useEffect, useCallback } from 'react';
import { widget } from '@wix/editor';
import {
  SidePanel,
  WixDesignSystemProvider,
  Input,
  FormField,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';

const Panel: FC = () => {
  const [displayName, setDisplayName] = useState<string>('');

  useEffect(() => {
    widget.getProp('display-name')
      .then(displayName => setDisplayName(displayName || "Your Plugin's Title"))
      .catch(error => console.error('Failed to fetch display-name:', error));
  }, [setDisplayName]);

  const handleDisplayNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const newDisplayName = event.target.value;
    setDisplayName(newDisplayName);
    widget.setProp('display-name', newDisplayName);
  }, [setDisplayName]);

  return (
    <WixDesignSystemProvider>
      <SidePanel width="300" height="100vh">
        <SidePanel.Content noPadding stretchVertically>
          <SidePanel.Field>
            <FormField label="Display Name">
              <Input
                type="text"
                value={displayName}
                onChange={handleDisplayNameChange}
                aria-label="Display Name"
              />
            </FormField>
          </SidePanel.Field>
        </SidePanel.Content>
      </SidePanel>
    </WixDesignSystemProvider>
  );
};

export default Panel;
