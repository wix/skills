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

- Show a loading indicator while isLoading is true
- Example:
  ```typescript
  {isLoading ? (
    <div className="flex h-64 items-center justify-center">
      <p className="text-sm text-gray-500">Loading…</p>
    </div>
  ) : (
    // ... form content
  )}
  ```

### 5. Form Components

- **IMPORTANT:** Only create form fields for parameters relevant to your use case
- Skip parameters that don't apply to the functionality being built
- Create Tailwind form fields based on parameter types — see [TAILWIND.md](../TAILWIND.md) for patterns:
  * TEXT → `<input className="w-full rounded-md border px-3 py-2 text-sm" />`
  * NUMBER → `<input type="number" className="w-full rounded-md border px-3 py-2 text-sm" />`
  * BOOLEAN → `<input type="checkbox" className="h-4 w-4 rounded" />`
  * IMAGE → Custom image picker using `dashboard.openMediaManager()`
  * DATE → `<input type="date" className="w-full rounded-md border px-3 py-2 text-sm" />`
  * SELECT → `<select className="w-full rounded-md border px-3 py-2 text-sm" />`
  * URL → `<input type="url" className="w-full rounded-md border px-3 py-2 text-sm" />`
- Wrap each field in `<label className="block">` with a label `<span>`
- Set required validation based on parameter.required flag
- Show validation errors with `<p className="mt-1 text-sm text-red-600">`

### 6. Save Functionality

- Add a Save button in the page header
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
- Show error states on inputs (e.g., `border-red-500`)
- Display clear error messages below the field

### 8. Layout and Organization

- Use `<section className="rounded-lg border bg-white p-6">` to group related fields
- Use `flex flex-col gap-4` for form layout
- Include helpful descriptions with `<p className="text-sm text-gray-500">`
- Consider creating a separate settings component for complex forms

### 9. Preview Component (Optional but Recommended)

- If applicable, create a preview component that shows how the configuration will look
- Display the preview alongside the settings form using a grid layout (`grid grid-cols-2 gap-6`)
- The preview should react to parameter changes in real-time

## Example Implementation

See the generated site-popup example for a complete reference implementation:
- src/extensions/dashboard/pages/page.tsx - Dashboard page with parameter management
- src/extensions/dashboard/components/site-popup-settings.tsx - Settings form component
- src/extensions/dashboard/types.ts - Type definitions

Key implementation patterns from the example:
1. Import `globals.css` in page.tsx
2. Parameters are saved as individual string fields, not as JSON
3. Parameters are loaded with proper type conversion (string to boolean, string to number, etc.)
4. Use embeddedScripts directly from '@wix/app-management'

## File Generation Requirements

When dynamic parameters are present, generate these files:
1. src/extensions/dashboard/pages/page.tsx - The main dashboard page component
2. src/extensions/dashboard/types.ts - Type definitions for the parameters (if needed)
3. Any additional component files (settings forms, previews, etc.)

## Example Page Structure

```typescript
import { useEffect, useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import { embeddedScripts } from '@wix/app-management';
import '../../styles/globals.css';

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

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Script Settings</h1>
        <button
          type="button"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </header>
      {/* Form fields */}
    </main>
  );
};

export default MyDashboardPage;
```

## Critical Notes

- Only implement UI for parameters that are relevant to your specific use case - ignore parameters that don't apply
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
- Use Tailwind CSS for all UI — see [TAILWIND.md](../TAILWIND.md)
