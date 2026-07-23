---
name: wix-patterns-docs
description: Provides component documentation for the @wix/patterns library. Use when creating, updating, or debugging code that imports from @wix/patterns, @wix/patterns/page, or related subpaths, or when the user asks about a patterns component, hook, type, or usage example.
---

# @wix/patterns Component Documentation

## When to Use

Consult the generated docs whenever you work with `@wix/patterns` imports — to look up props, usage examples, or understand how components compose together.

## Prerequisites

The docs are pre-built at `node_modules/@wix/patterns/dist/docs/` (160+ markdown files + `index.json`). This requires `@wix/patterns` version **1.367.0** or later. If the docs directory doesn't exist, ensure the package is installed at the minimum version:

```bash
npm install @wix/patterns@^1.367.0
```

## Library Architecture

### Composition Hierarchy

```
Provider                     <- WixPatternsProvider or WixPatternsBMProvider
  +-- Page                   <- CollectionPage, EntityPage, or SettingsPage
       +-- Collection        <- Table, Grid, TableGridSwitch, etc.
            +-- Features     <- filters, actions, sorting, drag-and-drop, etc.
```

### The Collection Triad

Each collection type follows the same Component + State + Hook pattern:

| Collection       | Component          | State Type              | Hook                            |
|------------------|--------------------|-------------------------|---------------------------------|
| Table            | `Table`            | `TableState`            | `useTableCollection()`          |
| Grid             | `Grid`             | `GridState`             | `useGridCollection()`           |
| TableGridSwitch  | `TableGridSwitch`  | `TableGridSwitchState`  | `useTableGridSwitchCollection()`|
| TableFolders     | `TableFolders`     | `TableFoldersState`     | `useTableFolders()`             |
| GridFolders      | `GridFolders`      | `GridFoldersState`      | `useGridFolders()`              |

Create state with the hook -> pass it to the component's `state` prop -> wrap in a page component.

### Choosing the Right Provider

| Provider                        | When to Use                                          | Import From              |
|---------------------------------|------------------------------------------------------|--------------------------|
| `WixPatternsProvider`           | Projects using `@wix/cli`.                           | `@wix/patterns/provider` |
| `WixPatternsBMProvider`         | Projects using `@wix/yoshi-flow-bm`.                 | `@wix/patterns/bm`       |

Check the project's `package.json` dependencies to determine which one applies.

### Keep Provider and Page Separate

The provider **must** be in a separate parent component from the page content. Hooks like `useTableCollection` require the provider's context to already exist above them in the React tree.

**Wrong — provider and page in the same component:**
```tsx
function App() {
  const state = useTableCollection({ ... }); // fails — no provider context yet
  return (
    <WixPatternsProvider>
      <CollectionPage>
        <Table state={state} />
      </CollectionPage>
    </WixPatternsProvider>
  );
}
```

**Correct — provider in root, page in a separate file:**
```tsx
// App.tsx
function App() {
  return (
    <WixPatternsProvider>
      <MyCollectionPage />
    </WixPatternsProvider>
  );
}

// MyCollectionPage.tsx
function MyCollectionPage() {
  const state = useTableCollection({ ... }); // works
  return (
    <CollectionPage>
      <Table state={state} />
    </CollectionPage>
  );
}
```

Always keep the provider (and router if needed) in the app's root component, and each page in its own file.

When the user needs **multiple pages**, use the `@wix/patterns` routing solution (`PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate`) instead of a separate router. Look up the relevant doc files for setup details.

## How to Look Things Up

**Don't guess which components or props exist — read the doc files first.**

### Finding the right file

- **By name:** Read `index.json` — it maps every component name to its doc file and category.
- **By browsing:** List the `dist/docs/` folder. Filenames match component names directly (e.g., `Table.md`, `useTableCollection.md`).
- **By concept:** Search filenames for keywords (e.g., "filter"). Check `index.json` categories — related components share a category prefix.

### Reading doc files

Each doc contains the component's category, import path, description, code examples, and API props table. **Always check the import statement** — not everything comes from `@wix/patterns` (some use subpaths like `@wix/patterns/provider`).

### Following cross-references

Docs contain relative Storybook URLs like `[TableState](./?path=/story/...--tablestate)`. To resolve these, **use the link text as the filename**: `[TableState](...)` -> read `TableState.md`.

Links to `https://www.docs.wixdesignsystem.com/` are external (Wix Design System) — not part of `@wix/patterns` docs.

## Tips

- **Compound components** have separate docs per sub-part: `CollectionPage.md`, `CollectionPage.Header.md`, `CollectionPage.Content.md`.
- **Hook docs** list configuration options as props in the API table.
- **Type docs** (e.g., `TableState.md`) describe the shape of state objects.