# Draft Template — the starting point for every dashboard page

**Start here for any Dashboard Page request, before writing a shell, a provider, or a router from scratch.** Pick the row below that matches the request, copy the files it names, rename, and adapt fields/API calls/data source. Only leave this file for [WIX_PATTERNS_DOCS.md](../WIX_PATTERNS_DOCS.md), [COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md), a component doc, or an MCP lookup when the request needs something this file doesn't show — an unusual filter type, a column renderer not shown here, a component the four cases below don't cover. Hand-composing the page shell, provider nesting, or router wiring that Cases A–D already show is the failure mode this file exists to prevent.

Every snippet below is copied from the installed `dist/docs/*.md` this session read, not written from memory — confirm props against your own installed version the same way before you deviate from the shape shown here.

## Which case matches the request?

| The request needs… | Case | Router? |
| --- | --- | --- |
| Only a list/report — no create/edit form, maybe click a row for a quick look | **A — Collection only** | No |
| A list **and** create/edit for each record (no separate app-settings area) | **B — Collection + Entity** | Yes — 3 routes |
| Only app-wide settings/config — no list at all | **C — Settings only** | No |
| A list, create/edit, **and** an app-settings area, all in one extension | **D — Collection + Entity + Settings** | Yes — 4 routes |

Don't default to Case D because it's the most complete — it's also the most machinery, and Step 4c's checklist doesn't ask for a settings page or an entity page unless the request needs one. Undersized is easy to notice and fix; oversized (a router and three page types for a request that named one) is the kind of thing that ships unnoticed. If unsure between B and D, re-read the prompt for "settings," "configure," "preferences" — their absence means B, not D.

## File layout

```
src/extensions/dashboard/pages/{feature}/
  {feature}.extension.ts        # single wix generate scaffold — always exactly one route registered here
  {feature}.tsx                 # entry — see "1. Entry" for the router vs. no-router version
  {Feature}App.tsx              # Case B/D only — provider + router + routes; Case A/C skip this file
  {Feature}CollectionPage.tsx   # Case A, B, D
  {Feature}EntityPage.tsx       # Case B, D only
  {Feature}SettingsPage.tsx     # Case C, D only
  {feature}-api.ts              # fetch/save calls — keep these out of the components
```

Scaffold with a single call regardless of case — this is always one extension:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

## 1. Entry — router-free (Case A, C) vs. router (Case B, D)

**Case A or C — no router, no location plumbing.** The page component renders the shell directly:

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

**Case B or D — router in use, `location` is manual in a Wix CLI app.** `PatternsReactRouter` reads the page location through `container.usePageLocation()`, which only `withDashboard`'s `location` prop feeds — nothing supplies it automatically in a Wix CLI app the way Yoshi BM flow does:

```tsx
// {feature}.tsx — Case B or D
import { useEffect, useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import { WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { {Feature}App } from './{Feature}App';

type PageLocation = Parameters<Parameters<typeof dashboard.observeState>[0]>[1]['pageLocation'];

const Page: FC = () => {
  const [location, setLocation] = useState<PageLocation | undefined>();

  useEffect(() => {
    const subscription = dashboard.observeState((_pageParams, environment) => {
      setLocation(environment.pageLocation);
    });
    return () => subscription.disconnect();
  }, []);

  return (
    <WixDesignSystemProvider>
      {location ? <{Feature}App location={location} /> : null}
    </WixDesignSystemProvider>
  );
};

export default Page;
```

**Skipping the location plumbing when it's actually needed (Case B/D) is a runtime-only failure.** Per `PatternsReactRouter`'s own docs: "Nothing catches this before runtime — type checking and bundling both pass, because neither renders the page." `tsc` and `wix build` will not catch a missing `location` — only opening the page in a browser will. This is exactly why [Step 5's Preview](../../SKILL.md#validation) is not optional once a case uses the router. Conversely, adding this plumbing to Case A or C is dead code — there's no router below it to consume `location`.

## 2. App shell — Case B and D only

Case A and C have no separate app-shell file; their entry file **is** the shell (see Section 1). This file exists only when there's more than one page type behind one extension:

```tsx
// {Feature}App.tsx — Case B or D
import { withDashboard } from '@wix/patterns';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { PatternsReactRouter, PatternsReactRoute } from '@wix/patterns/router';
import { {Feature}CollectionPage } from './{Feature}CollectionPage';
import { {Feature}EntityPage } from './{Feature}EntityPage';
// Case D only:
import { {Feature}SettingsPage } from './{Feature}SettingsPage';

export const {Feature}App = withDashboard(() => (
  <WixPatternsProvider>
    <PatternsReactRouter>
      <PatternsReactRoute type="collection" path="/" element={<{Feature}CollectionPage />} />
      <PatternsReactRoute type="editEntity" path="/:id" element={<{Feature}EntityPage />} />
      <PatternsReactRoute type="createEntity" path="/new" element={<{Feature}EntityPage />} />
      {/* Case D only: */}
      <PatternsReactRoute type="other" path="/settings" element={<{Feature}SettingsPage />} />
    </PatternsReactRouter>
  </WixPatternsProvider>
));
```

`PatternsReactRoute`'s `type` is one of exactly `"collection" | "createEntity" | "editEntity" | "other"` — there's no dedicated settings value, so a settings route is `"other"`. Case B: delete the `/settings` route and the import above it — nothing else changes.

## 3. Collection page — Case A, B, D

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
              // One column per field the prompt names. Verify each source field per
              // COLLECTION_TOOLKIT.md's "A column must show what its header promises" —
              // don't assume a generic-looking field is the specific one the header claims.
              { id: 'name', title: 'Name', render: (item) => item.name },
            ]}
          />
        </CollectionPage.Content>
      </CollectionPage>

      {/* SidePanel has no built-in open/close state or overlay portal — position and animate it
          yourself. This is the minimal version; see the wix-design-system skill's SidePanel
          "Quick view" example for the push-vs-overlay animation treatment. */}
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

