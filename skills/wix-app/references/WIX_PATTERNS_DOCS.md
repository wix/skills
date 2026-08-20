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

A bare `require.resolve` without the PnP-activation step throws in a Yarn Berry project even when the package is installed — run the whole snippet, not a shortened version.

Then confirm the installed version actually ships the bundle index:

```bash
ls <pkgRoot>/dist/dts-bundle/index.json
```

**If it's missing, stop — do not look elsewhere for types or docs.** The installed `@wix/patterns` predates the index; it ships from **1.458.0** onward, so upgrade to at least that and re-run the check. A missing *file* is not the same as a name not being covered (see below): the mechanism itself isn't available yet.

**Never inspect `node_modules` by hand** — no `ls`, no `find`, no `cat` of an arbitrary path, and that includes the sanctioned directories: never browse `dist/dts-bundle/` or `dist/docs/` looking around. Every lookup below names the exact file to `Read` — go straight to it.

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

Common types only; `dist/dts-bundle/index.json` has the authoritative set. Create state with the hook -> pass it to the component's `state` prop -> wrap in a page component.

### Choosing the Right Provider

| Provider | When to Use |
| --- | --- |
| `WixPatternsProvider` | **Default — start here.** Auto-detects the environment (BM, Essentials, Giza). |
| `WixPatternsBMProvider` | Optional alternative for Yoshi BM Flow over Business Manager. |
| `WixPatternsGizaProvider` | Optional alternative for Yoshi BM Flow over Giza. |
| `WixPatternsEssentialsProvider` | Yoshi Fullstack. |
| `WixPatternsBaseProvider` | App does **not** run under Giza/WixEssentials and you inject services (i18n, sentry) yourself. |

**Confirm the import path in the provider's own bundle** — they don't all share a subpath (`WixPatternsEssentialsProvider` and `WixPatternsBaseProvider` are under `@wix/patterns/essentials`). The project's `package.json` identifies the flow.

### Page Wiring — Two Providers and `withDashboard`

The provider **must** live in a parent component of the page content: hooks like `useTableCollection` need its context to already exist above them in the React tree.

**Wrong:** calling `useTableCollection` in the same component that renders `WixPatternsProvider`. The hook runs before the provider exists above it, so it throws at runtime — and the JSX nesting looks right, which is what makes this hard to spot.

Both providers are required — `WixDesignSystemProvider` outside, `WixPatternsProvider` inside. Export via `withDashboard(...)` from `@wix/patterns`. `WixPatternsProvider` also needs `@wix/dashboard`.

When the page needs **multiple routes**, use the `@wix/patterns` routing solution (`PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate`) rather than a separate router, and keep the router alongside the providers. Look up those doc files for setup details.

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

Keep the provider (and router, if any) in the app's root component and each page in its own file.

For **multiple pages**, use the `@wix/patterns` routing solution (`PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate`) rather than a separate router; look the doc files up for setup.

## How to Look Things Up

**Don't guess which components or props exist — read the doc files first.**

### Finding the right name

`Read <pkgRoot>/dist/dts-bundle/index.json` — one entry per name, grouped implicitly by its `category` field. Lookup is **exact-match only**: no fuzzy matching, no typo suggestions. If the exact key isn't there, scan the index you already hold for something close before concluding the name isn't covered.

Not every real `@wix/patterns` export is in this index — only the names these guides actually reference. If a name you need genuinely isn't there, **stop and say so rather than falling back to `node_modules`.**

### Reading doc files

`Read <pkgRoot>/dist/docs/index.json` to resolve a name to its doc file — or a `symbols` alias, for the cases where the Storybook title doesn't match the export (`ExportTo.md` documents `ExportButton`) — then `Read <pkgRoot>/dist/docs/<file>.md` directly, the whole file, not piped through `head`. It covers more names than the bundle index above: it's produced for every documented component, not just the curated ones.

**Always check the import statement inside the doc** — not everything comes from `@wix/patterns` (some use subpaths like `@wix/patterns/provider`).

### Reading the file the index names

The mechanics of the file an index names — types the docs don't cover, which one-line stubs are answers rather than truncation, subpath entry points, cross-references, split compound-component docs — are in [Reading bundles and docs](dashboard-page/PATTERNS_BUNDLE_READING.md). Read it before your first `dist/dts-bundle/*.d.ts` of the session.

## The Collection → Entity Flow

A collection page and its item form are **two patterns pages**, not a page plus a modal. Getting the table right and then hand-building the "add item" form as a dashboard modal is the most common way this goes wrong.

| Step | What owns it |
| --- | --- |
| Navigate from a row / primary action to the item | `usePatternsNavigate()` → `navigateToEntityPage({ path, entity })` |
| Register the route | `PatternsReactRoute` inside `PatternsReactRouter` |
| Fetch, save, validation, dirty state, skeletons, errors | `useEntityPage({ fetch, onSave })` |
| Form state and field binding | `useForm` / `useController` from `@wix/patterns/form` |
| Body layout | `EntityPage.Header`, `.MainContent`, `.AdditionalContent`, `.Card` |
| Reaching page state from a child component | `useEntityPageContext()` — no prop-drilling |
| The individual fields inside those cards | `@wix/design-system` (`FormField`, `Input`, `Text`) |

Prefer `navigateToEntityPage` over a plain route change: the entity header (title, subtitle, breadcrumbs) renders immediately, without waiting for the fetch.

Read `EntityPage.md`, `useEntityPage.md`, and `usePatternsNavigate.md` before implementing — and note `useCreateCollection` is **not** about creating items; it returns a function that initializes collection state.

Three things about the `useEntityPage` call are worth getting right first time — both generics, what `onSave` receives, which params exist: [ENTITY_PAGE_TOOLKIT.md](dashboard-page/ENTITY_PAGE_TOOLKIT.md).

Reserve dashboard modals for dialogs that neither write nor display a listed record — a delete or discard confirmation, an unsaved-changes prompt. **A create / "add new" form is not one of them**: it writes the record, so it is an `EntityPage` even though nothing is being edited yet. Size and field count are not exceptions — a one-field create form is still an `EntityPage`. A page that lists no records is outside this rule.

## When Patterns Has No Equivalent

A concept is only "missing" from patterns after you've checked `dist/dts-bundle/index.json` and `dist/docs/index.json` **and** searched by keyword within what you've read. Then, and only then:

1. Look the component up in `@wix/design-system` via the `wix-design-system` skill.
2. Render it *inside* the patterns page shell / collection, not as a replacement for it.
3. If WDS lacks it too, compose from WDS primitives (`Box`, `Card`, `Text`) — never restyle patterns internals, never add another UI library.

Anything page- or collection-shaped (page shell, header, table, grid, filters, sorting, paging, row and bulk actions) is patterns' territory. If you're about to build one from WDS parts, you skipped a lookup.
