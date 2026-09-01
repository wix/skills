# @wix/patterns Component Documentation

## Prerequisites

Lookups here are direct file reads — no script. Resolve the installed package root once per session and reuse it:

```bash
node -e "
const fs = require('fs'), path = require('path');
function tryEnablePnp() {
  let dir = process.cwd();
  for (;;) {
    const pnp = path.join(dir, '.pnp.cjs');
    if (fs.existsSync(pnp)) { try { require(pnp).setup(); } catch {} return; }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
tryEnablePnp();
try {
  console.log(path.dirname(require.resolve('@wix/patterns/package.json', { paths: [process.cwd()] })));
} catch {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '@wix', 'patterns');
    if (fs.existsSync(path.join(candidate, 'package.json'))) { console.log(candidate); process.exit(0); }
    const parent = path.dirname(dir);
    if (parent === dir) { console.error('@wix/patterns not found'); process.exit(1); }
    dir = parent;
  }
}
"
```

A bare `require.resolve` without the PnP-activation step throws in a Yarn Berry project even when the package is genuinely installed — run the whole snippet, not a shortened version of it.

Then confirm the installed version actually ships the bundle index:

```bash
ls <pkgRoot>/dist/dts-bundle/index.json
```

**If it's missing, stop — do not look elsewhere for types or docs.** The installed `@wix/patterns` predates this feature; upgrade it and re-run the check. This is not the same failure as a name simply not being covered (see below) — a missing *file* here means the whole mechanism isn't available yet, not that one name isn't in it.

**Never inspect `node_modules` by hand** — no `ls`, no `find`, no `cat` of an arbitrary path, and this extends to the sanctioned directories themselves: never browse `dist/dts-bundle/` or `dist/docs/` looking around. Every lookup below names the exact file to `Read` — go straight to it.

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

Common types only; `dist/dts-bundle/index.json` has the authoritative set.

Create state with the hook -> pass it to the component's `state` prop -> wrap in a page component.

### Choosing the Right Provider

| Provider                        | When to Use                                                                          |
|----------------------------------|--------------------------------------------------------------------------------------|
| `WixPatternsProvider`           | **Default — start here.** Auto-detects the environment (BM, Essentials, Giza) and supplies the right context. |
| `WixPatternsBMProvider`         | Optional alternative for Yoshi BM Flow over Business Manager.                        |
| `WixPatternsGizaProvider`       | Optional alternative for Yoshi BM Flow over Giza.                                    |
| `WixPatternsEssentialsProvider` | Yoshi Fullstack.                                                                     |
| `WixPatternsBaseProvider`       | App does **not** run under a Giza/WixEssentials environment and you inject services (i18n, sentry) yourself. |

**Confirm the import path in the provider's own bundle** — these do not all come from the same subpath (`WixPatternsEssentialsProvider` and `WixPatternsBaseProvider` are under `@wix/patterns/essentials`, for instance). Check the project's `package.json` to identify the flow.

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

`Read <pkgRoot>/dist/dts-bundle/index.json` — one entry per name, grouped implicitly by its `category` field. Lookup is **exact-match only**: no fuzzy matching, no typo suggestions. If the exact key isn't there, scan the index you already have for something close before concluding the name isn't covered — it's one small file, already in hand.

Not every real `@wix/patterns` export is in this index — only the names these guides actually reference. If a name you need genuinely isn't there, **stop and say so rather than falling back to `node_modules`.**

### Reading doc files

`Read <pkgRoot>/dist/docs/index.json` to resolve a name (or a `symbols` alias, for the cases where the Storybook doc title doesn't match the export — `ExportTo.md` documents `ExportButton`, for instance) to its doc file, then `Read <pkgRoot>/dist/docs/<file>.md` directly — the whole file, not piped through `head`. It covers more names than the bundle index above, since it's produced for every documented component, not just the curated ones these guides name.

**Always check the import statement inside the doc** — not everything comes from `@wix/patterns` (some use subpaths like `@wix/patterns/provider`).

### Types the docs don't cover

The docs cover components and props, not the types those props use — `Filter<T>`, `RangeItem<T>`, `CursorQuery`, a `...Props` interface. `Read <pkgRoot>/dist/dts-bundle/index.json`, look up the type name, then `Read <pkgRoot>/dist/dts-bundle/<entry.file>` using exactly the `file` path the index gives — **never reconstruct the path from the name**; bundles are nested one directory per kind (`components/Table.d.ts`, `hooks/useForm.d.ts`, `types/RangeItem.d.ts`, …), so guessing `<Name>.d.ts` at the top level is wrong by construction.

Several of these types (`RangeItem`, `Filter`, `CursorQuery`, the filter factory functions) actually live in `@wix/bex-core` — the bundle already resolves and inlines the real declaration, so you get the full shape with no deep, undeclared `@wix/bex-core/dist/types/...` path to chase. Still always import it from `@wix/patterns`, per the index's `importPath` field, never from wherever the bundle says it's really declared.

### Subpath entry points

`@wix/patterns` is 31 entry points, not one namespace, and `/form` re-exports `@wix/bex-core/form`. To see what's importable from a specific one: `Read <pkgRoot>/dist/dts-bundle/exports/<subpath>.d.ts` directly (`.` is `exports/index.d.ts`; a nested one like `./testkit/backend` is `exports/testkit/backend.d.ts`). This only lists the curated names covered above — a file with nothing in it (a one-line comment) means no curated name lives on that subpath yet, not that the subpath doesn't exist.

### Following cross-references

Docs link to related names as Storybook URLs (`[TableState](./?path=/story/...--tablestate)`) — resolve the link text back to a filename via `dist/docs/index.json`, the same way you found the first doc, and `Read` it if you actually need it. There's no automatic multi-level expansion here; follow only the links you need.

Links to `https://www.docs.wixdesignsystem.com/` are external (Wix Design System) — not part of `@wix/patterns` docs. Likewise, a bundled `.d.ts` that references a deep `@wix/design-system/dist/...` path is pointing at that library's own internals — look the name up via the `wix-design-system` skill's own tool, not by opening the path.

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

The `useEntityPage` call has three things worth getting right the first time — both generics, what `onSave` actually receives, and which params exist: [ENTITY_PAGE_TOOLKIT.md](dashboard-page/ENTITY_PAGE_TOOLKIT.md).

Reserve dashboard modals for dialogs that neither write nor display a listed record — a delete or discard confirmation, an unsaved-changes prompt. **A create / "add new" form is not one of them**: it writes the record, so it is an `EntityPage` even though nothing is being edited yet. Dialog size and field count are not exceptions — a one-field create form is still an `EntityPage`. A page that lists no records is outside this rule entirely.

## When Patterns Has No Equivalent

A concept is only "missing" from patterns after you've checked `dist/dts-bundle/index.json` and `dist/docs/index.json` **and** searched by keyword within what you've already read. Then, and only then:

1. Look the component up in `@wix/design-system` via the `wix-design-system` skill.
2. Render it *inside* the patterns page shell / collection, not as a replacement for it.
3. If WDS lacks it too, compose from WDS primitives (`Box`, `Card`, `Text`) — never restyle patterns internals or add another UI library.

Anything page- or collection-shaped (page shell, header, table, grid, filters, sorting, paging, row actions, bulk actions) is patterns' territory. If you're about to build one of those from WDS parts, you skipped a lookup.

## Tips

- **Compound components** have separate docs per sub-part: `CollectionPage.md`, `CollectionPage.Header.md`, `CollectionPage.Content.md`.
- **Hook docs** list configuration options as props in the API table.
