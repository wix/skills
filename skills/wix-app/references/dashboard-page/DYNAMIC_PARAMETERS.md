# Dynamic Parameters Management

Complete guide for managing dynamic parameters for embedded scripts in dashboard pages.

## Description

This dashboard page manages dynamic parameters for an embedded script. The parameters are configurable values that site owners can set through this dashboard interface, and they will be passed to the embedded script as template variables.

**IMPORTANT:** Only implement UI for parameters that are relevant to your current use case. Ignore parameters that don't apply to the functionality you're building. It's perfectly fine to not use all parameters if they're not applicable.

## Implementation Requirements

### 1. Import embeddedScripts

- Import embeddedScripts directly from '@wix/app-management'
- Use embeddedScripts.getEmbeddedScript() to load parameters
- Use embeddedScripts.embedScript({ parameters }) to save parameters
- Example:
  ```typescript
  import { embeddedScripts } from '@wix/app-management';
  ```

### 2. Type Definition

- Create a TypeScript type/interface that includes all the dynamic parameters
- Example:
  ```typescript
  export type MyScriptOptions = {
    headline: string;
    text: string;
    imageUrl: string;
    activationMode: 'active' | 'timed' | 'disabled';
    startDate?: string;
    endDate?: string;
  };
  ```

### 3. State Management

- Use React useState to manage the parameter values locally
- Initialize with default values for all parameters
- Add separate state for isLoading and isSaving
- Use useEffect to load parameters on mount
- **IMPORTANT:** Parameters are returned as strings from the API, so you must handle type conversions:
  * BOOLEAN parameters: Convert from string 'true'/'false' to boolean
  * NUMBER parameters: Convert from string to number using Number()
  * Other types: Use as-is
- Example:
  ```typescript
  const [options, setOptions] = useState<MyScriptOptions>(defaultOptions);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const embeddedScript = await embeddedScripts.getEmbeddedScript();
        const data = embeddedScript.parameters as Partial<Record<keyof MyScriptOptions, string>> || {};

        setOptions((prev) => ({
          ...prev,
          textField: data?.textField || prev.textField,
          booleanField: data?.booleanField === 'true' ? true : data?.booleanField === 'false' ? false : prev.booleanField,
          numberField: Number(data?.numberField) || prev.numberField,
        }));
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);
  ```

### 4. Loading State

- Show a spinner `<div>` (CSS-module loader) while isLoading is true
- Example:
  ```typescript
  {isLoading ? (
    <div className={styles.loaderWrap}>
      <div className={styles.loader} role="status" aria-label="Loading" />
    </div>
  ) : (
    // ... form content
  )}
  ```
  ```css
  /* page.module.css */
  .loaderWrap { display: flex; align-items: center; justify-content: center; height: 50vh; }
  .loader {
    width: 36px; height: 36px; border: 3px solid #e5e5e5; border-top-color: #116dff;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  ```

### 5. Form Components

- **IMPORTANT:** Only create form fields for parameters relevant to your use case
- Skip parameters that don't apply to the functionality being built
- Create appropriate **plain React + CSS-module** form fields based on parameter types:
  * TEXT → `<input type="text">` inside a `<label>`
  * NUMBER → `<input type="number">`
  * BOOLEAN → `<input type="checkbox">`
  * IMAGE → custom image picker component (button that opens `dashboard.openMediaManager()`)
  * DATE → `<input type="date">`
  * SELECT → `<select>` with `<option>` children
  * URL → `<input type="url">`
- Wrap each field in a `<label className={styles.field}>` with a `<span className={styles.label}>` for the label
- Set the `required` attribute based on the parameter.required flag
- Show validation errors with a `<span className={styles.error}>` rendered conditionally below the field

### 6. Save Functionality

- Add a Save `<button>` in the page header actions area
- Make handleSave an async function
- **CRITICAL:** All parameters must be passed as STRING values because they are used as template variables in the embedded script
- Convert all values to strings before saving:
  * BOOLEAN: Use String(value) or value.toString()
  * NUMBER: Use String(value) or value.toString()
  * Other types: Already strings, use as-is
- Disable the Save button if required fields are missing or while saving
- Add proper error handling

### 7. Form Validation

- Implement validation for required fields
- Show error states inline below each field
- Display clear error messages

### 8. Layout and Organization

- Group related fields in `<div className={styles.card}>` containers (24px gaps between cards)
- Use a vertical flex container for form layout (`display: flex; flex-direction: column; gap`)
- Add appropriate spacing with the 6px spacing unit (6, 12, 18, 24…)
- Include helpful descriptions with a `<p className={styles.hint}>` under a field
- Consider creating a separate settings component for complex forms

### 9. Preview Component (Optional but Recommended)

- If applicable, create a preview component that shows how the configuration will look
- Display the preview alongside the settings form using a CSS grid/flex two-column layout
- The preview should react to parameter changes in real-time