## 4. Entity page — Case B, D only

One component for both `/new` and `/:id`. Full call details (both generics, what `onSave` receives, the `UseEntityPageParams` pick list) are in [ENTITY_PAGE_TOOLKIT.md](ENTITY_PAGE_TOOLKIT.md) — read it before filling in fields. The part specific to this router-based shape:

```tsx
// {Feature}EntityPage.tsx — Case B or D (sketch — see ENTITY_PAGE_TOOLKIT.md for the full call)
import { useParams } from 'react-router-dom'; // NOT @wix/patterns/router — PatternsReactRoute wraps react-router-dom's Route, but only exports PatternsReactRoute/PatternsReactRouter/usePatternsNavigate itself
import { useEntityPage, EntityPage } from '@wix/patterns';
import { useForm } from '@wix/patterns/form';
import { fetch{Entity}, save{Entity} } from './{feature}-api';

export const {Feature}EntityPage = () => {
  const { id } = useParams<{ id?: string }>();
  const form = useForm<{Entity}FormFields>();

  const state = useEntityPage<{Entity}, {Entity}FormFields>({
    parentPath: '/', // NOT parentPageId — this shape always uses Patterns Router
    isNewEntity: () => !id, // a getter: the route can change (/new -> /:id after save) while this stays mounted
    form,
    fetch: () => (id ? fetch{Entity}(id).then((entity) => ({ entity })) : Promise.resolve({ entity: undefined })),
    onSave: ({ widgetsFormData }) =>
      save{Entity}({ id, ...form.getValues(), ...widgetsFormData }).then((updatedEntity) => ({ updatedEntity })),
  });

  return (
    <EntityPage state={state}>
      <EntityPage.Header title={{ text: id ? 'Edit {Entity}' : 'New {Entity}' }} />
      <EntityPage.Content>
        <EntityPage.MainContent>{/* form cards — see ENTITY_PAGE_TOOLKIT.md */}</EntityPage.MainContent>
      </EntityPage.Content>
    </EntityPage>
  );
};
```

`useEntityPage`'s own docs are explicit about both details above: `parentPath` "Must be passed if using Patterns Router" (`parentPageId` is the non-router alternative — irrelevant here, since Case B/D always uses the router), and `isNewEntity` should be "a getter when the route can change while the page stays mounted" — exactly this component's case, since a successful create typically navigates `/new` → `/:newId`.

## 5. Settings page — Case C, D

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

`useSettingsPage`'s params are all required except `saveSuccessToast`/`saveErrorToast`: `form`, `fetch`, `onSave`, `onCancel`. There is no `parentPath`/`parentPageId` — a settings page isn't reached by drilling into a row, so it carries no back-navigation contract, and Case C needs no router at all to reach it (Section 1's router-free entry renders it directly).

## What to change vs. keep, per case

| Change per request | Keep as shown |
| --- | --- |
| Feature/entity names, fields, columns, API calls in `{feature}-api.ts` | Provider outside router, router outside the page components (Case B/D) |
| Which case (A/B/C/D) — don't build D's router and three page types for a request that only named a list | `parentPath` (not `parentPageId`) on `useEntityPage` — Case B/D always uses the router |
| Summary metrics, quick-view fields, form field types | The `location` plumbing in Case B/D's entry file — and its *absence* in Case A/C's |
| Real data source (SDK-first per [SDK-First Rule](../../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)) vs CMS | `SidePanel`'s manual positioning — it has no built-in open state, in every case that uses it |
