# Draft Template — CMS-backed collection and entity (schema-driven)

> Cairo has **two** ways to put data behind a dashboard page, and they are not variations of one
> pattern — they are different templates. This file is the second one. Pick between them before you
> write a line, because converting later means rewriting both the collection page and the entity page.

## Which of the two do you want?

| | **Hand-wired** — [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md) | **Schema-driven** — this file |
| --- | --- | --- |
| Use when | The rows come from a **vertical SDK** (`@wix/bookings`, `@wix/ecom`, …) or any API you call yourself | The rows are a **CMS collection** — one your Data Collection extension ships, or an existing site collection |
| You write | `fetchData`, every filter, every column | A `SchemaSource`. The schema supplies fetch, filters, columns and form fields |
| `columns` | One entry per field you name | no `columns` prop at all — the schema renders them |
| Entity form | `useController` + WDS per field | `<EntityPageFieldsCard />` renders the whole form |
| Extra dependency | none | `@wix/patterns-cms`, plus `@wix/patterns` at the **exact** version it pins |

**The tell is where the field list lives.** If the page's columns are decided by a schema the CMS
owns, the schema-driven path already knows them and hand-writing them throws that away — including
the add/edit-field UI and the field types. If you're mapping a bookings row into columns you chose,
the schema-driven path has nothing to read and the hand-wired one is right.

Mixing them is the failure this file exists to prevent: a CMS collection wired the hand-written way
compiles, runs, and silently loses schema-driven columns, field management and the generated form.

## None of these names are in the docs bundle index

