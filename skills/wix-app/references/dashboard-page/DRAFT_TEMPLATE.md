# Draft Template — Collection + Entity + Settings in one extension

A verified starting skeleton for the shape most "admin page for X" requests actually need: a list, a way to create/edit one record, and an app-config area — all reachable from one Wix CLI dashboard-page extension via `PatternsReactRouter`. Start here, then swap names, fields, and API calls for the request; keep the wiring, and delete whichever page type the request doesn't need.

**Use this only when the request needs more than one `@wix/patterns` page type behind one route.** A request for just a table, or just a settings form, is one of the single-page examples in [DASHBOARD_PAGE.md](../DASHBOARD_PAGE.md) — don't add router/EntityPage/SettingsPage machinery it doesn't need.

Every snippet below is copied from the installed `dist/docs/*.md` this session read, not written from memory — confirm props against your own installed version the same way before you deviate from the shape shown here.

## File layout (one `wix generate --params` scaffold, one route)

```
src/extensions/dashboard/pages/{feature}/
  {feature}.extension.ts        # routePath: "{feature}" — the ONLY CLI-registered route; everything else is client-side
  {feature}.tsx                 # entry: location plumbing, WixDesignSystemProvider
  {Feature}App.tsx              # withDashboard + WixPatternsProvider + PatternsReactRouter + the 4 routes
  {Feature}CollectionPage.tsx   # "/" — Table + SummaryBar + SidePanel quick view + EntityPage full edit
  {Feature}EntityPage.tsx       # "/:id" and "/new" — one component, isNewEntity tells them apart
  {Feature}SettingsPage.tsx     # "/settings"
  {feature}-api.ts              # fetch/save calls — keep these out of the components
```

Scaffold with a single call — this is one extension, not three:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

## 1. Entry — location is manual in a Wix CLI app, and only because the router needs it

`PatternsReactRouter` reads the page location through `container.usePageLocation()`, which only `withDashboard`'s `location` prop feeds. Skip this file entirely for a single-page-no-router extension — the plain example in [WIX_PATTERNS_DOCS.md](../WIX_PATTERNS_DOCS.md#library-architecture) needs none of it. Here, because the router is in use, it's required:

```tsx
// {feature}.tsx
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

**Skipping this is a runtime-only failure.** Per `PatternsReactRouter`'s own docs: "Nothing catches this before runtime — type checking and bundling both pass, because neither renders the page." `tsc` and `wix build` will not catch a missing `location` — only opening the page in a browser will. This is exactly why [Step 5's Preview](../../SKILL.md#validation) is not optional for a routed dashboard page.

## 2. App shell — provider, router, four routes

```tsx
// {Feature}App.tsx
import { withDashboard } from '@wix/patterns';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { PatternsReactRouter, PatternsReactRoute } from '@wix/patterns/router';
import { {Feature}CollectionPage } from './{Feature}CollectionPage';
import { {Feature}EntityPage } from './{Feature}EntityPage';
import { {Feature}SettingsPage } from './{Feature}SettingsPage';

export const {Feature}App = withDashboard(() => (
  <WixPatternsProvider>
    <PatternsReactRouter>
      <PatternsReactRoute type="collection" path="/" element={<{Feature}CollectionPage />} />
      <PatternsReactRoute type="editEntity" path="/:id" element={<{Feature}EntityPage />} />
      <PatternsReactRoute type="createEntity" path="/new" element={<{Feature}EntityPage />} />
      <PatternsReactRoute type="other" path="/settings" element={<{Feature}SettingsPage />} />
    </PatternsReactRouter>
  </WixPatternsProvider>
));
```

`PatternsReactRoute`'s `type` is one of exactly `"collection" | "createEntity" | "editEntity" | "other"` — there's no dedicated settings value, so a settings route is `"other"`. Drop the `/new` and `/settings` routes (and the components they point to) if the request doesn't need them.

## 3. Collection page — the file Step 4c's checklist is actually about

This is where the [UX Completeness Self-Audit](../../SKILL.md#step-4c-ux-completeness-self-audit) gets checked: `SummaryBar` for the aggregate, and two drill-in tiers — `SidePanel` for a quick glance that keeps the table visible, `navigateToEntityPage` for the full record.

```tsx
// {Feature}CollectionPage.tsx
import { useState, type FC } from 'react';
import { Table, SummaryBar, useTableCollection, type SummaryData } from '@wix/patterns';
import { CollectionPage } from '@wix/patterns/page';
import { usePatternsNavigate } from '@wix/patterns/router';
import { Box, Button, SidePanel, Text } from '@wix/design-system';
import { fetch{Feature}Page, type {Entity}Row } from './{feature}-api';

