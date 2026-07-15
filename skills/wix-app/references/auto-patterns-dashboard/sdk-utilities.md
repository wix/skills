# SDK Utilities Rules

## Type Definitions
```typescript
interface AutoPatternsSDK {
  closeModal: () => void;
  getOptimisticActions: (collectionId: string) => OptimisticActions;
  getSchema: (collectionId: string) => SchemaConfig | undefined;
  refreshCollection: () => void;
  collectionId: string;
}

interface OptimisticActions {
  createOne: (item: any, params: OptimisticParams) => void;
  createMany: (items: any[], params: OptimisticParams) => void;
  updateOne: (item: any, params: OptimisticParams) => void;
  updateMany: (items: any[], params: OptimisticParams) => void;
  updateAll: (transformFn: (item: any) => Partial<any>, params: OptimisticParams) => void;
  deleteOne: (item: any, params: DeleteParams) => void;
  deleteMany: (items: any[], params: DeleteParams) => void;
  deleteAll: (params: DeleteParams) => void;
}

interface OptimisticParams {
  submit: (items: any[]) => Promise<any>;
  successToast: string | ToastConfig;
  errorToast: (error: Error, actions: { retry: () => void }) => string | ToastConfig;
}

type DeleteParams = OptimisticParams & { showUndoToast: true };

interface ToastConfig {
  message: string; // Must use 'message' (not 'text')
  action?: { text: string; onClick: () => void };
}
```

## Validation Logic
- **IF** using `delete*` operations **THEN** `showUndoToast: true` is **REQUIRED**.
- **IF** returning `ToastConfig` **THEN** use `message` property (NOT `text`).
- **IF** using schema in submit **THEN** check `schema` existence first (can be undefined).

## Implementation Rules
- **MUST** use `optimisticActions` for data mutations (create/update/delete).
- **MUST** handle async submit failures in `errorToast`.
- **MUST** use `sdk.collectionId` for current context.
- **NEVER** use OptimisticActions for read-only operations.

## Canonical Example
```typescript
const optimisticActions = sdk.getOptimisticActions(sdk.collectionId);
const schema = sdk.getSchema(sdk.collectionId);

optimisticActions.updateOne(item, {
  submit: async (items) => {
    // Check schema existence
    if (!schema) return items[0];
    return await schema.actions.update(items[0]);
  },
  successToast: 'Item updated successfully',
  errorToast: (err, { retry }) => ({
    message: 'Update failed', // Use 'message'
    action: { text: 'Retry', onClick: retry }
  })
});
```
