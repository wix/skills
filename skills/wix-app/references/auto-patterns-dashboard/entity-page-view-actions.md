# Entity Page Action Rules (View Mode)

## Type Definitions
```typescript
interface EntityPageViewActions {
  primaryActions?: ActionGroup;
  secondaryActions?: ActionGroup;
  moreActions?: (CustomActionItem | DividerItem)[];
}

type ActionGroup = | { type: 'action'; action: { item: ActionItem } } | { type: 'menu'; menu: { label: string; items: (ActionItem | DividerItem)[] } };

interface DividerItem {
  type: 'divider';
}

interface ActionItem {
  id: string; // Must match resolver if custom
  label: string;
  type: 'create' | 'custom';
  biName: string; // MANDATORY
  create?: {
    mode: 'page';
    page: { id: string };
  };
}

type CustomEntityPageActionResolver = (params: {
  actionParams: { entity: any };
  sdk: AutoPatternsSDK;
}) => ResolvedAction;
```

## Validation Logic
- **IF** mode is `'view'` **THEN** supports `primaryActions`, `secondaryActions`, AND `moreActions`.
- **IF** action type is `'create'` **THEN** `create` config is **REQUIRED**.
- **IF** action type is `'custom'` **THEN** resolver implementation is **REQUIRED**.

## Implementation Rules
- **MUST** use `primaryActions` for main workflow (e.g. Create).
- **MUST** use `secondaryActions` for supporting workflows.
- **MUST** use `moreActions` for less common/admin tasks.
- **MUST** check error handling rules: `errorHandler` for Wix APIs, none for external/SDK.
- **NEVER** manually add "Edit" action; it's automatic if an Edit Mode page exists.

## Canonical Example
```typescript
{
  primaryActions: {
    type: 'action',
    action: {
      item: {
        id: 'createEntity',
        label: 'Create New',
        type: 'create',
        biName: 'create-entity-action',
        create: {
          mode: 'page',
          page: { id: 'entity-edit-page' }
        }
      }
    }
  },
  moreActions: [
    {
      id: 'duplicateEntity',
      type: 'custom',
      label: 'Duplicate',
      biName: 'duplicate-entity-action'
    }
  ]
}
```
