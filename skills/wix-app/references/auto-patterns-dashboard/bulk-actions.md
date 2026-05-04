# Bulk Actions Rules

## Type Definitions
```typescript
interface BulkActionToolbar {
  primaryActions?: BulkActionGroup[];
  secondaryActions?: (BulkActionItem | DividerItem)[];
}

type BulkActionGroup = | { type: 'action'; action: { item: BulkActionItem } } | { type: 'menu'; menu: { label: string; items: (BulkActionItem | DividerItem)[] } };

interface DividerItem {
  type: 'divider';
}

interface BulkActionItem {
  id: string; // Must match custom resolver name
  type: 'bulkDelete' | 'custom';
  label?: string;
  biName: string; // MANDATORY
  bulkDelete?: {
    mode: 'modal';
    modal: {
      title?: { text?: string; id?: string };
      description?: { text: string };
      actions?: { submit?: { text: string }; cancel?: { text: string } };
      feedback?: { successToast?: { text: string }; errorToast?: { text: string } };
    };
  };
}

type CustomBulkActionsActionResolver = (params: {
  actionParams: { selectedValues: any[]; total: number };
  sdk: AutoPatternsSDK;
}) => ResolvedAction;
```

## Validation Logic
- **IF** `type: 'bulkDelete'` **THEN** `bulkDelete.mode: 'modal'` is **REQUIRED**.
- **IF** `type: 'custom'` **THEN** resolver implementation is **REQUIRED**.
- **IF** `primaryActions` AND `secondaryActions` both undefined **THEN** toolbar invalid.

## Implementation Rules
- **MUST** include `biName` for all bulk actions (`bulk-{action}-action`).
- **MUST** place toolbar configuration inside `table` or `grid` object.
- **MUST** use `CustomBulkActionsActionResolver` type for custom logic.
- **MUST** register custom resolvers in `AutoPatternsOverridesProvider`.
- **MUST** use `errorHandler` for Wix API calls in resolvers.
- **NEVER** use default navigation in bulk actions; implement explicitly.

## Canonical Example
```typescript
// Config
bulkActionToolbar: {
  primaryActions: [{
    type: 'action',
    action: {
      item: {
        id: 'bulkDelete',
        type: 'bulkDelete',
        label: 'Delete',
        biName: 'bulk-delete-action',
        bulkDelete: { mode: 'modal', modal: {} }
      }
    }
  }],
  secondaryActions: [
    {
      id: 'bulkExport',
      type: 'custom',
      label: 'Export',
      biName: 'bulk-export-action'
    }
  ]
}

// Resolver
export const bulkExport: CustomBulkActionsActionResolver = ({ actionParams }) => ({
  label: 'Export',
  icon: <Download />,
  biName: 'bulk-export-action',
  onClick: () => {
    // Logic using actionParams.selectedValues
  }
});
```
