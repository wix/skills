# @wix/patterns Component Documentation

## Prerequisites

Resolve the package root once per session and reuse it — a bare `require.resolve` throws under Yarn PnP:

```bash
node <this-skill-dir>/scripts/pkg-root.cjs @wix/patterns
```

Then check the install, two ways: `ls <pkgRoot>/dist/dts-bundle/index.json`, and — the one that matters — look for a **`Collection Toolkit`** key once step 1 has the docs index. The guides are *entries inside* that index rather than a directory, so no missing file reveals their absence.

**If either fails, stop and upgrade `@wix/patterns`.** "Which component serves this need" now lives in the package, so proceeding means guessing names; do not hunt elsewhere in `node_modules` for a substitute. Everything below degrades by version rather than breaking, so probe rather than version-check.

**Patterns API facts come from four published trees only:** `dist/docs/` (pages), `dist/dts-bundle/` (types), `dist/examples/` (worked calls), `dist/templates/` (whole pages). Never take a component, prop or type from `src/`, `dist/esm/` or `dist/cjs/`, or a deep path a bundle mentions — internals change without notice. `dist/types/` is one narrow exception, used only where step 5 says: `package.json` points `types` at it, so it is what `tsc` enforces.

## The Discovery Chain

### 1 — The index

**Resolve every patterns name you plan to write in one call:**

```bash
node <pkgRoot>/bin/patterns-lookup.cjs Table useTableCollection stringsArrayFilter DateRangeFilter
```

The package ships this script, so it matches the installed indices. For each name it prints the import, the examples and the **one** file for props. Its `summary` line usually answers the question, so step 4 needs no read. A name in neither index makes it exit 1, with near matches. `--templates` lists the page templates. **List the names first.** Each name you add later costs another round trip, and those round trips are this step's whole cost.

**If `<pkgRoot>/bin/patterns-lookup.cjs` is missing** (an older `@wix/patterns`), probe `<pkgRoot>/dist/docs/index.json` with one `grep`/`python3` call covering every symbol. Never `Read` it whole: at ~80 KB it truncates silently. Match keys and `symbols` aliases exactly. A name not in it may still be in `dist/dts-bundle/index.json`, which curates hooks, types and re-exports. `dist/dts-bundle/index.txt` (~9 KB) lists every curated name with `kind`, `importPath` and file, and from 1.469.0 adds `bytes`, `props` and `stubs`.

### 2 — Composition, once per session

`Read <pkgRoot>/dist/docs/Composition and Providers.md` before writing any patterns JSX: which provider, the four nesting layers, the collection triad, and why the provider must be a parent component rather than a sibling — the mistake that throws at runtime while the JSX looks right.

### 3 — Which component serves this need

| Building | Guide |
| --- | --- |
| A whole page | `dist/docs/Page Templates.md`, via [DRAFT_TEMPLATE.md](dashboard-page/DRAFT_TEMPLATE.md) |
| Anything collection-shaped — tables, filters, search, aggregates, row and bulk actions, empty states | `dist/docs/Collection Toolkit.md` |
| The path from a listed row to one record, and its form | `dist/docs/Collection to Entity Flow.md` |

Each guide's index entry carries `relatedComponents`; every name in it resolves, because `@wix/patterns` fails its own build otherwise. Prefer one of those over a name you recall.

### 4 — Read only what answers your question, then stop

| Your question | Read | Path |
| --- | --- | --- |
| What is it, and how does it wire in? | **nothing** — the entry says | `summary` |
| Where do I import it from? | **nothing** — the entry says | `importPath` |
| How do I call it? | one **example**, or a call in a guide's prose | `dist/examples/<examples[i]>` · `dist/docs/<guide>.md` |
| What props, and which are optional? | the **example** first; then the **`.d.ts`** *or* the doc — never both | `bundle` present: `dist/dts-bundle/<bundle>` · absent: `dist/docs/<file>` |
| A setup requirement or gotcha? | the **doc's** prose | `dist/docs/<file>` |

Prefix the index's bare values with their tree — `file` → `dist/docs/`, `examples` → `dist/examples/`, `bundle` → `dist/dts-bundle/`, `templateFiles` → `dist/templates/` — and never rebuild a path from a symbol name.

**Those two middle rows are one question in practice.** You ask how to call it, start writing, and the question turns prop-shaped mid-call — where the second row sends you to a `.d.ts` that may be stubbed (step 5). Take the props off the example first; go to the `.d.ts` only for what it cannot show — optionality, union members, an exact callback signature.

