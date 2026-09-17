# Draft Template — Collection page (Cases A, B and D)

> Split out of [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) so the case chooser stays short. Pick your
> case there first. This page is shared by A, B and D.

> **You write `fetchData`, the filters and the columns.** This holds whatever the rows are: for a
> CMS collection `fetchData` calls `@wix/data` `items.query()`
> ([WIX_DATA.md](../data-collection/WIX_DATA.md)) and nothing else on this page changes.

## Two rules this skeleton encodes, so read them before editing it

**Every row opens something, and which one depends on whether the record is editable.** An
**editable** record navigates: `onRowClick` calls `navigateToEntityPage` to an `EntityPage` route
([DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md)) — never a panel, because in Cairo a panel
hosts a page's own side panels and no `example-bm` collection navigates a row into one. A
**display-only** collection is the exception, and only because `EntityPage` has no read-only mode:
it opens a full-height WDS `SidePanel` ([below](#read-only-rows-the-detail-side-panel)). A row that
opens nothing is the defect either way.

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
          // The drill-in for an EDITABLE record: the EntityPage route. Passing `entity`
          // lets the target title itself before its fetch lands. A display-only
          // collection uses `onRowClick={setSelected}` and the side panel instead.
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

## Read-only rows: the detail side panel

Case A only. `EntityPage` has no read-only mode — `useEntityPageHeader` composes
`EntityPageActionsBar` unconditionally and that bar always renders Save and Cancel — so a
display-only record opens into a WDS `SidePanel` instead, and keeps the filtered list on screen.
The moment the request grows an edit form this becomes an `EntityPage` route instead
([DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md)).

**`height="100vh"` is the whole point.** `SidePanel`'s `height` defaults to `'100%'`, which fills
its *parent* — inside a `CollectionPage` body that is the table's height, so the panel arrives
short and the record looks cropped. Pair it with `Content stretchVertically` so the body fills the
panel and scrolls inside it. `width` defaults to `420px`.

```tsx
// {Feature}DetailPanel.tsx — Case A
import { Card, SidePanel, Text } from '@wix/design-system';
import type { {Entity}Row } from './{feature}-api';

export const {Feature}DetailPanel = ({
  entity, onClose,
}: { entity: {Entity}Row; onClose: () => void }) => (
  <SidePanel height="100vh" closeButtonProps={{ onClick: onClose }}>
    <SidePanel.Header title={entity.name} />
    <SidePanel.Content stretchVertically>
      <Card>
        <Card.Content>
          <Text>{entity.name}</Text>
        </Card.Content>
      </Card>
    </SidePanel.Content>
  </SidePanel>
);
```

Hold the open record in the collection page and render the panel beside the table —
`const [selected, setSelected] = useState<{Entity}Row>()`, `onRowClick={setSelected}`, and
`{selected && <{Feature}DetailPanel entity={selected} onClose={() => setSelected(undefined)} />}`.
Use `closeButtonProps`, not `onCloseButtonClick`: that one is deprecated.

**If the detail needs fields the row doesn't carry, the panel fetches too.** `onRowClick` hands you
the table row, which is usually a projection — so a panel that shows more than the table already
showed needs its own call, keyed off the row's id:

```tsx
const [detail, setDetail] = useState<{Entity} | undefined>();

useEffect(() => {
  setDetail(undefined);
  fetch{Entity}(entity.id).then(setDetail);
}, [entity.id]);
```

Render a `Loader` inside `SidePanel.Content` until `detail` arrives. The `setDetail(undefined)` on
every id change is the part that gets skipped: without it the panel shows the previous record's
fields while the new one loads, which reads as the wrong record rather than a pending one.
