# Collection Page Action Rules

## Type Definitions
```typescript
interface CollectionPageActions {
  primaryActions?: ActionGroup;
  secondaryActions?: ActionGroup;
}

type ActionGroup = | { type: 'action'; action: { item: ActionItem } } | { type: 'menu'; menu: { label: string; items: (ActionItem | DividerItem)[] } };

interface DividerItem {
  type: 'divider';
}

interface ActionItem {
  id: string; // Must match custom resolver name if custom
  type: 'create' | 'custom';
  label?: string;
  biName: string; // MANDATORY
  collection?: {
    collectionId: string;
    entityTypeSource: 'cms' | 'custom';
  };
  create?: {
    mode: 'page';
    page: { id: string };
  };
}

// Row Click Action (Table level)
interface OnRowClickConfig {
  id: string;
  type: 'custom';
}

// Row Click Resolver Signature - NOTE: item is nested under actionParams
type CustomActionCollectionPageActionOnRowClickResolver = (params: {
  actionParams: { item: any };  // The clicked row's data - nested under actionParams
  sdk: AutoPatternsSDK;
}) => ResolvedAction;
```

## Validation Logic
- **IF** `type: 'create'` **THEN** `create` config with `page.id` is **REQUIRED**.
- **IF** `type: 'custom'` **THEN** `id` must match a registered resolver name.
- **IF** `onRowClick` is configured **THEN** matching `custom` resolver is **MANDATORY**.
- **IF** `onRowClick` is configured **THEN** default navigation is **DISABLED**.
- **IF** `onRowClick` resolver accesses row data **THEN** use `actionParams.item` (NOT direct `item` param).

## Implementation Rules
- **MUST** include a `create` action in `primaryActions` for every collection page.
- **MUST** include `biName` for every action (kebab-case).
- **MUST** implement custom resolvers using `CustomActionCollectionPageActionResolver`.
- **MUST** implement row click resolvers using `CustomActionCollectionPageActionOnRowClickResolver` returning `ResolvedAction`.
- **MUST** place onRowClick resolvers in `components/actions/` folder (same as other custom actions).
- **MUST** register onRowClick resolvers via `useActions` hook pattern (see **custom_actions_override**).
- **NEVER** mix `create` logic with `custom` action types.
- **NEVER** assume `schema` or `optimisticActions` exist without checking.

## Canonical Example
```typescript
{
  primaryActions: {
    type: 'action',
    action: {
      item: {
        id: 'create-pet',
        type: 'create',
        label: 'Add Pet',
        biName: 'create-pet-action',
        collection: { collectionId: 'pets', entityTypeSource: 'cms' },
        create: {
          mode: 'page',
          page: { id: 'pet-details' }
        }
      }
    }
  },
  secondaryActions: {
    type: 'menu',
    menu: {
      label: 'More',
      items: [
        {
          id: 'exportCollection',
          type: 'custom',
          label: 'Export',
          biName: 'export-action',
          collection: { collectionId: 'pets', entityTypeSource: 'cms' }
        }
      ]
    }
  }
}
```

## Canonical Example (onRowClick)
```typescript
// Config
{
  "onRowClick": {
    "id": "myRowClickAction",
    "type": "custom"
  }
}

// Resolver (if custom) - see custom_actions_override for full registration pattern
export const myRowClickAction: CustomActionCollectionPageActionOnRowClickResolver = ({
  actionParams: { item },  // item is nested under actionParams
}) => ({
  label: 'Custom Action',
  icon: <MyIcon />,
  biName: 'my-row-click-action',
  onClick: () => {
    // Custom onClick logic using item
  }
});
```