**A guide's prose often holds the call.** `PrimaryActions`' bundle stubs its own props type, while `usePatternsNavigate.md` carries `<PrimaryActions label="Add shift" onClick={…} />` verbatim. Check what you have already read before opening anything.

**`bundle` and a doc props table are mutually exclusive.** With `bundle`, the page's `### Props` is only a pointer; without it, that table marks what is required. Reading both is one hop too many.

**A `.d.ts` names props; it never says what they do.** Wiring and defaults live in prose: `CollectionSearch`'s bundle lists four optional props and no behaviour, while its page says the search term reaches your `fetchData` via `query.search`. When a behaviour question outlives the `summary`, open the page.

**Artifact not listed?** No `examples` — a hook's usage is usually filed under the component it pairs with (`useEntityPage` → `EntityPage/basic.tsx`). No `importPath` — a guide, or documented but not exported. Nothing at all — a state object you receive rather than construct; its doc is the only source.

### 5 — Traps that make a read wrong

**Search inside the file an index named, never across the tree.** A shared shape is re-stubbed in every bundle referencing it, so a tree-wide `grep` returns mostly pointers, and the first hit is rarely the declaration.

**Most bundles stub the parent holding the props — 70 of the 105 curated entries do** — and the index says so per entry. **`dist/dts-bundle/index.json` is the triage surface, not merely a fallback for names the docs index lacks:** a component entry carries `ownProps` / `inheritedProps` beside `bytes` and `readWith`, so "is this file the whole answer" is a lookup, not an inspection.

- `Table` → `ownProps: 5, inheritedProps: 58`, `readWith` naming 3 files. Five of sixty-three.
- `PrimaryActions` → `ownProps: 0, inheritedProps: 12`. A 470-byte file declaring none of them.
- No `ownProps` on a component entry means no split — that file *is* the whole answer.

A split is not a dead end: the parent is a real file, `readWith` names it, and from 1.469.0 so does the stub inside the file (`Full shape: types/Filter.d.ts`). **Read that one file — one hop, not N.** The rest of `readWith` is types referenced *inside* it, opened only if needed. Judge by the entry's own `bytes`, never `readWithBytes` — `Table`'s are 5,277 against 31,731 — since the combined figure talks you out of a read you should just do. A `…Params` type built from `Pick<>`/`Omit<>` is the same trap in another shape.

**When you do need several `readWith` files, read them in one call** — one `Read` per file in a single message. Reads measure ~21 ms each, so ten is a fifth of a second and one round trip. Deciding is what costs: decide once, then batch, and never hop one file per turn. Batching is not a licence to skip the filter, though — a few deliberate reads beat dozens of just-in-case ones.

**If the parent is large, take the declaration `tsc` uses.** `dist/types/components/CollectionTable/CollectionTable.d.ts` is 5,919 B against the bundle's 20,802 B, carries JSDoc, and states `columns: TableColumn<T>[]` (required) outright. Nothing there is stubbed, so a `grep` for a prop name is reliable. This case only.

The generated files' conventions — which one-line stubs are answers rather than truncation, how entry-point files are scoped — are in `dist/docs/Reading the Doc Indices.md`, worth reading before your first `dist/dts-bundle/*.d.ts` of the session.

### Rules for the reads themselves

- **Use the exact `file`, `bundle` and `examples` values, prefixed per step 4.** Bundles nest one directory per kind, so `<Name>.d.ts` at the top level is wrong by construction, and an example slug is not derivable from a title.
- **Extract from the file the index named.** A whole-file `Read` is safe (`bytes` gives the size first); a scoped `grep`/`sed` is cheaper. If an extraction is empty or ambiguous, read the whole file rather than guess.
- **A `@wix/design-system` name is not yours to look up here.** Use the `wix-design-system` skill; never follow a deep `@wix/design-system/dist/...` path a bundle mentions.
- **If a name is in neither index, stop and say so**, naming the path that dead-ended. A wrong guess compiles and breaks at runtime.

## When Patterns Has No Equivalent

A concept is only "missing" after you have checked both indices **and** searched by keyword in what you have read. Then look it up via the `wix-design-system` skill and render it *inside* the patterns page shell rather than in place of it; if WDS lacks it too, compose from `Box`, `Card` and `Text`. Never restyle patterns internals, and never add another UI library.

Anything page- or collection-shaped is patterns' territory; building one from WDS parts means a skipped lookup.
