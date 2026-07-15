# Custom Actions Override Rules

**REQUIRED**: After creating action files, you MUST update `page.tsx` to register them.

## Type Definitions
```typescript
interface ResolvedAction {
  label: string;
  icon?: React.ReactElement;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  hidden?: boolean;
}

// Action Resolver Signature
type CustomActionResolver = (params: {
  item: any;
  selectedItems?: any[];
}) => ResolvedAction;
```

## Configuration Schema
```json
{
  "actions": [
    {
      "type": "custom",
      "id": "myAction" // Matches override key
    }
  ]
}
```

## Validation Logic
- **IF** `type` is `"custom"` **THEN** `id` MUST match key in `actions` override.
- **IF** action is async **THEN** `onClick` SHOULD return a Promise.
- **IF** action requires selection **THEN** check `selectedItems`.

## Implementation Rules
- **MUST** be placed in `components/actions/` folder.
- **MUST** use `.tsx` extension if the file contains JSX (icons, React elements). Use `.ts` only for pure logic files.
- **MUST** export `useActions` hook from `components/actions/index.tsx`.
- **MUST** return `ResolvedAction` object.
- **MUST** handle errors (use `try/catch` or `errorHandler` for Wix APIs).
- **APPLIES TO** all custom action types: actionCell, collectionPageActions, onRowClick, bulkActions.
- **NEVER** place action resolvers directly in page.tsx or overrides.tsx - always use components/actions/ folder.

## Canonical Example
```tsx
// components/actions/myAction.tsx (use .tsx when file contains JSX like icons)
export const myAction = ({ item }) => ({
  label: 'Approve',
  icon: <Check />,
  onClick: async () => {
    await approveItem(item.id);
  }
});

// components/actions/index.tsx
import { myAction } from './myAction';
export const useActions = () => ({ myAction });
```

## page.tsx Registration (REQUIRED)

**CRITICAL: PRESERVE EXISTING OVERRIDES** - Do NOT remove existing overrides. ADD this new one alongside them.

```tsx
// 1. Add import (keep all existing imports)
import { useActions } from './components/actions';

// 2. Add hook call (keep all existing hook calls)
const actions = useActions();

// 3. Add actions to PatternsWizardOverridesProvider value (keep ALL existing overrides)
```
