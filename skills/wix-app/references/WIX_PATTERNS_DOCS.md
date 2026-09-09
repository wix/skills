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

**Patterns API facts come only from the three published trees — `dist/docs/` (the pages), `dist/dts-bundle/` (the types) and `dist/examples/` (the worked calls).** Never source a component, prop or type from `src/`, `dist/types/`, `dist/esm/`, or any other path inside the package, and never from a deep path a bundle happens to mention. Those are internals: they change without notice, they carry unresolved generics the bundles have already resolved, and a shape read from them compiles and then breaks at runtime.

Inside those three trees, read however is cheapest. `grep`/`sed` to pull one declaration out of a bundle is fine and usually better than a whole-file read — the ban is on *crawling elsewhere* for an answer these three trees already hold, not on being economical within them.

## The Discovery Chain

Five steps, in order. Each one either answers from the index or names the exact file to
open — none of them is a guess.

### 1 — The index

`Read <pkgRoot>/dist/docs/index.json`. **Start here, not with the bundle index.** It carries an
entry for every documented name *and* the library's own guides, and it is the larger of the
two.

**Read each entry's `summary` before deciding to open anything.** It is the opening paragraph
of that page's description — what the symbol is and how it wires into your code — so for most
questions the index *is* the answer, and step 4 resolves to no read at all. 169 of the 172
entries carry one.

Resolve a name against the keys **and** each entry's `symbols` aliases: the index is keyed by
Storybook title, so `ExportButton` lives under `ExportTo` and `CollectionToolbarFilters` under
`ToolbarFilters`. Lookup is exact-match — no fuzzy matching — so if a key isn't there, scan the
index you already hold for something close before concluding the name isn't covered.

**Not in the docs index? Check `dist/dts-bundle/index.json` before concluding it does not
exist.** Some names you will write are curated there and documented nowhere else — `useForm`
and `useController` (from `@wix/patterns/form`), `OffsetQuery`, `Filter`, `Column`,
`UseEntityPageParams`. That index carries `importPath` and `file` too, so step 4 still applies;
there is simply no page to read.

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

### 4 — Read only what answers your question, then stop

Each symbol ships up to three artifacts, and they answer **different** questions. The entry
from step 1 says which of them exist, so decide before you open anything:

| Your question | Read | Path |
| --- | --- | --- |
| What is it, and how does it wire into my code? | **nothing** — the entry says | `summary` |
| Where do I import it from? | **nothing** — the entry says | `importPath` |
| How do I call it? Generics, what a callback receives and returns, how the pieces nest | one **example** | `<pkgRoot>/dist/examples/<examples[i]>` |
| What props does it take, and which are optional? | the **`.d.ts`** *or* the doc — never both | `bundle` present: `<pkgRoot>/dist/dts-bundle/<bundle>` · absent: `<pkgRoot>/dist/docs/<file>` |
| Is there a setup requirement or a gotcha? | the **doc's** prose | `<pkgRoot>/dist/docs/<file>` |

The index hands you a bare value and the tree it belongs to is fixed — one tree per kind of
answer: `file` is relative to `dist/docs/`, `examples` to `dist/examples/`, `bundle` to
`dist/dts-bundle/`. Prefix them, and never reconstruct a path from the symbol name. (Examples
moved out of `dist/docs/` into their own tree; on an install predating that, the same relative
path resolves under `dist/docs/`, and the page's own "Example code: read" line says which.)

**`bundle` and a doc props table are mutually exclusive.** An entry with `bundle` has no table
on its page — its `### Props` is only a pointer, so reading the page for props is a wasted hop.
An entry without `bundle` carries its own table, and that table marks which props are required,
so the types add nothing.

**A `.d.ts` names props; it never says what they do.** The rule above is about *props*, and it
is easy to over-read as "this symbol is now answered" — it is not. Wiring, defaults and the
contract between a prop and your own callbacks live in prose, and a `bundle` entry's page is
where that prose is. `CollectionSearch` is the case that earned this paragraph: its bundle
lists four optional props and no behaviour, while its page opens with "the search term is
passed to your `fetchData` function via `query.search`" — the entire answer to *how do I wire
a search box to my query*. Reading the bundle and stopping cost 54 seconds of reconstructing
that from `ComputedQuery.d.ts`. That opening line is now the entry's `summary`, so the index
settles it; when a behaviour question outlives the summary, open the page.

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
- **How do I call it?** No `examples` on this entry, so check the component it pairs with —
  `EntityPage`'s entry lists `EntityPage/basic.tsx`, so
  `Read <pkgRoot>/dist/examples/EntityPage/basic.tsx`.
- **What are its props?** `bundle` is present, so
  `Read <pkgRoot>/dist/dts-bundle/hooks/useEntityPage.d.ts` — not the page.
- **Any setup requirement?** `Read <pkgRoot>/dist/docs/useEntityPage.md`.

**When the artifact you want is not listed:**

- **No `examples`?** A hook's usage is often filed under the component it belongs to rather
  than under itself. Try that entry's examples before falling back to the types.
- **No `importPath`?** It is a guide, or a name that is documented but not exported. There is
  no import to take.
- **The entry offers nothing at all?** It is a guide, or a state object you receive rather than
  construct. Its doc is the only source — read it.

### 5 — Two traps that make a read wrong

**Search inside the file an index named, never across the tree.** A shared shape is re-stubbed
in every bundle that references it, and a stub is a pointer, not a declaration — some types
appear as a stub in dozens of files and are declared for real in exactly one. A tree-wide
`grep` for a type name therefore returns mostly pointers, and the first hit is usually not the
answer. Resolve the name to one file first, then search *that* file.

**A `…Params` type is often a `Pick<>` or `Omit<>` of a type declared in another file**, so no
single file states the resolved shape — resolving it means intersecting a key list here with a
declaration there. Before starting that, check the bundle entry's `readWith`: it names the
files this one stubs, so you learn whether the answer is one file or ten. When it names more
than a couple, **read the example instead** and use the types only to confirm what you saw.

What the generated files' conventions mean — which one-line stubs are answers rather than
truncation, what a bare `import` implies, how entry-point files are scoped — is the library's
own `Read <pkgRoot>/dist/docs/Reading the Doc Indices.md`. Read it before your first
`dist/dts-bundle/*.d.ts` of the session.

### Decide first, then batch what survives

One index read covers the whole page, so list every symbol you plan to write — components,
hooks, state types, prop types — and resolve each one against the index. Then, **per symbol**,
apply step 4: take `importPath` as data, and open only the one artifact that answers your open
question.

Batch whatever survives into a single call — files opened one per call re-send the whole
conversation each time, which is where a lookup session's token cost goes. But batching is not
a licence to skip the filter: every file in a batch costs dispatch time regardless of its size,
so a large defensive batch is slow before it is useful. A few deliberate reads beat dozens of
just-in-case ones.

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

- **Use the exact `file`, `bundle` and `examples` values, prefixed per step 4; never
  reconstruct a path from a name.** Bundles nest one directory per kind
  (`components/Table.d.ts`, `hooks/useForm.d.ts`), so `<Name>.d.ts` at the top level is wrong
  by construction — and an example is a slug from a variation title, so it is not derivable
  either.
- **Extract what you need, from the file the index named.** A whole-file `Read` is always safe
  — the index's `bytes` says the size beforehand — and a targeted `grep`/`sed` inside
  `dist/docs/`, `dist/examples/` or `dist/dts-bundle/` is fine and cheaper. Scope it to that
  one file, per step 5.
  If an extraction comes back empty or ambiguous, read the whole file rather than guessing from
  a partial match.
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
