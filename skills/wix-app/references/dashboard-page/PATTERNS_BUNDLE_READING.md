# Reading `@wix/patterns` Bundles and Docs

> **Scope.** You are here because a lookup in `dist/dts-bundle/index.json` or
> `dist/docs/index.json` gave you an entry and you are about to open the file it names. Getting to that index in the first
> place — resolving the package root, the version floor, the docs lookup, and the rule
> against browsing `node_modules` by hand — is in
> [WIX_PATTERNS_DOCS.md](../WIX_PATTERNS_DOCS.md). Nothing here replaces those steps.

## Where props live

From `@wix/patterns` **1.460.0** onward a doc does not repeat props that the bundle already
describes. Which one holds them is stated in the doc's own index entry:

| `dist/docs/index.json` entry | where the props are |
| --- | --- |
| has a `bundle` field | that bundle — the doc's `### Props` is a pointer to it, on purpose |
| no `bundle` field | the doc's own `### Props` table, as before |

Roughly 74 of 167 docs point at a bundle and 62 still carry a table, so expect both. When a doc
says `Read \`dist/dts-bundle/...\``, that **is** the props answer — read the named file rather
than treating the doc as incomplete. The bundle is the better source anyway: it keeps the
`extends` clause with its exclusions, so `Omit<PopoverMenuItemProps, 'text' | 'prefixIcon' | 'onClick'>` tells
you what you do *not* inherit, which the old doc link did not.

## Types the docs don't cover

The same bundles also hold the types those props use — `Filter<T>`, `RangeItem<T>`, `CursorQuery`, a `...Props` interface. `Read <pkgRoot>/dist/dts-bundle/index.json`, look up the type name, then `Read <pkgRoot>/dist/dts-bundle/<entry.file>` using exactly the `file` path the index gives — **never reconstruct the path from the name**; bundles are nested one directory per kind (`components/Table.d.ts`, `hooks/useForm.d.ts`, `types/RangeItem.d.ts`, …), so guessing `<Name>.d.ts` at the top level is wrong by construction.

Several of these types (`RangeItem`, `Filter`, `CursorQuery`, the filter factory functions) actually live in `@wix/bex-core` — the bundle already resolves and inlines the real declaration, so you get the full shape with no deep, undeclared `@wix/bex-core/dist/types/...` path to chase. Still always import it from `@wix/patterns`, per the index's `importPath` field, never from wherever the bundle says it's really declared.

That inlining applies to the data shapes you write. State objects you *receive* are a separate case — see the next section.

## A bundle stops where you stop writing code

A bundle carries its own name's declaration plus every shape **you** would write by hand. It deliberately does *not* expand what the library hands you, so two kinds of one-line stub are normal and are answers, not truncation:

```ts
/**
 * `TableState` — you receive this, you don't construct it.
 * Produced by `useTableCollection()` (also `useAmbassadorTable()`, `useTableContext()`).
 * Look `TableState` up in the bundle index for its own API.
 */
declare class TableState<T, F> {
}
```

An empty body with a **"Produced by"** note means: call that hook or factory to get one. That is usually the whole answer — `<Table state={...}>` needs `useTableCollection()`, not `TableState`'s internals. If you do need its members (`state.toolbar`, `state.visibleColumns`), it has its own index entry — look the name up and read that bundle, where its body is complete.

A stub saying **"cut here because it has its own bundle"** means the same thing for a shape you *do* write: it wasn't copied in twice, so look the name up and read its own file.

Every bundle fits in a single read; the index's `bytes` field says how big before you open it. So a bundle is never partially shown — if something looks missing, it was cut on purpose. Both stubs above name where to find it.

### The one that doesn't: a bare `import`

A plain `import { X } from '<module>'` at the top of a bundle, with no note attached, is the third shape you will meet — and unlike the two above it does **not** tell you where to look. What to do depends on the path, not the name:

**A normal entry point** — `react`, `react-hook-form`, `history`, `@wix/design-system`. Resolve it the ordinary way. For `@wix/design-system` names use the `wix-design-system` skill; don't read WDS files directly.

**A deep internal path** — `@wix/design-system/dist/types/DropdownLayout`, `@wix/bex-utils/@wix/bi-logger-os-data/v2/types`. This is an upstream defect: the bundle recorded where the type is *declared* instead of where it is exported. Two things follow, and the second is the one that saves you time:

- Never import that path in your own code, and don't go read the file it points at. It is not a public entry point, and the name is often not re-exported from the package root either — `DropdownLayoutOption` is not exported from `@wix/design-system`, so there is no shorter import to substitute.
- You usually don't need the declaration at all. Where the type is a **prop you fill in** — WDS option shapes like `SingleSelectFilter`'s and `AutoCompleteFilter`'s `items` — look the *component* up in the `wix-design-system` skill and use the shape its docs show. Where it is a **pass-through you never construct** — the BI logger params behind optional fields like `biAdditionalInfo` — pass what the patterns doc shows, or omit it; it is optional.

If a name you genuinely need stays unresolved after that, stop and say so, and name the bundle and the exact import path that dead-ended. Do not guess a shape and do not go spelunking in `node_modules` — a wrong guess compiles here and breaks at runtime, which is worse than the missing type.

A handful of names carry `"status": "unreachable"` with a message saying not to import them (the `...BaseProps` interfaces a component's props `extends`). Read those for the props they contribute; don't write an import for them.

`status` also carries `"deprecated"`, and there the `statusMessage` names the replacement — `PrimaryPageButton` says *"Use `PrimaryActions` component instead."* Check it before you commit to a name — nothing else in the lookup path will stop you, since a deprecated component still compiles and still renders. If the index calls a name deprecated, use what its message names instead.

## Subpath entry points

`@wix/patterns` is 31 entry points, not one namespace, and `/form` re-exports `@wix/bex-core/form`. To see what's importable from a specific one: `Read <pkgRoot>/dist/dts-bundle/exports/<subpath>.d.ts` directly (`.` is `exports/index.d.ts`; a nested one like `./testkit/backend` is `exports/testkit/backend.d.ts`). This only lists the curated names covered above — a file with nothing in it (a one-line comment) means no curated name lives on that subpath yet, not that the subpath doesn't exist.

## Following cross-references

Docs link to related names as Storybook URLs (`[TableState](./?path=/story/...--tablestate)`) — resolve the link text back to a filename via `dist/docs/index.json`, the same way you found the first doc, and `Read` it if you actually need it. There's no automatic multi-level expansion here; follow only the links you need.

Links to `https://www.docs.wixdesignsystem.com/` are external (Wix Design System) — not part of `@wix/patterns` docs. Likewise, a bundled `.d.ts` that references a deep `@wix/design-system/dist/...` path is pointing at that library's own internals — look the name up via the `wix-design-system` skill's own tool, not by opening the path.

## Tips

- **Compound components** have separate docs per sub-part: `CollectionPage.md`, `CollectionPage.Header.md`, `CollectionPage.Content.md`.
- **Hook docs** list configuration options as props — in the API table when the doc has no
  `bundle` field, otherwise in the bundle it points at.
- **Heavy examples live beside the doc.** A variation whose code was long is written out
  separately, and the doc keeps the heading, the description and an exact path:
  `Example code: read \`dist/docs/ToolbarFilters/apply-changes.tsx\``. Read that path only if you
  need that particular variation — the heading and description are usually enough to choose.
