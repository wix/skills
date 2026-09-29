# Draft Template — Cases A, B and D (router-wired)

**Applies to [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md)'s Cases A, B and D.** All three need `PatternsReactRouter`, because in all three a row opens a page of its own — a panel is not the drill-in ([UX_SUCCESS_MODEL.md](UX_SUCCESS_MODEL.md)). Case A's detail route is read-only (§4); B and D route to a full `EntityPage`. The collection and settings components live in [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md); this file covers only what a router adds — the entry file, the app shell, and the detail/entity page.

Every snippet below is copied from the installed `dist/docs/*.md` this session read, not from memory.

## 1. Entry — `location` is manual in a Wix CLI app, and only because the router needs it

`PatternsReactRouter` reads the page location through `container.usePageLocation()`, which only `withDashboard`'s `location` prop feeds — nothing supplies it automatically in a Wix CLI app the way Yoshi BM flow does:

```tsx
// {feature}.tsx — Case A, B or D
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

**Skipping this is a runtime-only failure.** Per `PatternsReactRouter`'s own docs: "Nothing catches this before runtime — type checking and bundling both pass, because neither renders the page." `tsc` and `wix build` will not catch a missing `location` — only opening the page in a browser will. This is exactly why [Step 5's Preview](../../SKILL.md#validation) is not optional for Case B/D.

## 2. App shell — provider, router, routes

```tsx
// {Feature}App.tsx — Case A, B or D
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
      {/* Case B/D — editable record. Case A registers this ONE route instead, with
          {Feature}DetailPage as the element and no /new route (§4). Either way the
          type is `editEntity`: it wires back-navigation to the collection. */}
      <PatternsReactRoute type="editEntity" path="/:id" element={<{Feature}EntityPage />} />
      {/* Case B/D only — Case A has nothing to create: */}
      <PatternsReactRoute type="createEntity" path="/new" element={<{Feature}EntityPage />} />
      {/* Case D only: */}
      <PatternsReactRoute type="other" path="/settings" element={<{Feature}SettingsPage />} />
    </PatternsReactRouter>
  </WixPatternsProvider>
));
```

`PatternsReactRoute`'s `type` is one of exactly `"collection" | "createEntity" | "editEntity" | "other"` — no dedicated settings value, so a settings route is `"other"`. Case B: delete the `/settings` route and the import above it — nothing else changes.

`{Feature}CollectionPage` is [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md)'s component, unchanged; `{Feature}SettingsPage` (Case D) is [DRAFT_TEMPLATE_SETTINGS.md](DRAFT_TEMPLATE_SETTINGS.md).

## 2b. The collection side of the handoff

The router file above registers `/new`; something has to navigate there. All three of these live on
the collection page, and `usePatternsNavigate` comes from **`@wix/patterns/router`** — not the root
export, which is where it is easy to reach for it:

```tsx
import { PrimaryPageButton } from '@wix/patterns';
import { usePatternsNavigate } from '@wix/patterns/router';

const { navigateToEntityPage } = usePatternsNavigate<{Entity}>();
const openNew = () => navigateToEntityPage({ path: '/new' }); // no record yet — omit `entity`

// CollectionPage.Header — primaryAction takes an ELEMENT, not a { text, onClick } config:
<CollectionPage.Header
  title={{ text: '{Page Title}' }}
  primaryAction={<PrimaryPageButton text="Add {entity}" onClick={openNew} />}
/>

// the empty state should offer the same action, and this one IS a config object:
<CollectionEmptyState title="No {feature} yet" addNewCta={{ text: 'Add {entity}', onClick: openNew }} />

// and a row opens the edit route:
onRowClick={(item) => navigateToEntityPage({ path: `/${item.id}`, entity: item })}
```

The two shapes differ on purpose — `primaryAction` is an element, `addNewCta` is `{ text, onClick }`.
Guessing either costs a compile round.

## 3. Entity page — one component for both `/new` and `/:id`

Full call details (both generics, what `onSave` receives, the `UseEntityPageParams` pick list) are in `<pkgRoot>/dist/docs/useEntityPage.md` — read it before filling in fields. The part specific to this router-based shape:

```tsx
// {Feature}EntityPage.tsx — Case B or D (sketch — see dist/docs/useEntityPage.md for the full call)
import { useParams } from 'react-router-dom'; // NOT @wix/patterns/router — PatternsReactRoute wraps react-router-dom's Route, but only exports PatternsReactRoute/PatternsReactRouter/usePatternsNavigate itself
import { useEntityPage, EntityPage } from '@wix/patterns';
import { useForm } from '@wix/patterns/form';
import { fetch{Entity}, save{Entity}, type {Entity} } from './{feature}-api';

// The form's shape is yours to declare, and need not match the saved entity type.
type {Entity}FormFields = { name: string };

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
        <EntityPage.MainContent>{/* form cards — see dist/docs/EntityPage.md */}</EntityPage.MainContent>
      </EntityPage.Content>
    </EntityPage>
  );
};
```

`useEntityPage`'s own docs are explicit about both details above: `parentPath` "Must be passed if using Patterns Router" (`parentPageId` is the non-router alternative — irrelevant here, since Case B/D always uses the router), and `isNewEntity` should be "a getter when the route can change while the page stays mounted" — exactly this component's case, since a successful create typically navigates `/new` → `/:newId`.

**`UseEntityPageParams` is a `Pick<>`, so a param missing from it is a compile error, not an ignored prop.** `isNewEntity` is in that list at 1.470.0 and absent before ~1.46x. If it doesn't compile, read the pick list in your installed `dist/types/hooks/useEntityPage.d.ts` and upgrade — deleting the line makes a create route behave as an edit.

## 4. Read-only detail route — Case A

A display-only collection still routes its rows to a page — but not an `EntityPage`, which has no
read-only mode and still has none at **1.471.0**: `fetch` and `onSave` are both required, and
`actionsBarConfig` (`saveCta.text`, `cancelCta`) can retext Save but not remove it. It would ship
two buttons that either do nothing or save a form nobody was offered.

Use a WDS `Page` — what Cairo does itself: `example-bm`'s `DataExtensionEntityViewPage` and
auto-patterns' `ViewModeEntityPage` are both plain WDS `Page`s, the latter unexported.

```tsx
// {Feature}DetailPage.tsx — Case A
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Loader, Page, Text } from '@wix/design-system';
import { usePatternsNavigate } from '@wix/patterns/router';
import { fetch{Entity}, type {Entity} } from './{feature}-api';

export const {Feature}DetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { navigateToCollectionPage } = usePatternsNavigate();
  const [entity, setEntity] = useState<{Entity} | undefined>();

  useEffect(() => {
    if (id) {
      fetch{Entity}(id).then(setEntity);
    }
  }, [id]);

  return (
    <Page>
      {/* The way back is the header's back button — a read-only page has no Cancel. */}
      <Page.Header
        title={entity?.name ?? '{Entity}'}
        showBackButton
        onBackClicked={() => navigateToCollectionPage({ path: '/' })}
      />
      <Page.Content>
        {entity ? (
          <Card>
            <Card.Header title="Details" />
            <Card.Divider />
            <Card.Content>
              <Text>{entity.name}</Text>
            </Card.Content>
          </Card>
        ) : (
          <Loader />
        )}
      </Page.Content>
    </Page>
  );
};
```

If the request later grows an edit form this becomes §3's `EntityPage`, route type and `onRowClick`
unchanged — which is why Case A registers `editEntity`, not `other`.