export const {Feature}CollectionPage: FC = () => {
  const [quickViewItem, setQuickViewItem] = useState<{Entity}Row | null>(null);
  const { navigateToEntityPage } = usePatternsNavigate();

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
        <Box
          style={{ position: 'fixed', top: 0, right: 0, height: '100%', zIndex: 1000 }}
        >
          <SidePanel onCloseButtonClick={() => setQuickViewItem(null)}>
            <SidePanel.Header title={quickViewItem.name} showDivider />
            <SidePanel.Content>
              <Text>{/* read-only glance fields — not the full form */}</Text>
            </SidePanel.Content>
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

## 4. Entity page — one component for both `/new` and `/:id`

Full call details (both generics, what `onSave` receives, the `UseEntityPageParams` pick list) are in [ENTITY_PAGE_TOOLKIT.md](ENTITY_PAGE_TOOLKIT.md) — read it before filling in fields. The part specific to this combined shape:

```tsx
// {Feature}EntityPage.tsx (sketch — see ENTITY_PAGE_TOOLKIT.md for the full call)
import { useParams } from 'react-router-dom'; // NOT @wix/patterns/router — PatternsReactRoute wraps react-router-dom's Route, but only exports PatternsReactRoute/PatternsReactRouter/usePatternsNavigate itself
import { useEntityPage, EntityPage } from '@wix/patterns';
import { useForm } from '@wix/patterns/form';
import { fetch{Entity}, save{Entity} } from './{feature}-api';

export const {Feature}EntityPage = () => {
  const { id } = useParams<{ id?: string }>();
  const form = useForm<{Entity}FormFields>();

  const state = useEntityPage<{Entity}, {Entity}FormFields>({
    parentPath: '/', // NOT parentPageId — this extension uses Patterns Router
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

`useEntityPage`'s own docs are explicit about both details above: `parentPath` "Must be passed if using Patterns Router" (`parentPageId` is the non-router alternative), and `isNewEntity` should be "a getter when the route can change while the page stays mounted" — exactly this component's case, since a successful create typically navigates `/new` → `/:newId`.

## 5. Settings page — app-wide config, no collection

No dedicated toolkit file exists for this yet (unlike Entity/Collection) — the shape, verified against `useSettingsPage.md`:

```tsx
// {Feature}SettingsPage.tsx
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

`useSettingsPage`'s params are all required except `saveSuccessToast`/`saveErrorToast`: `form`, `fetch`, `onSave`, `onCancel`. There is no `parentPath`/`parentPageId` — a settings page isn't reached by drilling into a row, so it carries no back-navigation contract.

## What to change vs. keep

| Change per request | Keep as shown |
| --- | --- |
| Feature/entity names, fields, columns, API calls in `{feature}-api.ts` | The provider/router nesting order (provider outside router, router outside the page components) |
| Which of the 4 routes exist — drop `/new`, `/settings`, or the whole entity/settings pair if unneeded | `parentPath` (not `parentPageId`) on `useEntityPage`, since this shape uses the router |
| Summary metrics, quick-view fields, form field types | The `location` plumbing in the entry file — required by the router regardless of what's inside it |
| Real data source (SDK-first per [SDK-First Rule](../../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)) vs CMS | `SidePanel`'s manual positioning — it has no built-in open state |
