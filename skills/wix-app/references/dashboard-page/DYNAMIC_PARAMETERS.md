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

- Show a spinner `<div>` while isLoading is true
- Example:
  ```tsx
  {isLoading ? (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
    </div>
  ) : (
    // ... form content
  )}
  ```

### 5. Form Components

- **IMPORTANT:** Only create form fields for parameters relevant to your use case
- Skip parameters that don't apply to the functionality being built
- Build form fields with plain React elements + Tailwind based on parameter types:
  * TEXT → `<input className="rounded border border-gray-300 px-2 py-1" />`
  * NUMBER → `<input type="number" className="rounded border border-gray-300 px-2 py-1" />`
  * BOOLEAN → `<input type="checkbox" />`
  * IMAGE → custom image-picker component (plain React)
  * DATE → `<input type="date" className="rounded border border-gray-300 px-2 py-1" />`
  * SELECT → `<select className="rounded border border-gray-300 px-2 py-1">` with `<option>`s
  * URL → `<input type="url" ... />` with URL validation
- Wrap each field in a `<label className="flex flex-col gap-1 text-sm"><span>Label</span>{control}</label>` for labels and validation messages
- Set required validation based on parameter.required flag
- Show validation errors with a `<p className="text-xs text-red-600">` under the field

### 6. Save Functionality

- Add a Save `<button>` in the page header actions row
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
- Show error states on FormField components
- Display clear error messages

### 8. Layout and Organization

- Group related fields in bordered card `<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">`
- Use `<div className="flex flex-col gap-4">` for vertical form layout
- Add appropriate spacing with Tailwind `gap-*` utilities
- Include helpful descriptions with a `<p className="text-sm text-gray-500">` under the card heading
- Consider creating a separate settings component for complex forms

### 9. Preview Component (Optional but Recommended)

- If applicable, create a preview component that shows how the configuration will look
- Display the preview alongside the settings form using a `<div className="grid grid-cols-12 gap-6">` with `col-span-*` children
- The preview should react to parameter changes in real-time

## Example Implementation

A complete reference implementation consists of:
- src/extensions/dashboard/pages/page.tsx - Dashboard page with parameter management
- src/extensions/dashboard/components/site-popup-settings.tsx - Settings form component (plain React + Tailwind)
- src/extensions/dashboard/types.ts - Type definitions

Key implementation patterns:
1. The page is built with plain React elements + Tailwind utilities — no provider wrapper
2. Import the app's `styles/tailwind.css` ONCE at the top of `page.tsx`
3. Parameters are saved as individual string fields, not as JSON
4. Parameters are loaded with proper type conversion (string to boolean, string to number, etc.)
5. Use embeddedScripts directly from '@wix/app-management'

## File Generation Requirements

When dynamic parameters are present, generate these files:
1. src/extensions/dashboard/pages/page.tsx - The main dashboard page component
2. src/extensions/dashboard/types.ts - Type definitions for the parameters (if needed)
3. Any additional component files (settings forms, previews, etc.)

There is **no** provider wrapper file. UI is built with Tailwind on plain React; the only one-time setup is importing the stylesheet.

## Stylesheet Import (one-time)

Instead of a WDS provider wrapper, import the app's Tailwind stylesheet **once** at the top of the page entry file (`page.tsx`):

```tsx
import '../../styles/tailwind.css'; // adjust the relative depth to reach src/styles/tailwind.css
```

Do NOT import `@wix/design-system`, do NOT render `<WixDesignSystemProvider>`, and do NOT create a `withProviders.tsx`.

Example structure:
```tsx
import { useEffect, useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import { embeddedScripts } from '@wix/app-management';
import '../../styles/tailwind.css';

const MyDashboardPage: FC = () => {
  const [options, setOptions] = useState<MyScriptOptions>(defaultOptions);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const embeddedScript = await embeddedScripts.getEmbeddedScript();
        const data = embeddedScript.parameters || {};
        // ... update options with data
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
      await embeddedScripts.embedScript({ parameters: { /* ... */ } });
      dashboard.showToast({ message: 'Saved!', type: 'success' });
    } catch (error) {
      console.error('Failed to save:', error);
      dashboard.showToast({ message: 'Failed to save', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1248px] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {isLoading ? (
        <div className="flex h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {/* form fields */}
        </div>
      )}
    </div>
  );
};

export default MyDashboardPage;
```

## Critical Notes

- Only implement UI for parameters that are relevant to your specific use case - ignore parameters that don't apply
- Build the UI with Tailwind utilities on plain React elements — do NOT import `@wix/design-system` or render `<WixDesignSystemProvider>`
- Import `styles/tailwind.css` ONCE in the page entry file
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
