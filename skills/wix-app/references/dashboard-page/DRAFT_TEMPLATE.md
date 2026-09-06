# Draft Template — the starting point for every dashboard page

**Start here for any Dashboard Page request, before writing a shell, provider, or router from scratch.** Pick the case below, copy its files, rename, and adapt fields/API calls/data source. Only leave this file for [WIX_PATTERNS_DOCS.md](../WIX_PATTERNS_DOCS.md), [COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md), a component doc, or an MCP lookup when the request needs something no case shows — an unusual filter type, a column renderer not shown here.

Every snippet below is copied from the installed `dist/docs/*.md` this session read, not written from memory — confirm props against your own installed version the same way before you deviate from the shape shown here.

## Which case matches the request?

| The request needs… | Case | Router? |
| --- | --- | --- |
| Only a list/report — no create/edit form, maybe click a row for a quick look | **A — Collection only** | No |
| A list **and** create/edit for each record (no separate app-settings area) | **B — Collection + Entity** | Yes |
| Only app-wide settings/config — no list at all | **C — Settings only** | No |
| A list, create/edit, **and** an app-settings area, all in one extension | **D — Collection + Entity + Settings** | Yes |

Don't default to D because it's the most complete — [Step 4c's checklist](../../SKILL.md#step-4c-ux-completeness-self-audit) doesn't ask for a settings page or an entity page unless the request needs one. Oversized (a router and three page types for a request that named one) is the kind of thing that ships unnoticed. If unsure between B and D, re-read the prompt for "settings," "configure," "preferences" — their absence means B, not D.

**Cases B and D both need a router** — their entry file, app shell, and entity page are in [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md). This file's Collection page (Section 2) and Settings page (Section 3) are shared by every case that uses them, including B and D — the router file links back rather than repeating the code.

## File layout

```
src/extensions/dashboard/pages/{feature}/
  {feature}.extension.ts        # single wix generate scaffold — always exactly one route registered here
  {feature}.tsx                 # entry — Case A/C: see Section 1 below. Case B/D: see DRAFT_TEMPLATE_ROUTER.md
  {Feature}App.tsx              # Case B/D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}CollectionPage.tsx   # Case A, B, D — Section 2 below
  {Feature}EntityPage.tsx       # Case B, D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}SettingsPage.tsx     # Case C, D only — Section 3 below
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
import { {Feature}CollectionPage } from './{Feature}CollectionPage'; // or {Feature}SettingsPage for Case C

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

This is the file [Step 4c's UX Completeness Self-Audit](../../SKILL.md#step-4c-ux-completeness-self-audit) is actually about: `SummaryBar` for the aggregate, and a drill-in so a row can be opened. The two drill-in tiers below are independent — Case A only ever gets the first one, since there's no EntityPage route to escalate to.

```tsx
// {Feature}CollectionPage.tsx — Case A, B, D
import { useState, type FC } from 'react';
import { Table, SummaryBar, useTableCollection, type SummaryData } from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';
import { Box, Button, SidePanel, Text } from '@wix/design-system';
// Case B/D only — Case A has no EntityPage route to navigate to, so no import, no button:
import { usePatternsNavigate } from '@wix/patterns/router';
import { fetch{Feature}Page, type {Entity}Row } from './{feature}-api';

export const {Feature}CollectionPage: FC = () => {
  const [quickViewItem, setQuickViewItem] = useState<{Entity}Row | null>(null);
  const { navigateToEntityPage } = usePatternsNavigate(); // Case B/D only

  const state = useTableCollection<{Entity}Row>({
    queryName: '{feature}',
    paginationMode: 'offset',
    itemKey: (item) => item.id,
    itemName: (item) => item.name,
    fetchData: async (query) => fetch{Feature}Page(query),
    fetchErrorMessage: ({ err }) => (err instanceof Error ? err.message : 'Failed to load {feature}'),
    filters: {},
  });

  // Compute from the same query the table uses — a metric that disagrees with the visible rows
  // is worse than no metric. See COLLECTION_TOOLKIT.md's "Understand" section.
  const summaryData: SummaryData = [{ title: 'Total', value: String(state.collection.result.total) }];

  return (
    <>
      <CollectionPage>
        <CollectionPage.Header title={{ text: '{Page Title}' }} />
        <CollectionPage.Content>
          <Table
            state={state}
            summaryBar={<SummaryBar data={summaryData} status="success" onRetry={async () => {}} />}
            onRowClick={(item) => setQuickViewItem(item)}
            columns={[
              // One column per field the prompt names. Verify each source field —
              // see COLLECTION_TOOLKIT.md's "A column must show what its header promises."
              { id: 'name', title: 'Name', render: (item) => item.name },
            ]}
          />
        </CollectionPage.Content>
      </CollectionPage>

      {/* SidePanel has no built-in open/close state or overlay portal — position/animate it
          yourself. Minimal version; see wix-design-system's SidePanel "Quick view" example. */}
      {quickViewItem ? (
        <Box style={{ position: 'fixed', top: 0, right: 0, height: '100%', zIndex: 1000 }}>
          <SidePanel onCloseButtonClick={() => setQuickViewItem(null)}>
            <SidePanel.Header title={quickViewItem.name} showDivider />
            <SidePanel.Content>
              <Text>{/* read-only glance fields — not the full form */}</Text>
            </SidePanel.Content>
            {/* Case B/D only — Case A ends here, there's nowhere further to go: */}
            <SidePanel.Footer>
              <Button
                onClick={() =>
                  navigateToEntityPage({ path: `/${quickViewItem.id}`, entity: quickViewItem })
                }
              >
                Open full record
              </Button>
            </SidePanel.Footer>
          </SidePanel>
        </Box>
      ) : null}
    </>
  );
};
```

## 3. Settings page — Case C, D

No dedicated toolkit file exists for this yet (unlike Entity/Collection) — the shape, verified against `useSettingsPage.md`:

```tsx
// {Feature}SettingsPage.tsx — Case C or D
import { SettingsPage, useSettingsPage, useSettings } from '@wix/patterns';
import { useForm } from '@wix/patterns/form';
import { fetch{Feature}Settings, save{Feature}Settings } from './{feature}-api';

export const {Feature}SettingsPage = () => {
  const form = useForm<{Feature}SettingsFormFields>();

  const state = useSettingsPage<{Feature}Settings, {Feature}SettingsFormFields>({
    form,
    fetch: () => fetch{Feature}Settings().then((settings) => ({ settings })),
    onSave: () => save{Feature}Settings(form.getValues()),
    onCancel: async () => form.reset(),
    saveSuccessToast: 'Settings saved',
    saveErrorToast: (err, { retry }) => ({ message: 'Failed to save settings', action: { text: 'Retry', onClick: retry } }),
  });

  const settings = useSettings<{Feature}Settings, {Feature}SettingsFormFields>(state);

  return (
    <SettingsPage state={state}>
      <SettingsPage.Header title={{ text: '{Settings Page Title}' }} />
      <SettingsPage.Content>
        <SettingsPage.MainContent>{/* form cards — same field-controller patterns as EntityPage */}</SettingsPage.MainContent>
      </SettingsPage.Content>
    </SettingsPage>
  );
};
```

`useSettingsPage`'s params are all required except `saveSuccessToast`/`saveErrorToast`: `form`, `fetch`, `onSave`, `onCancel`. There is no `parentPath`/`parentPageId` — a settings page isn't reached by drilling into a row, so it carries no back-navigation contract, and Case C needs no router at all to reach it (Section 1's entry renders it directly).

## What to change vs. keep, per case

| Change per request | Keep as shown |
| --- | --- |
| Feature/entity names, fields, columns, API calls in `{feature}-api.ts` | Which case (A/B/C/D) — don't over-build D for a request that only named a list |
| Summary metrics, quick-view fields, form field types | `SidePanel`'s manual positioning — no built-in open state, in every case that uses it |
| Real data source (SDK-first per [SDK-First Rule](../../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)) vs CMS | B/D wiring (provider/router nesting, `parentPath`, `location`): [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) |
