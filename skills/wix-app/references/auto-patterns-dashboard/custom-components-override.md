# Custom Components Override Rules

**REQUIRED**: After creating component files, you MUST update `page.tsx` to register them.

## Type Definitions
```typescript
interface CustomComponentProps {
  form: UseFormReturn; // react-hook-form instance
  entity: Record<string, any>; // Initial entity state (static)
}

// Override Component Signature
type CustomComponent = React.FC<CustomComponentProps>;
```

## Configuration Schema
```json
{
  "layout": [
    {
      "type": "Form",
      "form": {
        "groups": [
          {
            "fields": [
              {
                "id": "myCustomField",
                "type": "custom",
                "componentId": "myCustomComponent" // Matches override key
              }
            ]
          }
        ]
      }
    }
  ]
}
```

## Validation Logic
- **IF** overriding an input field **THEN** MUST use `useController` from `@wix/patterns/form` to bind to form state.
- **IF** needing reactivity **THEN** MUST use `form.watch()`, NEVER rely on `entity` prop for updates (it is initial state only).
- **IF** implementing a standalone widget (not input) **THEN** can use `entity` for display-only static data.
- **NEVER** import `useController` from `react-hook-form` directly; use `@wix/patterns/form`.

## Implementation Rules
- **MUST** be placed in `components/customComponents/` folder.
- **MUST** export a `useComponents` hook from `components/customComponents/index.tsx`.
- **MUST** handle form state (invalid, error message, onChange) properly via controller.

## Canonical Example
```tsx
// components/customComponents/CustomInput.tsx
import { useController } from '@wix/patterns/form';
import type { CustomComponentProps } from '@wix/auto-patterns';
import { Input, FormField } from '@wix/design-system';

export const CustomInput: React.FC<CustomComponentProps> = ({ form, entity }) => {
  const { field, fieldState } = useController({
    name: 'title', // Matches schema field ID
    control: form.control,
    defaultValue: entity?.title
  });

  return (
    <FormField label="Title" status={fieldState.error ? 'error' : undefined}>
      <Input {...field} />
    </FormField>
  );
};

// components/customComponents/index.tsx
import { CustomInput } from './CustomInput';
export const useComponents = () => ({ CustomInput });
```

## page.tsx Registration (REQUIRED)

**CRITICAL: PRESERVE EXISTING OVERRIDES** - Do NOT remove existing overrides. ADD this new one alongside them.

```tsx
// 1. Add import (keep all existing imports)
import { useComponents } from './components/customComponents';

// 2. Add hook call (keep all existing hook calls)
const components = useComponents();

// 3. Add components to PatternsWizardOverridesProvider value (keep ALL existing overrides)
```
