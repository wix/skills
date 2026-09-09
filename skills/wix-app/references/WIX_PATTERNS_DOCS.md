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

Then confirm the install is new enough, in two checks.

**The file check.** The type bundles ship from **1.458.0**:

```bash
ls <pkgRoot>/dist/dts-bundle/index.json
```

**The guide check — this is the one that matters.** The chain below reads the library's own
guides, and they arrive as *entries inside* `dist/docs/index.json`, not as a new directory, so
their absence cannot be seen by looking for a file. After step 1 reads that index, look for a
**`Collection Toolkit`** key in what you already hold.

**If either check fails, stop and upgrade `@wix/patterns` — do not work around it.** On an
install without the guides, the answer to "which component serves this need" is in neither
place: it used to live in this skill and now lives in the package, so proceeding means
guessing component names, which is exactly the failure this chain exists to prevent. Do not
look elsewhere in `node_modules` for a substitute.

The guides ship from **1.468.0** at the earliest; the key probe, not that number, is what
decides — and it has already earned that framing, since 1.466.0 and 1.467.0 were both cut
before the guides landed. A later first release only moves the number; the probe stays
correct. The rest of the chain also
assumes **1.465.0**+ (`OffsetQuery`, `useEntityPage`'s create route and typing rule,
`withDashboard.md`, a deprecation `status` in `dist/docs/index.json`, page-relative router
paths).

A missing *file* is not the same as a name not being covered — see below.

**Patterns API facts come only from the two published trees — `dist/docs/` and `dist/dts-bundle/`.** Never source a component, prop or type from `src/`, `dist/types/`, `dist/esm/`, or any other path inside the package, and never from a deep path a bundle happens to mention. Those are internals: they change without notice, they carry unresolved generics the bundles have already resolved, and a shape read from them compiles and then breaks at runtime.

Inside those two trees, read however is cheapest. `grep`/`sed` to pull one declaration out of a bundle is fine and usually better than a whole-file read — the ban is on *crawling elsewhere* for an answer these two trees already hold, not on being economical within them.

## The Discovery Chain

Five steps, in order. Every one is a file read; none of them is a guess.

### 1 — The index

`Read <pkgRoot>/dist/docs/index.json`. **Start here, not with the bundle index.** It carries an
entry for every documented name *and* the library's own guides, and it is the larger of the
two — 172 entries against the bundle index's 103.

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

### 4 — Pick the artifact that answers the question you actually have

Each symbol ships up to three artifacts, and they answer **different** questions. The index
entry from step 1 tells you which exist before you open anything, so decide first and read one:

| Your question | What to read | The index field that tells you |
| --- | --- | --- |
| Where do I import it from? | **nothing** — the index already says | `importPath` |
| How do I call it? Generics, what a callback receives and returns, how the pieces nest | the **example** | `examples` |
| What props does it take, and which are optional? | the **`.d.ts`**, *or* the doc — never both | `bundle` present ⇒ read that `.d.ts`; absent ⇒ the doc's own table is the answer |
| Is there a setup requirement or a gotcha? | the **doc's** prose | — |

**Where each one lives.** The index hands you a value; the tree it belongs to is fixed. Prefix
it, and never reconstruct a path from the symbol name:

| Artifact | Read this path | Built from |
| --- | --- | --- |
| the doc | `<pkgRoot>/dist/docs/<file>` | the entry's `file` — e.g. `useEntityPage.md` |
| an example | `<pkgRoot>/dist/docs/<examples[i]>` | each value in `examples` — e.g. `EntityPage/basic.tsx` |
| the props `.d.ts` | `<pkgRoot>/dist/dts-bundle/<bundle>` | the entry's `bundle` — e.g. `hooks/useEntityPage.d.ts` |

Worked through on one entry, exactly as step 1 hands it to you:

```json
"useEntityPage": {
  "file": "useEntityPage.md",
  "importPath": "@wix/patterns",
  "bundle": "hooks/useEntityPage.d.ts",
  "propsTypeName": "UseEntityPageParams"
}
```

- **Where do I import it from?** `@wix/patterns`, straight off `importPath`. No read.
- **How do I call it?** This entry has no `examples`, so check the component it pairs with —
  `EntityPage`'s entry lists `EntityPage/basic.tsx`, so
  `Read <pkgRoot>/dist/docs/EntityPage/basic.tsx`.
