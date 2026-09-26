# Draft Template — Collection page (Cases A, B and D)

> Split out of [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) so the case chooser stays short. Pick your
> case there first. This page is shared by A, B and D.

> **This is the hand-wired path — you write `fetchData`, the filters and the columns.** If the rows
> are a CMS collection, its schema already knows all three: use
> [DRAFT_TEMPLATE_CMS_COLLECTION.md](DRAFT_TEMPLATE_CMS_COLLECTION.md) instead — *unless* the prompt
> names an exact column subset, which that path cannot express
> ([DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md#then-which-data-path)). Then it is this file, over
> `@wix/data`.

## Two rules this skeleton encodes, so read them before editing it

**Every row opens a page of its own, never a panel.** `onRowClick` navigates —
`navigateToEntityPage` to an `EntityPage` route when the record is editable, or to a read-only
detail route when the page is display-only ([DRAFT_TEMPLATE_ROUTER.md § 4](DRAFT_TEMPLATE_ROUTER.md#4-read-only-detail-route--case-a)).
A WDS `SidePanel` is not the drill-in: in Cairo it is the host for a page's own side panels — the
fields card's "Manage fields", a table's column panel — and `example-bm` uses it as a row drill-in
in exactly nothing. Every collection example there navigates.

**No `SummaryBar` unless the request asked for one.** Not "unless the page seems to want one" —
unless the prompt named a total, a count, or a "how many / how much" figure. It is absent from this
skeleton on purpose; adding one uninvited pushes the rows down the page and puts a number on screen
nobody has to be right about. When you do add one, wire it from
[SKILL.md § Step 2](../../SKILL.md) — no `SummaryBar` unless the request asked for one.

## The collection page

This is the file [Step 4c's UX Completeness Self-Audit](../../SKILL.md#step-4c-ux-completeness-self-audit)
is about: a working filter, named filters, and a row that opens.

```tsx
// {Feature}CollectionPage.tsx — Case A, B, D
import type { FC } from 'react';
import {
  CollectionEmptyState, CollectionErrorState, CollectionNoResultsState, CollectionSearch, CollectionToolbarFilters,
  MultiSelectCheckboxFilter, Table, stringsArrayFilter,
  useStaticListFilterCollection, useTableCollection,
} from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';
import { usePatternsNavigate } from '@wix/patterns/router';
import { fetch{Feature}Page, type {Entity}Row } from './{feature}-api';

const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', ARCHIVED: 'Archived' };
// Filter factories are module-level: one instance per page, not per render.
const statusFilter = stringsArrayFilter<'ACTIVE' | 'ARCHIVED'>({
  // `name` is NOT the visible title — it feeds a11y legends, BI grouping and dataHooks.
  // The title comes from the label props in the JSX below; the package's own
  // `Collection Toolkit.md` guide has the prop model.
  name: 'Status',
  itemKey: (item) => item,
  itemName: (item) => STATUS_LABELS[item] ?? item,
});

export const {Feature}CollectionPage: FC = () => {
  const { navigateToEntityPage } = usePatternsNavigate<{Entity}Row>();

  const state = useTableCollection<{Entity}Row, { status: typeof statusFilter }>({
    queryName: '{feature}',
    paginationMode: 'cursor', // 'offset' if your API pages by offset
    itemKey: (item) => item.id,
    itemName: (item) => item.name,
    filters: { status: statusFilter },
    // Every declared filter AND the search box are read here — one that never
    // reaches the query renders fine and narrows nothing.
    fetchData: async (query) =>
      fetch{Feature}Page({
        limit: query.limit,
        cursor: query.cursor ?? undefined, // return `cursor: next || undefined` — key always
        //                                    present, '' walks pages forever
        search: query.search,
        filters: { status: query.filters.status },
      }),
    // fetchTotal is for a requested aggregate, so it is commented out here. Uncommented, it
    // must RESOLVE A NUMBER from an endpoint that counts, and it OVERRIDES the fallback to the
    // loaded-rows count — so a wrong one reports 0 beside a full table while tsc stays green.
    // Read QUERY_AND_PAGING.md, "What fetchTotal is allowed to call", before uncommenting.
    // fetchTotal: async (query) => count{Feature}({ search: query.search, filters: query.filters }),
    fetchErrorMessage: ({ err }) => (err instanceof Error ? err.message : 'Failed to load {feature}'),
  });

  const statusOptions = useStaticListFilterCollection(statusFilter, ['ACTIVE', 'ARCHIVED']);

  // Nothing here reads `state` directly: the Table observes it internally. The moment you
  // DO derive a number from it in this component — a header figure, a badge, a requested
  // SummaryBar — it is MobX, and a plain read is computed once while the collection is still
  // empty and never recomputed. Wrap it in `useSelector` and select a primitive: TABLE_STATE.md.

  return (
    <CollectionPage>
      <CollectionPage.Header title={{ text: '{Page Title}' }} />
      <CollectionPage.Content>
        <Table
          state={state}
          // `search` defaults to ON, so omitting it ships a box that reaches no
          // query. Wire it AND read query.search above. If the API has no
          // free-text filter, resolve the term to one it does support.
          search={<CollectionSearch placeholder="Search {feature}" />}
          filters={
            <CollectionToolbarFilters>
              {/* BOTH label props, same string, and never accordionItemProps.title.
                  The resolution model is the package's own `Collection Toolkit.md` guide. */}
              <MultiSelectCheckboxFilter
                filter={statusFilter} collection={statusOptions}
                toolbarItemProps={{ label: 'Status' }}
                accordionItemProps={{ label: 'Status' }}
              />
            </CollectionToolbarFilters>
          }
          // Three distinct messages. Without errorState a failed query looks
          // exactly like a slow one: skeletons, forever.
          emptyState={<CollectionEmptyState title="No {feature} yet" />}
          // Name what excluded the rows — a seeded default or a missing scope
          // looks exactly like "nothing matched", and only one is actionable.
          noResultsState={<CollectionNoResultsState title="No {feature} match" subtitle="…" />}
          // errorState is a RENDER FUNCTION: (err, { retry }) => ReactElement.
          errorState={(err, { retry }) => (
            <CollectionErrorState
              title="Couldn't load {feature}"
              subtitle={String(err)}
              action={{ text: 'Retry', onClick: retry }}
            />
          )}
          // The drill-in. Editable record → the EntityPage route (`/${item.id}`).
          // Display-only → the read-only route, DRAFT_TEMPLATE_ROUTER.md §4. Either way a
          // route, and passing `entity` lets the target title itself before its fetch lands.
          onRowClick={(item) => navigateToEntityPage({ path: `/${item.id}`, entity: item })}
          columns={[
            // One column per field the prompt names; verify each source field —
            // DATA_SOURCES.md, "A column must show what its header promises."
            { id: 'name', title: 'Name', render: (item) => item.name },
          ]}
        />
      </CollectionPage.Content>
    </CollectionPage>
  );
};
```

## Turning `query.search` into a query

`{feature}-api.ts` turns one term into a filter over *several* fields — an OR. **This is where
search ships broken**: it renders, it reaches the query, and still returns every row, so nothing
looks wrong until someone counts results. (A CMS collection builds none of this by hand — the
schema source does it, including the scope rules:
[DRAFT_TEMPLATE_CMS_COLLECTION.md](DRAFT_TEMPLATE_CMS_COLLECTION.md#search-is-the-sources-job-and-its-scope-is-the-visible-columns).)

No shared free-text operator; the shape differs per endpoint. Read its *Supported Filters* page
([QUERY_AND_PAGING.md](QUERY_AND_PAGING.md#the-filterable-fields-are-a-closed-list-published-per-endpoint)),
then `$or` one clause per identity field it lists. Never route the term to a single field by its
shape — a measured run shipped this, and one branch is always dead:

```ts
query = term.includes('@')
  ? query.startsWith('loginEmail', term)
  : query.startsWith('contact.firstName', term);  // a surname matches nothing, ever
```

`startsWith` is prefix-only too — "Smith" never finds "John Smith" — so prefer the containment
operator when the endpoint declares one, and say which you used in `noResultsState`.

**Whatever the shape, prove it narrows.** Run one term you expect to hit a known row and one you
expect to hit nothing, and check the row count changes for both.