`useCmsSchemaSource`, and the schema-aware `useTableCollection` / `useEntityPage` / `Table` /
`EntityPage` / `EntityPageFieldsCard` behind `@wix/patterns/schema`, are all exported and usable,
and **none appear in `dist/dts-bundle/index.json`**. Looking them up there and concluding they don't exist is how this
whole path gets missed — check `dist/types/index.d.ts`, which is what `tsc` resolves. See
[PATTERNS_BUNDLE_READING.md](PATTERNS_BUNDLE_READING.md#what-the-bundle-leaves-out).

## 1. The schema source

One source backs both pages, and it is a **hook** — no manual httpClient, no `useMemo` plumbing:

```tsx
import { useCmsSchemaSource } from '@wix/patterns-cms';

// A CMS row always has _id; every other field comes from the schema.
interface CmsItem extends Record<string, unknown> {
  _id: string;
}

const source = useCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID });
```

Call it on **both** pages — the collection and the entity page each build their own source from the
same `collectionId`, as `example-bm`'s `SchemaSourceExample` and `CmsSourceEntityPage` do. It is a
hook, not a value to thread through props.

`COLLECTION_ID` is the full scoped id — `<app-namespace>/<idSuffix>` for a collection your extension
ships. See [DATA_COLLECTION.md](../DATA_COLLECTION.md).

**`httpClient` defaults to the patterns container's client**, so a Wix CLI app passes nothing. The
optional `includeUserPermissions` fetches ABAC permissions for field management and needs a
`metasiteId`; leave it off unless you want that UI.

**Install both, and match the pin — a floor is not enough.** `@wix/patterns-cms` depends on an
**exact** `@wix/patterns` version (no caret): `patterns-cms@1.51.0` requires
`@wix/patterns@1.467.0`, precisely that. Install the pinned version, or npm keeps a second copy of
`@wix/patterns` and the two halves of the page end up on different React contexts. Don't hardcode
that pair — the pin moves every release, so read it out of the package you just installed:

```bash
npm install @wix/patterns-cms
npm install @wix/patterns@$(node -p "require('@wix/patterns-cms/package.json').dependencies['@wix/patterns']")
npm dedupe
```

`@wix/patterns-fields` is pinned exactly too, but it is `patterns-cms`'s own dependency and nothing
here imports it — let npm install it and don't add it to `package.json` yourself. Its peers,
`@wix/design-system` and `@wix/essentials`, a Wix CLI app already has.

Then confirm exactly one copy survives — more than one line here is a bug that `tsc` and
`wix build` both pass:

```bash
find node_modules -path '*@wix/patterns/package.json' -not -path '*/dist/*'
```

`@wix/patterns/schema` is where the schema-aware components live.

## 2. Collection page

Import the collection hook and `Table` from **`@wix/patterns/schema`**, not from the root — the
root exports are the hand-wired versions and will not read a schema.

```tsx
import { CollectionPage } from '@wix/patterns/page';
import { PrimaryActions } from '@wix/patterns';
import { Table, useTableCollection } from '@wix/patterns/schema';
import { usePatternsNavigate } from '@wix/patterns/router';
import { useCmsSchemaSource } from '@wix/patterns-cms';

export const FeatureCollectionPage: FC = () => {
  const { navigateToEntityPage } = usePatternsNavigate<CmsItem>();
  const source = useCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID });

  // The source carries fetch, filters, itemKey and itemName — you write none of them.
  const state = useTableCollection(source, { persistQueryToUrl: true });

  return (
    <CollectionPage>
      <CollectionPage.Header
        title={{ text: 'Page Title' }}
        primaryAction={
          <PrimaryActions label="Add item" onClick={() => navigateToEntityPage({ path: '/new' })} />
        }
      />
      <CollectionPage.Content>
        {/* No `columns` prop: the schema renders one column per field. */}
        <Table state={state} onRowClick={(item) => navigateToEntityPage({ path: '/' + item._id })} />
      </CollectionPage.Content>
    </CollectionPage>
  );
};
```

Two rules carry over unchanged from the hand-wired path, and both are about what is *not* here:
**no `SummaryBar`** unless the request asked for one, and **the row opens a page** —
`navigateToEntityPage`, never a `SidePanel`
([COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md#summarybar--only-when-the-request-asked-for-one)).

## 3. Entity page — the same source drives the form

```tsx
import { EntityPage, EntityPageFieldsCard, useEntityPage } from '@wix/patterns/schema';
import { useForm } from '@wix/patterns/form';
import { useCmsSchemaSource } from '@wix/patterns-cms';
import { useParams } from 'react-router-dom';

export const FeatureEntityPage: FC = () => {
  const { id } = useParams<{ id?: string }>();
  const source = useCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID });
  const form = useForm<Record<string, unknown>>();

  // Source first, options second. Reads and writes go through the source's
  // backend, so the page needs no data-access wiring of its own.
  const state = useEntityPage(source, {
    entityId: id,
    form,
    parentPath: '/',
    saveSuccessToast: 'Successfully saved',
    saveErrorToast: () => 'Failed to save',
  });

  // The schema knows which field titles the record: read it rather than hardcoding a field name.
  const entity = useEntity(state); // from '@wix/patterns'
  const displayField = state.schema?.displayField;
  const title = (displayField && (entity?.[displayField] as string)) || 'New item';

  return (
    <EntityPage state={state}>
      <EntityPage.Header title={{ text: title }} />
      <EntityPage.Content>
        <EntityPage.MainContent>
          {/* Renders every schema field with the right control and validation.
              `title` is REQUIRED — see dist/types/schema/EntityPageFieldsCard.d.ts. */}
          <EntityPageFieldsCard title="Details" />
        </EntityPage.MainContent>
      </EntityPage.Content>
    </EntityPage>
  );
};
```

`entityId: undefined` is what makes it a create page, so one component serves `/new` and `/:id`.
Reach for hand-written `useController` + WDS fields only for something the schema genuinely cannot
express, and keep them alongside `EntityPageFieldsCard` rather than instead of it.

## 4. Routing

Take **only §1 (entry) and §2 (app shell + routes)** from
[DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) — those are identical for both data paths,
including the manual `location` plumbing that `tsc` and `wix build` cannot catch.

**Do not take that file's §3 or §4.** Its entity page is the *hand-wired* one —
`useEntityPage({ fetch, onSave, isNewEntity })` — which is a different API from the schema-driven
`useEntityPage(source, { entityId, form, parentPath })` in §3 above. Reading "unchanged" to include
the entity page is how a CMS page ends up with the wrong one. §4 (the read-only detail route) is
likewise for the hand-wired Case A — a display-only CMS collection keeps this file's entity page
and simply has nothing that writes.

## What still applies from the hand-wired template

The parts that aren't about where the data comes from carry over unchanged: MobX and `useSelector`
([TABLE_STATE.md](TABLE_STATE.md)), `errorState` on every table, the drill-in requirement, and the
release-and-update steps a Data Collection needs before the collection exists at all
([DATA_COLLECTION.md](../DATA_COLLECTION.md#the-extension-does-not-create-the-collection)).
