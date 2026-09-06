# Draft Template — Collection page (Cases A, B and D)

> Split out of [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) to keep both files inside the 10k-char
> reference fetch limit. Pick your case there first. This page is shared by A, B and D.

## The collection page

This is the file [Step 4c's UX Completeness Self-Audit](../../SKILL.md#step-4c-ux-completeness-self-audit) is about: `SummaryBar`, a working filter, and a drill-in. Case A only gets the first drill-in tier, having no EntityPage route to escalate to.

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
        cursor: query.cursor, // cursor mode: `cursor` is a required string, '' when done
        search: query.search,
        filters: { status: query.filters.status },
      }),
    fetchErrorMessage: ({ err }) => (err instanceof Error ? err.message : 'Failed to load {feature}'),
  });

  const statusOptions = useStaticListFilterCollection(statusFilter, ['ACTIVE', 'ARCHIVED']);

  // patterns state is MobX. Without useSelector this component never re-renders
  // when the collection resolves and every metric below stays 0 — see TABLE_STATE.md.
  // Select a PRIMITIVE: a fresh array changes identity on every evaluation.
  const loadedCount = useSelector(() => state.keyedItems.length);
  const rows = useMemo(() => state.keyedItems.map((k) => k.item), [loadedCount]);
  const summaryData: SummaryData = [{ title: 'Total', value: String(rows.length) }];

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
            // `search` defaults to ON. Wire it AND read query.search, or a dead box
            // ships. If the API cannot text-search, set search={false}.
            search={<CollectionSearch placeholder="Search {feature}" />}
            filters={
              <CollectionToolbarFilters>
                {/* the label comes from toolbarItemProps, NOT the factory's `name` */}
                <MultiSelectCheckboxFilter
                  filter={statusFilter} collection={statusOptions}
                  toolbarItemProps={{ label: 'Status' }}
                />
              </CollectionToolbarFilters>
            }
            // Three distinct messages. Without errorState a failed query looks
            // exactly like a slow one: skeletons, forever.
            emptyState={<CollectionEmptyState title="No {feature} yet" />}
            noResultsState={<CollectionNoResultsState />}
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
