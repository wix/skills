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

A bare `require.resolve` without the PnP-activation step throws in a Yarn Berry project even when installed — run the whole snippet, not a shortened version.

Then confirm the installed version actually ships the bundle index:

```bash
ls <pkgRoot>/dist/dts-bundle/index.json
```

**If it's missing, stop — do not look elsewhere for types or docs.** The installed `@wix/patterns` predates the index (ships from **1.458.0**); upgrade and re-run the check. Prefer **1.465.0**+ — the lookups below assume it (`OffsetQuery`, `useEntityPage`'s create route, `withDashboard.md`, a deprecation `status` in `dist/docs/index.json`, page-relative router paths). A missing *file* isn't the same as a name not being covered (see below).

**Never inspect `node_modules` by hand** — no `ls`, `find`, or `cat` of an arbitrary path, not even `dist/dts-bundle/` or `dist/docs/`. Every lookup below names the exact file to `Read` — go straight to it.

## The Discovery Chain

Five steps, in order. Every one is a file read; none of them is a guess.

### 1 — The index

`Read <pkgRoot>/dist/docs/index.json`. **Start here, not with the bundle index.** It carries an
entry for every documented name *and* the library's own guides, and it is the larger of the
two — 172 entries against the bundle index's 101.

Resolve a name against the keys **and** each entry's `symbols` aliases: the index is keyed by
Storybook title, so `ExportButton` lives under `ExportTo` and `CollectionToolbarFilters` under
`ToolbarFilters`. Lookup is exact-match — no fuzzy matching — so if a key isn't there, scan the
index you already hold for something close before concluding the name isn't covered.

An entry's `status: "deprecated"` means use what its `statusMessage` names instead. Nothing
else in this chain will stop you: a deprecated component still compiles and still renders.

### 2 — Composition, once per session

`Read <pkgRoot>/dist/docs/Composition and Providers.md` before writing any patterns JSX.
Which provider, the four nesting layers, the collection triad, and why the provider has to be
a parent component rather than a sibling — the one that throws at runtime while the JSX looks
right.

Structural, so it is one read per session rather than one per component.

### 3 — Which component serves this need

| Building | Guide |
| --- | --- |
| Anything collection-shaped — tables, filters, search, aggregates, row and bulk actions, empty states | `Read <pkgRoot>/dist/docs/Collection Toolkit.md` |
| The path from a listed row to one record, and its form | `Read <pkgRoot>/dist/docs/Collection to Entity Flow.md` |

Each guide's index entry carries `relatedComponents` — the list of names it recommends. Every
name in it resolves, because `@wix/patterns` fails its own build otherwise. That list is the
closest thing to a guarantee in this chain; prefer a name from it over one you recall.

### 4 — The component's doc

Resolve the name through step 1 to its `file`, then `Read <pkgRoot>/dist/docs/<file>`.

**Always take the import line from the doc.** Patterns is 31 entry points, not one namespace —
`@wix/patterns`, `/page`, `/provider`, `/form`, `/essentials` — so an import from memory is a
guess, and the two page components do not live together.

An entry with a `bundle` field has no props table: its `### Props` points at that bundle on
purpose. One without the field carries its own table.

### 5 — The example, then the types

The doc lists its variations by name; pick the one closest to the case at hand and read the
file it points at. Heavy examples live beside the doc and the entry's `examples` field lists
them.

For a type rather than a component — `Filter<T>`, `RangeItem<T>`, `OffsetQuery`, a `…Props`
interface — `Read <pkgRoot>/dist/dts-bundle/index.json` and then the `.d.ts` at exactly the
`file` path it gives.

What the generated files' conventions mean — which one-line stubs are answers rather than
truncation, what a bare `import` implies, how entry-point files are scoped — is the library's
own `Read <pkgRoot>/dist/docs/Reading the Doc Indices.md`. Read it before your first
`dist/dts-bundle/*.d.ts` of the session.

### Batch the reads

One index read covers the whole page. So name every symbol you plan to write — components,
hooks, state types, prop types — look them all up in the index you now hold, and open what it
named in a single call with one `Read` per file:

```
call 1   Read <pkgRoot>/dist/docs/index.json
         Read <pkgRoot>/dist/dts-bundle/index.json

call 2   Read <pkgRoot>/dist/docs/Collection Toolkit.md            <- a guide, from step 3
         Read <pkgRoot>/dist/docs/Table.md                         <- docs entry's `file`
         Read <pkgRoot>/dist/docs/useTableCollection.md
         Read <pkgRoot>/dist/dts-bundle/components/Table.d.ts      <- its `bundle`
         Read <pkgRoot>/dist/dts-bundle/types/TableState.d.ts      <- bundle entry's `file`
```

Two calls, not twenty-two — and nothing is lost by batching, because there is nothing to learn
between the files: every path came out of the same index, and `bytes` already told you each
size. The same files opened one per call re-send the whole conversation once per file, which is
where a lookup session's token cost actually goes. Batch the follow-ups the same way: when a
doc names an example file, or a stub names another bundle, collect them and read them together.

### Rules for the reads themselves

- **Use the exact `file` value; never reconstruct a path from a name.** Bundles nest one
  directory per kind (`components/Table.d.ts`, `hooks/useForm.d.ts`), so `<Name>.d.ts` at the
  top level is wrong by construction.
- **Read the whole file**, not piped through `head`. Every bundle fits in one read, and the
  index's `bytes` field says how large beforehand — so nothing here is ever truncated on you.
- **A `@wix/design-system` name is not yours to look up here.** Use the `wix-design-system`
  skill; do not open WDS files, and do not follow a deep `@wix/design-system/dist/...` path a
  bundle mentions.
- **If a name you genuinely need isn't in either index, stop and say so** — name the file and
  the exact path that dead-ended. Do not guess a shape, and do not fall back to `node_modules`:
  a wrong guess compiles and breaks at runtime, which is worse than a missing type.

## When Patterns Has No Equivalent

A concept is only "missing" from patterns after you've checked `dist/dts-bundle/index.json` and `dist/docs/index.json` **and** searched by keyword within what you've read. Then:

1. Look the component up in `@wix/design-system` via the `wix-design-system` skill.
2. Render it *inside* the patterns page shell / collection, not as a replacement for it.
3. If WDS lacks it too, compose from WDS primitives (`Box`, `Card`, `Text`) — never restyle patterns internals, never add another UI library.

Anything page- or collection-shaped (shell, header, table, grid, filters, sorting, paging, row/bulk actions) is patterns' territory. Building one from WDS parts means a skipped lookup.
