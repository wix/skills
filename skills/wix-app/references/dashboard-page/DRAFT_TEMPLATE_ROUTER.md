# Draft Template — Case B and D (router-wired)

**Applies only to [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md)'s Case B (Collection + Entity) and Case D (Collection + Entity + Settings)** — both need `PatternsReactRouter` because they route between more than one `@wix/patterns` page type behind a single extension. The Collection page and Settings page components themselves are in [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) — this file covers only what's different when a router sits above them: the entry file, the app shell, and the Entity page.

Every snippet below is copied from the installed `dist/docs/*.md` this session read, not written from memory.

## 1. Entry — `location` is manual in a Wix CLI app, and only because the router needs it

`PatternsReactRouter` reads the page location through `container.usePageLocation()`, which only `withDashboard`'s `location` prop feeds — nothing supplies it automatically in a Wix CLI app the way Yoshi BM flow does:

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

**Skipping this is a runtime-only failure.** Per `PatternsReactRouter`'s own docs: "Nothing catches this before runtime — type checking and bundling both pass, because neither renders the page." `tsc` and `wix build` will not catch a missing `location` — only opening the page in a browser will. This is exactly why [Step 5's Preview](../../SKILL.md#validation) is not optional for Case B/D.

## 2. App shell — provider, router, routes

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

`PatternsReactRoute`'s `type` is one of exactly `"collection" | "createEntity" | "editEntity" | "other"` — no dedicated settings value, so a settings route is `"other"`. Case B: delete the `/settings` route and the import above it — nothing else changes.

`{Feature}CollectionPage` here is the same component shown in [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md) — include the `usePatternsNavigate`/"Open full record" parts marked Case B/D there. `{Feature}SettingsPage` (Case D) is [DRAFT_TEMPLATE_SETTINGS.md](DRAFT_TEMPLATE_SETTINGS.md), unchanged.

## 3. Entity page — one component for both `/new` and `/:id`

Full call details (both generics, what `onSave` receives, the `UseEntityPageParams` pick list) are in [ENTITY_PAGE_TOOLKIT.md](ENTITY_PAGE_TOOLKIT.md) — read it before filling in fields. The part specific to this router-based shape:

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
