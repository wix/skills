# AppContext Rules

## Type Definitions
```typescript
interface AppContext {
  items: any[];
  refreshCollection: () => void;
}
```

## Validation Logic
- **IF** using `useAppContext` **THEN** component MUST be inside `AutoPatternsApp` (as children).

## Implementation Rules
- **MUST** wrap child components (modals, panels) with `<AutoPatternsApp>`.
- **MUST** use `useAppContext` to access shared collection data/refresh.
- **MUST** use `refreshCollection` after data mutations in external components.
- **NEVER** use `useAppContext` outside of the `AutoPatternsApp` tree.

## Canonical Example
```typescript
// 1. Child Component
const MyModal = () => {
  const { items, refreshCollection } = useAppContext();
  return (
    <Modal>
      <Text>Count: {items.length}</Text>
      <Button onClick={refreshCollection}>Refresh</Button>
    </Modal>
  );
};

// 2. Integration
<AutoPatternsApp configuration={config}>
  <MyModal />
</AutoPatternsApp>
```
