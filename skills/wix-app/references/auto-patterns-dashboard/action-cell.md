# ActionCell Rules

## Type Definitions
```typescript
interface ActionCellConfig {
  primaryAction?: SinglePrimary | MultiplePrimary;
  secondaryActions?: {
    items: (ActionCellItem | DividerItem)[];
    inlineCount?: number;
    inlineAlwaysVisible?: boolean;
  };
}

interface SinglePrimary {
  item: ActionCellItem;
  alwaysVisible?: boolean;
}

interface MultiplePrimary {
  items: ActionCellItem[];
  alwaysVisible?: boolean;
}

interface ActionCellItem {
  id: string; // Matches resolver if custom
  type: 'update' | 'delete' | 'custom';
  label?: string;
  biName: string; // MANDATORY
  skin?: 'standard' | 'inverted' | 'premium' | 'dark' | 'destructive';
  update?: { mode: 'page'; page: { id: string } };
  delete?: { mode: 'modal'; modal: ModalConfig };
}

interface DividerItem {
  type: 'divider';
}

// Primary cell action resolver — primary actions don't accept `icon`; use `prefixIcon`/`suffixIcon`.
type CustomActionCellPrimaryActionResolver = (params: {
  actionParams: { item: any };
  sdk: AutoPatternsSDK;
}) => ResolvedActionCellPrimaryAction;
// ResolvedActionCellPrimaryAction = Omit<ResolvedAction, 'icon'> & { prefixIcon?: IconElement; suffixIcon?: IconElement }

// Secondary cell action resolver — uses standard ResolvedAction (with `icon`).
type CustomActionCellSecondaryActionResolver = (params: {
  actionParams: { item: any };
  sdk: AutoPatternsSDK;
}) => ResolvedAction;
```

## Validation Logic
- **IF** `type: 'update'` **THEN** `update` config with `page.id` is **REQUIRED**.
- **IF** `type: 'delete'` **THEN** `delete.mode: 'modal'` is **REQUIRED**.
- **IF** `type: 'custom'` **THEN** resolver implementation is **REQUIRED**.
- **IF** `type: 'custom'` **THEN** resolver MUST be registered via override pattern (see **custom_actions_override**).
- **IF** using `secondaryActions.inlineCount` **THEN** value MUST be <= items count.

## Implementation Rules
- **MUST** include `biName` for every action (`{action-purpose}-action`).
- **MUST** place `actionCell` at component level (sibling to `collection`), NOT inside `table`/`grid`.
- **MUST** implement custom resolvers using `CustomActionCellPrimaryActionResolver` (for primary actions) or `CustomActionCellSecondaryActionResolver` (for secondary actions).
- **MUST** use `errorHandler` for Wix API calls in resolvers.
- **SHOULD** use `multiplePrimary` for 2-3 equally important actions.
- **NEVER** use `primaryAction` inside `secondaryActions`.
- **NEVER** use `actionResolvers` prop on `AutoPatternsApp` - this prop does not exist.
- **NEVER** create resolver files outside `components/actions/` folder.

## Canonical Example
```typescript
// Config
actionCell: {
  primaryAction: {
    item: {
      id: 'editItem',
      type: 'update',
      label: 'Edit',
      biName: 'edit-action',
      skin: 'standard',
      update: { mode: 'page', page: { id: 'edit-page' } }
    },
    alwaysVisible: true
  },
  secondaryActions: {
    items: [
      {
        id: 'deleteItem',
        type: 'delete',
        label: 'Delete',
        biName: 'delete-action',
        skin: 'destructive',
        delete: { mode: 'modal', modal: {} }
      }
    ]
  }
}

// Resolvers (if custom) - see custom_actions_override for full registration pattern

// Primary action resolver: use prefixIcon (icon is not allowed on primary cell actions)
export const myPrimaryAction: CustomActionCellPrimaryActionResolver = ({ actionParams }) => ({
  label: 'Custom',
  prefixIcon: <MyIcon />,
  biName: 'custom-action',
  onClick: () => console.log(actionParams.item)
});

// Secondary action resolver: uses icon
export const mySecondaryAction: CustomActionCellSecondaryActionResolver = ({ actionParams }) => ({
  label: 'Custom',
  icon: <MyIcon />,
  biName: 'custom-action',
  onClick: () => console.log(actionParams.item)
});
```
