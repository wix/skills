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
- **IF** `onRowClick` is configured **THEN** its resolver must produce the declared visible outcome; an empty handler, `void` placeholder, or comment-only body is invalid.

## Implementation Rules
- **MUST** include a create action only when users can create the managed entity in this workflow.
- **MUST** include `biName` for every action (kebab-case).
- **MUST** implement custom resolvers using `CustomActionCollectionPageActionResolver`.
- **MUST** implement row click resolvers using `CustomActionCollectionPageActionOnRowClickResolver` returning `ResolvedAction`.
- **MUST** place onRowClick resolvers in `components/actions/` folder (same as other custom actions).
- **MUST** register onRowClick resolvers via `useActions` hook pattern (see **custom_actions_override**).
- **MUST** use `actionParams.item` to produce the selected surface outcome. For a SidePanel, call a page-owned `openItem(item)` callback; for a Modal or entity page, invoke its documented navigation API. Do not rebuild the collection table or own a parallel data lifecycle.
- **MUST** choose the detail surface from depth and context: SidePanel for moderate contextual work, Modal for short blocking work, and entity page for deep or multi-section work. These are recommendations, not rules based only on `view` versus `edit`.
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
export const createRowClickAction = (
  openItem: (item: Record<string, unknown>) => void,
): CustomActionCollectionPageActionOnRowClickResolver =>
  ({ actionParams: { item } }) => ({
    label: 'View details',
    icon: <MyIcon />,
    biName: 'view-details-action',
    onClick: () => openItem(item),
  });
```
