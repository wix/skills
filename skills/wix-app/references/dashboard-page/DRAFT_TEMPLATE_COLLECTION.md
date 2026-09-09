# Draft Template — Collection page (Cases A, B and D)

> Split out of [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) so the case chooser stays short. Pick your
> case there first. This page is shared by A, B and D.

> **This is the hand-wired path — you write `fetchData`, the filters and the columns.** If the rows
> are a CMS collection, its schema already knows all three: use
> [DRAFT_TEMPLATE_CMS_COLLECTION.md](DRAFT_TEMPLATE_CMS_COLLECTION.md) instead.

## The collection page

This is the file [Step 4c's UX Completeness Self-Audit](../../SKILL.md#step-4c-ux-completeness-self-audit) is about: a working filter, a drill-in, and — where the page earns one — a `SummaryBar`. **Delete the `summaryBar` prop when the page doesn't need an aggregate**; it is in the skeleton because wiring it correctly is fiddly, not because every page should carry one. Case A only gets the first drill-in tier, having no EntityPage route to escalate to.

```tsx
// {Feature}CollectionPage.tsx — Case A, B, D
import { useMemo, useState, type FC } from 'react';
import {
  CollectionEmptyState, CollectionErrorState, CollectionNoResultsState, CollectionSearch, CollectionToolbarFilters,
  MultiSelectCheckboxFilter, SummaryBar, Table, stringsArrayFilter,
  useSelector, useStaticListFilterCollection, useTableCollection, type SummaryData,
} from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';
import { Box, SidePanel, Text } from '@wix/design-system'; // + Button for Case B/D
// Case B/D only — Case A has no EntityPage route to navigate to, so no import, no button:
import { usePatternsNavigate } from '@wix/patterns/router';
import { fetch{Feature}Page, type {Entity}Row } from './{feature}-api';

const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', ARCHIVED: 'Archived' };
// Filter factories are module-level: one instance per page, not per render.
const statusFilter = stringsArrayFilter<'ACTIVE' | 'ARCHIVED'>({
  name: 'Status',
  itemKey: (item) => item,
  itemName: (item) => STATUS_LABELS[item] ?? item,
});

export const {Feature}CollectionPage: FC = () => {
  const [quickViewItem, setQuickViewItem] = useState<{Entity}Row | null>(null);
  const { navigateToEntityPage } = usePatternsNavigate(); // Case B/D only

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
    // Cursor mode: this is what fills `collection.total`, and its filter must match
    // fetchData's or the headline number disagrees with the rows under it.
    fetchTotal: async (query) => count{Feature}({ search: query.search, filters: query.filters }),
    fetchErrorMessage: ({ err }) => (err instanceof Error ? err.message : 'Failed to load {feature}'),
  });

  const statusOptions = useStaticListFilterCollection(statusFilter, ['ACTIVE', 'ARCHIVED']);

  // patterns state is MobX. Without useSelector this component never re-renders
  // when the collection resolves and every metric below stays 0 — see TABLE_STATE.md.
  // Select a PRIMITIVE: a fresh array changes identity on every evaluation.
  const loadedCount = useSelector(() => state.keyedItems.length);
  // `keyedItems` is what has been PAGED IN; `collection.total` is what MATCHES the
  // filters (cursor mode fills it from fetchTotal). A headline metric counted from
  // rows says "50" next to a filter matching 4,000 — label it or use the total.
  const matchingTotal = useSelector(() => state.collection.total);
  const rows = useMemo(() => state.keyedItems.map((k) => k.item), [loadedCount]);
  const summaryData: SummaryData = [{ title: 'Total', value: String(matchingTotal) }];

  return (
    <>
      <CollectionPage>
        <CollectionPage.Header title={{ text: '{Page Title}' }} />
        <CollectionPage.Content>
          <Table
            state={state}
            summaryBar={
              <SummaryBar
                data={summaryData}
                // NOT `showLoadingState`: it stays true at zero rows and the bar
                // sticks on skeleton pills forever.
                status={state.showErrorState ? 'error' : 'success'}
                onRetry={() => state.retryErrorState()}
              />
            }
            // `search` defaults to ON, so omitting it ships a box that reaches no
            // query. Wire it AND read query.search below. If the API has no
            // free-text filter, resolve the term to one it does support.
            search={<CollectionSearch placeholder="Search {feature}" />}
            filters={
              <CollectionToolbarFilters>
                {/* Labels come from these props, NOT the factory's `name`, and both
                    are needed: toolbarItemProps names the inline chip,
                    accordionItemProps names it in the side panel. */}
                <MultiSelectCheckboxFilter
                  filter={statusFilter} collection={statusOptions}
                  toolbarItemProps={{ label: 'Status' }}
                  accordionItemProps={{ label: 'Status', title: 'Status' }}
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
            onRowClick={(item) => setQuickViewItem(item)}
            columns={[
              // One column per field the prompt names; verify each source field —
              // COLLECTION_TOOLKIT.md, "A column must show what its header promises."
              { id: 'name', title: 'Name', render: (item) => item.name },
            ]}
          />
        </CollectionPage.Content>
      </CollectionPage>

      {/* SidePanel has no built-in open state or portal — position it yourself. */}
      {quickViewItem ? (
        <Box style={{ position: 'fixed', top: 0, right: 0, height: '100%', zIndex: 1000 }}>
          <SidePanel onCloseButtonClick={() => setQuickViewItem(null)}>
            <SidePanel.Header title={quickViewItem.name} showDivider />
            <SidePanel.Content>
              <Text>{/* read-only glance fields — not the full form */}</Text>
            </SidePanel.Content>
            {/* Case B/D only — Case A ends here. Footer button:
                navigateToEntityPage({ path: `/${quickViewItem.id}`, entity: quickViewItem }) */}
          </SidePanel>
        </Box>
      ) : null}
    </>
  );
};
```
