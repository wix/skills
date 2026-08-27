# @wix/patterns Component Documentation

## Prerequisites

This skill bundles `scripts/patterns.cjs`. It locates the docs itself (pnpm, Yarn PnP, workspaces, symlinks) and prints them. **Never inspect `node_modules` by hand** — no `ls`, no `find`, no `cat` of a doc path.

```bash
PATTERNS="<this-skill-dir>/scripts/patterns.cjs"

node $PATTERNS list                        # inventory, by category
node $PATTERNS docs <Name1> <Name2> ...    # import + API + one example, per name
node $PATTERNS docs <Name> --full          # ...the whole doc, design prose included
node $PATTERNS docs <Name> --refs          # ...following cross-references one level
node $PATTERNS types <Name1> <Name2> ...   # the TypeScript types the props are written in
```

`list` doubles as the prerequisite check — run it once. If it prints the inventory, you are set.

If it exits non-zero, `@wix/patterns` is absent or predates 1.367.0 (the first version shipping `dist/docs/`). Install the latest version, then re-run `list` once:

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

Common types only; `list` has the authoritative set.

Create state with the hook -> pass it to the component's `state` prop -> wrap in a page component.

### Choosing the Right Provider

| Provider                        | When to Use                                                                          |
|---------------------------------|--------------------------------------------------------------------------------------|
| `WixPatternsProvider`           | **Default — start here.** Auto-detects the environment (BM, Essentials, Giza) and supplies the right context. |
| `WixPatternsBMProvider`         | Optional alternative for Yoshi BM Flow over Business Manager.                        |
| `WixPatternsGizaProvider`       | Optional alternative for Yoshi BM Flow over Giza.                                    |
| `WixPatternsEssentialsProvider` | Yoshi Fullstack.                                                                     |
| `WixPatternsBaseProvider`       | App does **not** run under a Giza/WixEssentials environment and you inject services (i18n, sentry) yourself. |

**Confirm the import path in the provider's own doc file** — these do not all come from the same subpath (`WixPatternsEssentialsProvider` and `WixPatternsBaseProvider` are under `@wix/patterns/essentials`, for instance). Check the project's `package.json` to identify the flow.

### Keep Provider and Page Separate

The provider **must** be in a separate parent component from the page content. Hooks like `useTableCollection` require the provider's context to already exist above them in the React tree.

**Wrong — the hook sits above its own provider:**
```tsx
function BadApp() {
  const state = useTableCollection({ /* ... */ }); // fails at runtime: no provider context yet
  return (
    <WixPatternsProvider>
      <CollectionPage><Table state={state} /></CollectionPage>
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
  const state = useTableCollection({ /* ... */ }); // works — provider is above this component
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

### Finding the right name

Use the `node $PATTERNS list` output from [Prerequisites](#prerequisites) — it groups every name by category, and related components share a prefix. Don't run it twice.

Matching is case-insensitive, and a typo gets a suggestion back (`Tabel` -> `Did you mean: Table`). Quote names containing spaces: `node $PATTERNS docs "AI Assistant"`.

### Reading doc files

The inventory only tells you a component exists — read its doc before using it. **Always check the import statement** — not everything comes from `@wix/patterns` (some use subpaths like `@wix/patterns/provider`).

Pass every name you need in **one** call; docs come back separated by `---`:

```bash
node $PATTERNS docs Table useTableCollection TableState
```

Each name comes back as import line + API/props table + one usage example; the design prose is left out, which is what keeps a six-name call readable. **Don't pipe this through `head`** — a long doc keeps its props table near the end (`ToolbarFilters.md`: line 1,554 of 1,580), so trimming the output leaves you with prose and no props, guessing at prop names. If one component needs more, ask for that one with `--full`.

### Types the docs don't cover

The docs cover components and props, not the TypeScript types those props are written in — `Filter<T>`, `RangeItem<T>`, `CursorQuery`, a `...Props` interface — and several are re-exported from `@wix/bex-core` rather than declared here. Guess the path and you get `@wix/bex-core/dist/types/...` in the tree: a deep import into a package this project never declared.

```bash
node $PATTERNS types RangeItem CursorQuery
```

It prints the import to actually write — always from `@wix/patterns`, even for a type declared elsewhere — plus the declaration. Use it whenever you name one of these types in your own code.

### Following cross-references

Docs link to related names as Storybook URLs (`[TableState](./?path=/story/...--tablestate)`). The script resolves the link text back to a component and, after printing, lists the cross-referenced names it did not print plus the command to fetch them. Take what you need from that list rather than chasing every link; `--refs` follows one level automatically.

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