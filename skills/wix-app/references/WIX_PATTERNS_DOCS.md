# @wix/patterns Component Documentation

## Prerequisites

Resolve the package root once per session and reuse it — a bare `require.resolve` throws under Yarn PnP:

```bash
node <this-skill-dir>/scripts/pkg-root.cjs @wix/patterns
```

Then check the install, two ways: `ls <pkgRoot>/dist/dts-bundle/index.json`, and — the one that matters — look for a **`Collection Toolkit`** key once step 1 has the docs index. The guides are *entries inside* that index rather than a directory, so no missing file reveals their absence.

**If either fails, stop and upgrade `@wix/patterns` to 1.486.0 or later**, the first release that ships the lookup script below. "Which component serves this need" now lives in the package, so proceeding means guessing names; do not hunt elsewhere in `node_modules` for a substitute. Everything below degrades by version rather than breaking, so probe rather than version-check.

**Patterns API facts come from four published trees only:** `dist/docs/` (pages), `dist/dts-bundle/` (types), `dist/examples/` (worked calls), `dist/templates/` (whole pages). Never take a component, prop or type from `src/`, `dist/esm/` or `dist/cjs/`, or a deep path a bundle mentions — internals change without notice. That includes `dist/types/`: `tsc` reads it, but its files import their props from sibling files, so it answers no props question in one read.

## The Discovery Chain

### 1 — The index

**Resolve every patterns name you plan to write in one call:**

```bash
node <pkgRoot>/bin/patterns-lookup.cjs Table useTableCollection stringsArrayFilter DateRangeFilter
```

The package ships this script, so it matches the installed indices. For each name it prints the import, the examples and the **one** file for props. Its `summary` line usually answers the question, so step 4 needs no read. A name in neither index makes it exit 1, with near matches. `--templates` lists the page templates. **List the names first.** Each name you add later costs another round trip, and those round trips are this step's whole cost.

**If `<pkgRoot>/bin/patterns-lookup.cjs` is missing** (a `@wix/patterns` before 1.486.0), probe `<pkgRoot>/dist/docs/index.json` with one `grep`/`python3` call covering every symbol, and match keys and `symbols` aliases exactly. Never `Read` it whole: it truncates silently. A name not in it may still be in `dist/dts-bundle/index.json`.

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

**`Read <pkgRoot>/dist/docs/Reading the Doc Indices.md` once per session**, before your first read past the lookup output. The package keeps it in step with its own indices. It says which file answers which question, what a one-line stub in a `.d.ts` means, and how to follow a stubbed prop to the file that declares it. The rules below are about how many reads you make:

- **Read the one artifact your open question needs.** Check what you have already read first: a guide's prose often holds the call.
- **Decide once, then batch.** When you need several files, read them in one message, one `Read` per file. Never hop one file per turn. Deciding is what costs, so a few deliberate reads beat dozens of just-in-case ones.
- **Extract from the file the lookup named.** If an extraction is empty or ambiguous, read the whole file rather than guess.
- **A `@wix/design-system` name is not yours to look up here.** Use the `wix-design-system` skill; never follow a deep `@wix/design-system/dist/...` path a bundle mentions.
- **If a name is in neither index, stop and say so**, naming the path that dead-ended. A wrong guess compiles and breaks at runtime.

## When Patterns Has No Equivalent

A concept is only "missing" after you have checked both indices **and** searched by keyword in what you have read. Then look it up via the `wix-design-system` skill and render it *inside* the patterns page shell rather than in place of it; if WDS lacks it too, compose from `Box`, `Card` and `Text`. Never restyle patterns internals, and never add another UI library.

Anything page- or collection-shaped is patterns' territory; building one from WDS parts means a skipped lookup.
