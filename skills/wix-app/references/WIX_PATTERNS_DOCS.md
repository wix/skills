# @wix/patterns Component Documentation

## Prerequisites

The docs are pre-built at `node_modules/@wix/patterns/dist/docs/` (160+ markdown files + `index.json`). This requires `@wix/patterns` version **1.367.0** or later. Verify they exist:

```bash
ls node_modules/@wix/patterns/dist/docs/   # expect ~165 .md files + index.json
```

If the directory is missing, install the package at the minimum version:

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

This table covers the common collection types — the full, authoritative list is in `node_modules/@wix/patterns/dist/docs/index.json`.

Create state with the hook -> pass it to the component's `state` prop -> wrap in a page component.

### Choosing the Right Provider

| Provider                        | When to Use                                                                          |
|---------------------------------|--------------------------------------------------------------------------------------|
| `WixPatternsProvider`           | **Default — start here.** Auto-detects the environment (BM, Essentials, Giza) and supplies the right context. |
| `WixPatternsBMProvider`         | Optional alternative for Yoshi BM Flow over Business Manager.                        |
| `WixPatternsGizaProvider`       | Optional alternative for Yoshi BM Flow over Giza.                                    |
| `WixPatternsEssentialsProvider` | Yoshi Fullstack.                                                                     |
| `WixPatternsBaseProvider`       | App does **not** run under a Giza/WixEssentials environment and you inject services (i18n, sentry) yourself. |

Prefer `WixPatternsProvider` unless the project is on one of the specific Yoshi flows above — it is the documented recommendation for most apps, and it resolves the environment for you rather than making you pick.

**Confirm the import path in the provider's own doc file** — these do not all come from the same subpath (`WixPatternsEssentialsProvider` and `WixPatternsBaseProvider` are under `@wix/patterns/essentials`, for instance). Check the project's `package.json` to identify the flow.

### Keep Provider and Page Separate

The provider **must** be in a separate parent component from the page content. Hooks like `useTableCollection` require the provider's context to already exist above them in the React tree.

**Wrong — provider and page in the same component:**
```tsx
function BadApp() {
  const state = useTableCollection({
    queryName: 'my-items',
    itemKey: (item) => item.id,
    itemName: (item) => item.name,
    fetchData: async () => ({ items: [], total: 0 }),
    filters: {},
  }); // fails at runtime — no provider context above this component
  return (
    <WixPatternsProvider>
      <CollectionPage>
        <Table state={state} columns={[{ title: 'Name', render: (item) => item.name }]} />
      </CollectionPage>
    </WixPatternsProvider>
  );
}
```

**Correct — provider in root, page in a separate file:**
```tsx
// App.tsx
import { WixPatternsProvider } from '@wix/patterns/provider';

function App() {
  return (
    <WixPatternsProvider>
      <MyCollectionPage />
    </WixPatternsProvider>
  );
}

// MyCollectionPage.tsx
import { Table, useTableCollection } from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';

function MyCollectionPage() {
  const state = useTableCollection({
    queryName: 'my-items',
    itemKey: (item) => item.id,
    itemName: (item) => item.name,
    fetchData: async () => ({ items: [], total: 0 }),
    filters: {},
  }); // works — the provider context exists above this component
  return (
    <CollectionPage>
      <Table state={state} columns={[{ title: 'Name', render: (item) => item.name }]} />
    </CollectionPage>
  );
}
```

Always keep the provider (and router if needed) in the app's root component, and each page in its own file.

When the user needs **multiple pages**, use the `@wix/patterns` routing solution (`PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate`) instead of a separate router. Look up the relevant doc files for setup details.

## How to Look Things Up

**Don't guess which components or props exist — read the doc files first.**

### Finding the right file

- **By name:** Read `node_modules/@wix/patterns/dist/docs/index.json` — it maps every component name to its doc file and category.
- **By browsing:** List the `dist/docs/` folder. Filenames match component names directly (e.g., `Table.md`, `useTableCollection.md`). Note some names contain spaces (`AI Assistant.md`) or dots (`CollectionPage.Header.md`) — quote paths when searching.
- **By concept:** Search filenames for keywords (e.g., "filter"). Check `index.json` categories — related components share a category prefix.

### Reading doc files

Each doc contains the component's category, import path, description, code examples, and API props table. **Always check the import statement** — not everything comes from `@wix/patterns` (some use subpaths like `@wix/patterns/provider`).

### Following cross-references

Docs contain relative Storybook URLs like `[TableState](./?path=/story/...--tablestate)`. To resolve these, **use the link text as the filename**: `[TableState](...)` -> read `TableState.md`.

Links to `https://www.docs.wixdesignsystem.com/` are external (Wix Design System) — not part of `@wix/patterns` docs.

## The Collection → Entity Flow

A collection page and its item form are **two patterns pages**, not a page plus a modal. Getting the table right and then hand-building the "add item" form in a dashboard modal is the most common way this goes wrong.

| Step | What owns it |
| --- | --- |
| Navigate from a row / primary action to the item | `usePatternsNavigate()` → `navigateToEntityPage({ path, entity })` |
| Register the route | `PatternsReactRoute` inside `PatternsReactRouter` |
| Fetch, save, validation, dirty state, skeletons, errors | `useEntityPage({ fetch, onSave })` |
| Form state and field binding | `useForm` / `useController` from `@wix/patterns/form` |
| Body layout | `EntityPage.Header`, `.MainContent`, `.AdditionalContent`, `.Card` |
| The individual fields inside those cards | `@wix/design-system` (`FormField`, `Input`, `Text`) |

`navigateToEntityPage` is preferred over a plain route change because the entity header (title, subtitle, breadcrumbs) renders immediately, without waiting for the fetch.

Read `EntityPage.md`, `useEntityPage.md`, and `usePatternsNavigate.md` before implementing — and note that `useCreateCollection` is **not** about creating items; it returns a function that initializes collection state.

Reserve dashboard modals for genuine dialogs — delete confirmations, short prompts — not entity editing.

## When Patterns Has No Equivalent

A concept is only "missing" from patterns after you've checked `index.json` **and** searched the docs folder by keyword. Then, and only then:

1. Look the component up in `@wix/design-system` via the `wix-design-system` skill.
2. Render it *inside* the patterns page shell / collection, not as a replacement for it.
3. If WDS lacks it too, compose from WDS primitives (`Box`, `Card`, `Text`) — never restyle patterns internals or add another UI library.

Anything page- or collection-shaped (page shell, header, table, grid, filters, sorting, paging, row actions, bulk actions) is patterns' territory. If you're about to build one of those from WDS parts, you skipped a lookup.

## Tips

- **Compound components** have separate docs per sub-part: `CollectionPage.md`, `CollectionPage.Header.md`, `CollectionPage.Content.md`.
- **Hook docs** list configuration options as props in the API table.
- **Type docs** (e.g., `TableState.md`) describe the shape of state objects.