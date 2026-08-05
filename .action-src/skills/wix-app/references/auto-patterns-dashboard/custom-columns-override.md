# Custom Columns Override Rules

**REQUIRED**: After creating column files, you MUST update `page.tsx` to register them.

## Type Definitions
```typescript
interface IColumnValue<T> {
  value: T; // The individual column value
  row: Record<string, any>; // The entire row object containing all field values
}

// Override Function Signature
type ColumnOverride<T> = (props: IColumnValue<T>) => React.ReactNode;
```

## Configuration Schema
```json
{
  "type": "collectionPage",
  "collectionPage": {
    "components": [
      {
        "layout": [
          {
            "type": "Table",
            "table": {
              "columns": [
                {
                  "id": "myCustomColumn" // Matches key in override object
                }
              ]
            }
          }
        ]
      }
    ]
  }
}
```

## Validation Logic
- **IF** overriding a column **THEN** function name MUST match the `column.id` in AppConfig.
- **IF** needing React hooks (useState, useEffect) **THEN** MUST wrap implementation in a separate React component and return it.
- **IF** accessing row data **THEN** MUST use exact field IDs from schema as keys on `row` object.
- **NEVER** use React hooks directly inside the column override function (it is a render function, not a component).

## Implementation Rules
- **MUST** be placed in `components/columns/` folder.
- **MUST** export a `useColumns` hook from `components/columns/index.tsx`.
- **MUST** import type `IColumnValue` from `@wix/auto-patterns` for type safety.
- **MUST** return a ReactNode (JSX) or null.

## Canonical Example
```tsx
// components/columns/status.tsx
import type { IColumnValue } from '@wix/auto-patterns';
import { Badge } from '@wix/design-system';

export function status({ value, row }: IColumnValue<string>) {
  // Pure rendering logic - NO HOOKS here
  const skin = value === 'Active' ? 'success' : 'danger';
  return <Badge skin={skin}>{value}</Badge>;
}

// components/columns/index.tsx
import { status } from './status';
export const useColumns = () => ({ status });
```

## page.tsx Registration (REQUIRED)

**CRITICAL: PRESERVE EXISTING OVERRIDES** - Do NOT remove existing overrides. ADD this new one alongside them.

```tsx
// 1. Add import (keep all existing imports)
import { useColumns } from './components/columns';

// 2. Add hook call (keep all existing hook calls)
const columns = useColumns();

// 3. Add columns to PatternsWizardOverridesProvider value (keep ALL existing overrides)
```