## Example Implementation

A complete reference implementation consists of:
- src/extensions/dashboard/pages/page.tsx - Dashboard page with parameter management
- src/extensions/dashboard/pages/page.module.css - CSS-module styles for the page
- src/extensions/dashboard/components/settings.tsx - Settings form component (optional)
- src/extensions/dashboard/types.ts - Type definitions

Key implementation patterns:
1. The page is a plain React component styled with CSS modules — no provider wrapper
2. Parameters are saved as individual string fields, not as JSON
3. Parameters are loaded with proper type conversion (string to boolean, string to number, etc.)
4. Use embeddedScripts directly from '@wix/app-management'

## File Generation Requirements

When dynamic parameters are present, generate these files:
1. src/extensions/dashboard/pages/page.tsx - The main dashboard page component
2. src/extensions/dashboard/pages/page.module.css - CSS-module styles
3. src/extensions/dashboard/types.ts - Type definitions for the parameters (if needed)
4. Any additional component files (settings forms, previews, etc.)

> There is **no** provider wrapper file. Do NOT create a `withProviders.tsx`, and do NOT render `<WixDesignSystemProvider>` — the UI is plain React + CSS modules.

## Page Implementation

In your dashboard page component (page.tsx):
1. Import embeddedScripts from '@wix/app-management'
2. Import the co-located CSS module: `import styles from './page.module.css';`
3. Build the page with plain React elements — no provider, no `@wix/design-system`

Example structure:
```typescript
import { useEffect, useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import { embeddedScripts } from '@wix/app-management';
import styles from './page.module.css';

const MyDashboardPage: FC = () => {
  const [options, setOptions] = useState<MyScriptOptions>(defaultOptions);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const embeddedScript = await embeddedScripts.getEmbeddedScript();
        const data = embeddedScript.parameters || {};
        // ... update options with data (convert strings → booleans/numbers)
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await embeddedScripts.embedScript({ parameters: { /* all string values */ } });
      dashboard.showToast({ message: 'Saved!', type: 'success' });
    } catch (error) {
      console.error('Failed to save:', error);
      dashboard.showToast({ message: 'Failed to save', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.loaderWrap}>
        <div className={styles.loader} role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Settings</h1>
        <div className={styles.actions}>
          <button className={styles.button} onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.card}>
          <label className={styles.field}>
            <span className={styles.label}>Headline</span>
            <input
              className={styles.input}
              value={options.headline}
              onChange={(e) => setOptions({ ...options, headline: e.target.value })}
            />
          </label>
          {/* more fields as needed */}
        </div>
      </div>
    </div>
  );
};

export default MyDashboardPage;
```

```css
/* page.module.css */
.page { display: flex; flex-direction: column; min-height: 100vh; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 24px 48px; border-bottom: 1px solid #e5e5e5;
}
.header h1 { margin: 0; font-size: 24px; font-weight: 600; }
.actions { display: flex; gap: 12px; }
.content { width: 100%; max-width: 1248px; margin: 0 auto; padding: 24px 48px; }
.card {
  background: #fff; border: 1px solid #e5e5e5; border-radius: 8px;
  padding: 24px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 18px;
}
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 14px; color: #333; }
.input { padding: 8px 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
.hint { margin: 0; font-size: 12px; color: #888; }
.error { font-size: 12px; color: #e21c21; }
.button {
  padding: 8px 18px; font-size: 14px; cursor: pointer; color: #fff;
  background: #116dff; border: none; border-radius: 18px;
}
.button:disabled { opacity: 0.5; cursor: default; }
.loaderWrap { display: flex; align-items: center; justify-content: center; height: 50vh; }
.loader {
  width: 36px; height: 36px; border: 3px solid #e5e5e5; border-top-color: #116dff;
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

## Critical Notes

- Only implement UI for parameters that are relevant to your specific use case - ignore parameters that don't apply
- Build the page with plain React + CSS modules — do NOT create a `withProviders.tsx` or render `<WixDesignSystemProvider>`
- Do NOT import `@wix/design-system` anywhere
- ALWAYS use embeddedScripts directly from '@wix/app-management'
- ALWAYS convert parameter values to strings when saving (embeddedScripts.embedScript must receive all string values in the parameters object)
- ALWAYS convert string parameters back to proper types when loading (e.g., 'true' -> true for booleans, string to number for numbers)
- ALWAYS handle the loading state with isLoading state variable
- ALWAYS handle the saving state with isSaving state variable
- ALWAYS add try/catch blocks for async operations (loading and saving)
- ALWAYS use async/await for embeddedScripts operations
- ALWAYS merge parameter values correctly in useEffect with proper type conversions
- ALWAYS validate required fields and show appropriate error states
- The parameter keys MUST match exactly what is expected in the embedded script template variables
- Each parameter is saved as a separate field, NOT as a JSON string
