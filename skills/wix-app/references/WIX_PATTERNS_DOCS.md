# @wix/patterns Component Documentation

## Prerequisites

This skill bundles `scripts/patterns.cjs`. It locates the docs itself (pnpm, Yarn PnP, workspaces, symlinks) and prints them. **Never inspect `node_modules` by hand** — no `ls`, no `find`, no `cat` of a doc path.

Invoke it by absolute path — no shell variable. One does not survive to the next Bash call, and `wix-design-system` bundles its helper the same way, so a `$PATTERNS` beside its `$WDS` is how one ends up holding the other's path.

```bash
node <this-skill-dir>/scripts/patterns.cjs list   # inventory, by category
```

Subcommands take that same prefix. The script echoes the resolved path in its hints, so copy it from there.

| Subcommand | Gives you |
| --- | --- |
| `list` | every documented name, by category |
| `docs <Name1> <Name2> ...` | import + API + one example, per name |
| `docs <Name> --full` | the whole doc, design prose included |
| `docs <Name> --refs` | cross-references, one level |
| `types <Name1> <Name2> ...` | the signature of any export — hook, factory or type |
| `exports [subpath]` | what an entry point exports; no argument lists them |

`list` doubles as the prerequisite check — run it once. If it prints the inventory, you are set.

If it exits non-zero, `@wix/patterns` is absent or older than **1.452.0**. The error names the install command — run it, then `list` once more.

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

| Component | State Type | Hook |
| --- | --- | --- |
| `Table` | `TableState` | `useTableCollection()` |
| `Grid` | `GridState` | `useGridCollection()` |
| `TableGridSwitch` | `TableGridSwitchState` | `useTableGridSwitchCollection()` |
| `TableFolders` | `TableFoldersState` | `useTableFolders()` |
| `GridFolders` | `GridFoldersState` | `useGridFolders()` |

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

**Wrong:** calling `useTableCollection` in the same component that renders `WixPatternsProvider`. The hook runs before the provider it needs exists above it, so it throws at runtime — the JSX nesting looks right, which is what makes this one hard to spot.

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
  // works — the provider context exists above this component
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
```

Always keep the provider (and router if needed) in the app's root component, and each page in its own file.

When the user needs **multiple pages**, use the `@wix/patterns` routing solution (`PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate`) instead of a separate router. Look up the relevant doc files for setup details.

## How to Look Things Up

**Don't guess which components or props exist — read the doc files first.**

### Finding the right name

Use the `list` output from [Prerequisites](#prerequisites) — grouped by category, related components sharing a prefix.

Matching is case-insensitive and a typo gets a suggestion (`Tabel` -> `Did you mean: Table`). Quote names with spaces: `docs "AI Assistant"`.

### Reading doc files

The inventory only tells you a component exists — read its doc before using it. **Always check the import statement** — not everything comes from `@wix/patterns` (some use subpaths like `@wix/patterns/provider`).

Pass every name you need in **one** call; docs come back separated by `---`:

```bash
patterns.cjs docs Table useTableCollection TableState
```

Each name returns its import line and props table; ask for one or two names and you also get a usage example (batching more drops examples so the later props still fit). The first output line gives the total length, so **read it rather than piping through `head`** — trimming costs you the props, and then you are guessing at prop names. Need more than the table? `--full`, one component at a time.

### Types the docs don't cover

The docs cover components and props, not the types those props use — `Filter<T>`, `RangeItem<T>`, `CursorQuery`, a `...Props` interface — several of which come from `@wix/bex-core`. Guess the path and `@wix/bex-core/dist/types/...` ends up in the tree: a deep import into an undeclared package.

```bash
patterns.cjs types RangeItem CursorQuery
```

It prints the import to actually write — always from `@wix/patterns`, even for a type declared elsewhere — plus the declaration. Use it whenever you name one of these types in your own code.

`@wix/patterns` is 31 entry points, not one namespace, and `/form` just re-exports `@wix/bex-core/form`. To see what lives behind one: `exports page`, or `exports` alone to list them.

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