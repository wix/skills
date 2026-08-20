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

### Page Wiring — Two Providers and `withDashboard`

A patterns page needs **both** providers plus the `withDashboard` export. Getting any of the three wrong is a mount failure, not a styling nit.

Per `WixPatternsProvider.md`: *"you need to add a `WixDesignSystemProvider` followed by a `WixPatternsProvider`."* Order matters — WDS outside, patterns inside.

**Requirement:** `@wix/dashboard` must be installed alongside `@wix/patterns` and `@wix/design-system` — `WixPatternsProvider` depends on it. Check all three in `package.json`.

```tsx
import { Table, useTableCollection, withDashboard } from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';

// Inner component — the hook call must sit BELOW both providers.
function MyCollectionPage() {
  const state = useTableCollection({
    queryName: 'my-items',
    itemKey: (item) => item.id,
    itemName: (item) => item.name,
    fetchData: async () => ({ items: [], total: 0 }),
    filters: {},
  });
  return (
    <CollectionPage>
      <Table state={state} columns={[{ title: 'Name', render: (item) => item.name }]} />
    </CollectionPage>
  );
}

function Page() {
  return (
    <WixDesignSystemProvider>
      <WixPatternsProvider>
        <MyCollectionPage />
      </WixPatternsProvider>
    </WixDesignSystemProvider>
  );
}

export default withDashboard(Page);
```

**The real constraint is tree position, not file layout.** Hooks like `useTableCollection` and `useEntityPage` read provider context, so they must run in a component *below* the providers. An inner content component in the same file (above) satisfies this; so does putting the page in its own file. Split files when the page grows, not to satisfy the provider rule.

**Wrong — hook called in the component that renders the providers:**
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

When the page needs **multiple routes**, use the `@wix/patterns` routing solution (`PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate`) rather than a separate router, and keep the router alongside the providers. Look up those doc files for setup details.

> Some projects also pass WDS feature flags, e.g. `<WixDesignSystemProvider features={{ newColorsBranding: true }}>`. That is a Wix Design System option, not a `@wix/patterns` requirement — it appears nowhere in the patterns docs. Follow the host project's existing convention.

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
| Reaching page state from a child component | `useEntityPageContext()` — no prop-drilling |
| The individual fields inside those cards | `@wix/design-system` (`FormField`, `Input`, `Text`) |

**Child field components use `useEntityPageContext`, not props.** It returns the `EntityPageState` from context, so any component rendered inside `EntityPage` can reach the form and the entity directly:

```tsx
const FormContent = () => {
  const pageState = useEntityPageContext<Entity, FormValues>();
  const field = useController({
    name: 'fieldName',
    control: pageState.form.control,
    defaultValue: pageState.entity?.fieldName,
  });
  return (
    <FormField label="Field">
      <Input value={field.field.value} onChange={field.field.onChange} />
    </FormField>
  );
};
```

Do not thread `form` or `entity` down through props — that is the prop-drilling this hook exists to remove.

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