- **What are its props?** `bundle` is present, so
  `Read <pkgRoot>/dist/dts-bundle/hooks/useEntityPage.d.ts` — and not the page.
- **Any setup requirement?** `Read <pkgRoot>/dist/docs/useEntityPage.md`.

**`bundle` and an own props table are mutually exclusive.** 80 entries point at a bundle; 58
carry their own table, and every one of those 58 marks a `Required` column. None do both. So if
the entry has no `bundle`, the doc is complete on props and the types add nothing; if it has
one, the doc's `### Props` is only a pointer and reading the page for props is a wasted hop.

**Import paths are data, not prose.** Patterns is 31 entry points — `@wix/patterns`, `/page`,
`/provider`, `/router`, `/form`, `/essentials` — so an import from memory is a guess, and the
two page components do not live together. Take `importPath` from the index; open the doc only
if the entry has none.

### 5 — The example is usually the cheapest answer

**When the question is "how do I call this", read the example before the types.** A worked
example states the whole call — both generics, the params object, what `onSave` returns — in one
file. The same answer assembled from a type chain can cost five files and a reconstruction,
because `…Params` types are often a `Pick<>` of a type declared elsewhere and no file states the
resolved shape.

Two things to know about finding them: coverage is partial (39 of 172 entries have `examples`),
and a hook's usage is often filed under the **component** it belongs to — `useEntityPage`'s call
appears in `EntityPage`'s examples, not its own. If a hook's entry has no `examples`, check the
component it pairs with before falling back to the type chain.

For a type rather than a component — `Filter<T>`, `RangeItem<T>`, `OffsetQuery`, a `…Props`
interface — `Read <pkgRoot>/dist/dts-bundle/index.json` and then the `.d.ts` at exactly the
`file` path it gives. Check that entry's `readWith` first: it names the bundles this one stubs,
so you learn whether the answer is one file or five *before* committing to the chase.

What the generated files' conventions mean — which one-line stubs are answers rather than
truncation, what a bare `import` implies, how entry-point files are scoped — is the library's
own `Read <pkgRoot>/dist/docs/Reading the Doc Indices.md`. Read it before your first
`dist/dts-bundle/*.d.ts` of the session.

### Decide first, then batch what survives

One index read covers the whole page, so list every symbol you plan to write — components,
hooks, state types, prop types — and resolve each one against the index. Then, **per symbol**,
apply step 4: take `importPath` as data, and pick the *one* artifact that answers your open
question. Only what survives that filter gets read.

Batch whatever does survive into a single call — files opened one per call re-send the whole
conversation each time, which is where a lookup session's token cost goes. But batching is not
a licence to skip the filter: **every file in a batch costs about half a second of dispatch
regardless of its size**, so a 38-file batch spends ~20s before a single byte is understood.
Twelve deliberate reads beat forty defensive ones.

```
call 1   Read <pkgRoot>/dist/docs/index.json          <- names, importPath, bundle, examples
         Read <pkgRoot>/dist/docs/Collection Toolkit.md   <- a guide, from step 3

         then, per symbol, from the entry you now hold:
           importPath present            -> read nothing
           need the call shape           -> read the one example
           need props, `bundle` present  -> read that one .d.ts
           need props, no `bundle`       -> read the doc
           need a setup requirement      -> read the doc

call 2   Read <the files that survived>
```

Batch the follow-ups the same way: when a stub names another bundle, or a `readWith` names a
set, collect them and read them together — after checking you still need them.

### Rules for the reads themselves

- **Use the exact `file`, `bundle` and `examples` values, prefixed per the paths in step 4;
  never reconstruct a path from a name.** Bundles nest one directory per kind
  (`components/Table.d.ts`, `hooks/useForm.d.ts`), so `<Name>.d.ts` at the top level is wrong by
  construction — and an example is a slug from a variation title, so it is not derivable either.
- **Extract what you need.** Every bundle fits in one read and the index's `bytes` field says
  how large beforehand, so a whole-file `Read` is always safe — but inside `dist/docs/` and
  `dist/dts-bundle/` a targeted `grep`/`sed` for the one declaration you are after is fine, and
  cheaper. What you must not do is go looking for that declaration anywhere else in the package.
  If a targeted extraction comes back empty or ambiguous, read the whole file rather than
  guessing from a partial match.
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
