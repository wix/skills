# Draft Template — the starting point for every dashboard page

**Start here for any Dashboard Page request, before writing a shell, provider, or router from scratch.** Pick the case below, copy its files, rename, and adapt fields/API calls/data source. Only leave this file for [WIX_PATTERNS_DOCS.md](../WIX_PATTERNS_DOCS.md), [COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md), [TABLE_STATE.md](TABLE_STATE.md), a component doc, or an MCP lookup when the request needs something no case shows.

Every snippet below was copied from the installed `dist/docs/*.md` and `dist/dts-bundle/*.d.ts`, not from memory — confirm props against your own installed version before deviating.

## Which case matches the request?

| The request needs… | Case | Router? |
| --- | --- | --- |
| Only a list/report — no create/edit form, maybe click a row for a quick look | **A — Collection only** | No |
| A list **and** create/edit for each record (no separate app-settings area) | **B — Collection + Entity** | Yes |
| Only app-wide settings/config — no list at all | **C — Settings only** | No |
| A list, create/edit, **and** an app-settings area, all in one extension | **D — Collection + Entity + Settings** | Yes |

Don't default to D because it's the most complete — [Step 4c's checklist](../../SKILL.md#step-4c-ux-completeness-self-audit) doesn't ask for a settings or entity page unless the request needs one. If unsure between B and D, re-read the prompt for "settings," "configure," "preferences" — their absence means B.

**Cases B and D both need a router** — their entry file, app shell, and entity page are in [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md). Section 2's collection page and the settings file are shared by every case that uses them, B and D included; the router file links back rather than repeating them.

## File layout

```
src/extensions/dashboard/pages/{feature}/
  {feature}.extension.ts        # single wix generate scaffold — always exactly one route registered here
  {feature}.tsx                 # entry — Case A/C: see Section 1 below. Case B/D: see DRAFT_TEMPLATE_ROUTER.md
  {Feature}App.tsx              # Case B/D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}CollectionPage.tsx   # Case A, B, D — Section 2 below
  {Feature}EntityPage.tsx       # Case B, D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}SettingsPage.tsx     # Case C, D only — see DRAFT_TEMPLATE_SETTINGS.md
  {feature}-api.ts              # fetch/save calls — keep these out of the components
```

Scaffold with a single call regardless of case — this is always one extension:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

## 1. Entry — Case A or C (router-free, no location plumbing)

The page component renders the shell directly — no `PatternsReactRouter`, so no manual `location` wiring either:

```tsx
// {feature}.tsx — Case A or C
import type { FC } from 'react';
import { withDashboard } from '@wix/patterns';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { {Feature}CollectionPage } from './{Feature}CollectionPage'; // or {Feature}SettingsPage for Case C — DRAFT_TEMPLATE_SETTINGS.md

const Page: FC = () => (
  <WixDesignSystemProvider>
    <WixPatternsProvider>
      <{Feature}CollectionPage />
    </WixPatternsProvider>
  </WixDesignSystemProvider>
);

export default withDashboard(Page);
```

Case B/D's entry file differs — it needs `location` supplied manually for `PatternsReactRouter`. See [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) rather than adding that plumbing here; it's dead code without a router underneath it.

## 2. Collection page — Case A, B, D

This is the file [Step 4c's UX Completeness Self-Audit](../../SKILL.md#step-4c-ux-completeness-self-audit) is about: `SummaryBar`, a working filter, and a drill-in. Case A only gets the first drill-in tier, having no EntityPage route to escalate to.

```tsx
// {Feature}CollectionPage.tsx — Case A, B, D
import { useState, type FC } from 'react';
import {
  CollectionEmptyState, CollectionErrorState, CollectionNoResultsState, CollectionSearch, CollectionToolbarFilters,
  MultiSelectCheckboxFilter, SummaryBar, Table, stringsArrayFilter,
  useStaticListFilterCollection, useTableCollection, type SummaryData,
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

  // `state.keyedItems` is typed; `state.collection` is a stub — see TABLE_STATE.md.
  const rows = state.keyedItems.map((keyed) => keyed.item);
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
            search={<CollectionSearch placeholder="Search {feature}" />}
            filters={
              <CollectionToolbarFilters>
                <MultiSelectCheckboxFilter filter={statusFilter} collection={statusOptions} />
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

## 3. Settings page — Case C, D

In [DRAFT_TEMPLATE_SETTINGS.md](DRAFT_TEMPLATE_SETTINGS.md) — `useSettingsPage` + `useForm`,
with the same field-controller patterns as the entity page.

## What to change vs. keep, per case

| Change per request | Keep as shown |
| --- | --- |
| Feature/entity names, fields, columns, API calls in `{feature}-api.ts` | Which case (A/B/C/D) — don't over-build D for a request that only named a list |
| Summary metrics, quick-view fields, form field types | `SidePanel`'s manual positioning — no built-in open state, in every case that uses it |
| Real data source (SDK-first per [SDK-First Rule](../../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)) vs CMS | B/D wiring (provider/router nesting, `parentPath`, `location`): [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) |
