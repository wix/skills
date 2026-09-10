# Filters — naming them, and why a title goes missing

> Split out of [COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md), which lists *which* filter component
> to reach for. This file is about labelling them, which is where measured runs go wrong: filters
> that work, narrow correctly, and render with no title.

Every claim below was read from the installed `@wix/patterns` sources —
`CollectionToolbarFilters.tsx`, `FilterAccordionTitle.tsx`, `FilterTagContent.tsx`,
`useBuildAccordionItems.tsx`, `useFiltersLayout.ts` and `model/filterProps.ts`.

## The four surfaces

A filter's visible title does not come from its factory. `stringsArrayFilter({ name: 'Status' })`
sets `filter.name`, which feeds a11y legends, BI grouping and dataHooks — **never a rendered
title**. Three separate props do, and they resolve independently:

| Surface | Comes from | Fallback when absent |
| --- | --- | --- |
| The filter's title in the filters side panel | `accordionItemProps.label` | `''` — a nameless accordion row |
| The prefix on an applied-filter tag ("Status: Active") | `toolbarTagProps.label ?? accordionItemProps.label` | no prefix at all |
| Matched by the filters panel's own search box | `accordionItemProps.label` | never findable by search |
| The label beside an inline filter in the toolbar | `toolbarItemProps.label` | no label |

So: **pass `toolbarItemProps.label` and `accordionItemProps.label`, with the same string, on every
filter.** `accordionItemProps.label` is the one that must never be missing — it alone drives three
of the four surfaces.

**Never pass `accordionItemProps.title`.** The whole object is spread over the accordion item
*after* Cairo composes its own title, so a `title` string replaces that composition and silently
drops the active-count badge (`Status (2)`), the field-type icon, and the per-filter reset button.
`label` is the prop; `title` is an escape hatch for a fully custom element, and passing the same
text in both is strictly worse than passing `label` alone.

**Inline labels disappear by design as filters are added, and this is the usual "the filter has no
title" report.** `CollectionToolbarFilters` lays itself out from counts: at most
`maxInlineFilters` (default **3**) filters render inline at all — past that they all move into the
side panel — and inline *labels* render only while the inline buttons number at most
`maxInlineLabels` (default **2**), the panel button included. A page with three filters therefore
shows inline controls with no labels, and the same page with five shows a panel button alone. The
filters are still named, in the panel, from `accordionItemProps.label` — which is why that prop
being right matters more than the inline one. Set `maxInlineFilters` / `maxInlineLabels`
deliberately if a specific inline layout was requested; don't chase the labels with a `title`.

## The check that catches it

Grep the page for the two props and count: every filter element needs both, and the strings should
match each other and the column header the filter narrows.

```bash
grep -c "accordionItemProps" src/extensions/dashboard/pages/<page>/*CollectionPage.tsx
grep -c "toolbarItemProps"  src/extensions/dashboard/pages/<page>/*CollectionPage.tsx
grep -n "accordionItemProps={{[^}]*title" src/extensions/dashboard/pages/<page>/*CollectionPage.tsx  # must be empty
```

Two counts that differ, or either below the number of filters, is the bug — not a style nit.

## Naming is not the same as working

A named filter that never reaches the query is the other half of this failure: every filter
declared in `filters` must also be read inside `fetchData`
([DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md)), and filter state lives on the
factory objects, not on `state.filters`, which does not exist
([TABLE_STATE.md](TABLE_STATE.md#four-that-bite-in-practice)).
