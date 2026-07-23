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

## Contextual Detail Integration

Use this SidePanel pattern when an Auto Patterns collection row opens moderate-depth supplemental view or edit content while retaining table context. Use a Modal for a short blocking task and an entity page for a deep, multi-section, or long-running flow.

1. The page component owns `selectedItem` state and renders the generated Auto Patterns collection page unchanged.
2. A documented custom row/action resolver receives `actionParams.item` and calls the page-owned `openItem(item)` callback.
3. The page renders the WDS `SidePanel` as an `AutoPatternsApp` child through the standard dashboard overlay host. The host is outside page, table, and card overflow containers.
4. The panel reads the selected record from page state, uses AppContext for collection-wide data or `refreshCollection`, and clears its selected item after a successful mutation or when the record is no longer present.

The collection table, selection, filters, layouts, CRUD lifecycle, and refresh lifecycle remain Auto Patterns-owned. The SidePanel is contextual detail only; do not recreate the table in custom WDS JSX.

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
