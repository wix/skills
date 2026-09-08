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

Run the whole snippet — a bare `require.resolve` throws in Yarn Berry without the PnP step.

Then confirm the installed version actually ships the bundle index:

```bash
ls <pkgRoot>/dist/dts-bundle/index.json
```

**If the file is missing, stop and upgrade** — the index ships from **1.458.0** on (prefer **1.465.0**+). That is different from a *name* missing from an index that exists (below).

**Never browse `node_modules`** — no `ls`/`find`/`cat` of arbitrary paths, `dist/dts-bundle/` and `dist/docs/` included. Every lookup below names an exact file to `Read`.

### The index is not the list of what exists

`dist/dts-bundle/` is docs; `tsc` resolves `dist/types/index.d.ts`. The index is a curated subset, so a name absent from it may still be exported and usable (`CollectionErrorState` is), and a stub type is abridged, not what you compile against. Check `dist/types/index.d.ts` before deciding a component this skill names is unavailable: [why](dashboard-page/PATTERNS_BUNDLE_READING.md#what-the-bundle-leaves-out).

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

Common types only; `dist/dts-bundle/index.json` lists the rest. Create state with the hook -> pass it to the component's `state` prop -> wrap in a page component.

### Choosing the Right Provider

| Provider | When to Use |
| --- | --- |
| `WixPatternsProvider` | **Default — start here.** Auto-detects the environment (BM, Essentials, Giza). |
| `WixPatternsBMProvider` / `WixPatternsGizaProvider` | Optional alternatives for Yoshi BM Flow (Business Manager / Giza). |
| `WixPatternsEssentialsProvider` | Yoshi Fullstack. |
| `WixPatternsBaseProvider` | App does **not** run under Giza/WixEssentials and you inject services (i18n, sentry) yourself. |

**Confirm the import path in the provider's own bundle** — not all share a subpath (`WixPatternsEssentialsProvider`, `WixPatternsBaseProvider` live under `@wix/patterns/essentials`).

### Keep Provider and Page Separate

The provider **must** be a parent of the page content: hooks like `useTableCollection` need its context above them in the tree.

**Wrong:** calling `useTableCollection` in the component that renders `WixPatternsProvider` — the hook runs before the provider exists, so it throws at runtime even though the JSX looks right.

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
import { Table, useTableCollection, OffsetQuery } from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';

function MyCollectionPage() {
  // works — the provider context exists above this component
  const state = useTableCollection({
    queryName: 'my-items',
    itemKey: (item) => item.id,
    itemName: (item) => item.name,
    fetchData: async (query: OffsetQuery) => ({ items: [], total: 0 }),
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

For **multiple pages**, use the `@wix/patterns` routing solution (`PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate`) rather than a separate router. Read `PatternsReactRouter.md` and `withDashboard.md` for setup — the router reads page location from the dashboard context `withDashboard` renders, so it needs that wrapper above it with a `location` prop, and throws at render time without them. (it ships from **1.465.0**; no entry in `dist/docs/index.json` means an older install — use `PatternsReactRouter.md`'s **Requirements**.)

## How to Look Things Up

**Don't guess which components or props exist — read the doc files first.**

### Finding the right name

`Read <pkgRoot>/dist/dts-bundle/index.json` — one entry per name, grouped implicitly by its `category` field. Lookup is **exact-match only** — no fuzzy matching. If the exact key isn't there, scan the index you already hold for something close before concluding the name isn't covered.

Not every real export is in this index — only names these guides reference. If a needed name genuinely isn't there, **stop and say so rather than falling back to `node_modules`.**

### Reading doc files

`Read <pkgRoot>/dist/docs/index.json` to resolve a name to its doc file — or a `symbols` alias, for cases where the Storybook title doesn't match the export (`ExportTo.md` documents `ExportButton`) — then `Read <pkgRoot>/dist/docs/<file>.md` directly, the whole file, not piped through `head`. It covers more names than the bundle index above — every documented component, not just the curated ones.

**Always check the import statement inside the doc** — not everything comes from `@wix/patterns` (some use subpaths, e.g. `@wix/patterns/provider`).

A doc whose index entry has a `bundle` field does **not** list its props — its `### Props` points at that bundle. One without it carries its own table. Either way the doc owns prose, variations, BI events, and the import line.

### Reading the file the index names

The mechanics of the file an index names — batching the reads, types docs don't cover, one-line stubs that are answers rather than truncation, subpath entry points, cross-references, split compound docs — are in [Reading bundles and docs](dashboard-page/PATTERNS_BUNDLE_READING.md). Read it before your first `dist/dts-bundle/*.d.ts` of the session.

## The Collection → Entity Flow

A collection page and its item form are **two patterns pages**, not a page plus a modal. Reserve modals for dialogs that neither write nor display a listed record (a delete or discard confirmation, an unsaved-changes prompt); **a create / "add new" form is not one of them** — it writes the record, so it's an `EntityPage` regardless of size. A page that lists nothing is outside this rule — full test in [SKILL.md](../SKILL.md#entity-create-and-edit).

| Step | What owns it |
| --- | --- |
| Navigate from a row / primary action to the item | `usePatternsNavigate()` → `navigateToEntityPage({ path, entity })` |
| Register the route | `PatternsReactRoute` inside `PatternsReactRouter` |
| Fetch, save, validation, dirty state, skeletons, errors | `useEntityPage({ fetch, onSave })` |
| Form state and field binding | `useForm` / `useController` from `@wix/patterns/form` — `useController`, never `register` |
| Body layout | `EntityPage.Header`, `.MainContent`, `.AdditionalContent`, `.Card` |
| The individual fields inside those cards | `@wix/design-system` (`FormField`, `Input`, `Text`) |

Prefer `navigateToEntityPage` over a plain route change — the entity header renders before the fetch resolves. **Every `path` above is page-relative**: the router roots at `path="/"` even on a page scaffolded `route: "shifts"`, so never repeat that name in a `path`, `parentPath`, or `navigateToEntityPage` call — it fails silently. See [ENTITY_PAGE_TOOLKIT.md](dashboard-page/ENTITY_PAGE_TOOLKIT.md).

Read `EntityPage.md`, `useEntityPage.md` and `usePatternsNavigate.md` first, plus [ENTITY_PAGE_TOOLKIT.md](dashboard-page/ENTITY_PAGE_TOOLKIT.md) for the call itself. `useCreateCollection` is **not** about creating items — it initializes collection state.

## When Patterns Has No Equivalent

A concept is only "missing" from patterns after you've checked `dist/dts-bundle/index.json` and `dist/docs/index.json`, **searched by keyword within what you've read**, and confirmed it is absent from `dist/types/index.d.ts` too. Then, and only then:

1. Look the component up in `@wix/design-system` via the `wix-design-system` skill.
2. Render it *inside* the patterns page shell / collection, not as a replacement for it.
3. If WDS lacks it too, compose from WDS primitives (`Box`, `Card`, `Text`) — never restyle patterns internals, never add another UI library.

Anything page- or collection-shaped (shell, header, table, grid, filters, sorting, paging, row/bulk actions) is patterns' territory. Building one from WDS parts means a skipped lookup.
