# Draft Template — CMS-backed collection and entity (schema-driven)

> Cairo has **two** ways to put data behind a dashboard page, and they are not variations of one
> pattern — they are different templates. This file is the second one. Pick between them before you
> write a line, because converting later means rewriting both the collection page and the entity page.

## Which of the two do you want?

| | **Hand-wired** — [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md) | **Schema-driven** — this file |
| --- | --- | --- |
| Use when | The rows come from a **vertical SDK** (`@wix/bookings`, `@wix/ecom`, …) or any API you call yourself | The rows are a **CMS collection** — one your Data Collection extension ships, or an existing site collection |
| You write | `fetchData`, every filter, every column | A `SchemaSource`. The schema supplies fetch, filters, columns and form fields |
| `columns` | One entry per field you name | `columns={[]}` — the schema renders them |
| Entity form | `useController` + WDS per field | `<EntityPageFields />` renders the whole form |
| Extra dependency | none | `npm install @wix/patterns-cms` |

**The tell is where the field list lives.** If the page's columns are decided by a schema the CMS
owns, the schema-driven path already knows them and hand-writing them throws that away — including
the add/edit-field UI and the field types. If you're mapping a bookings row into columns you chose,
the schema-driven path has nothing to read and the hand-wired one is right.

Mixing them is the failure this file exists to prevent: a CMS collection wired the hand-written way
compiles, runs, and silently loses schema-driven columns, field management and the generated form.

## None of these names are in the docs bundle index

`createCmsSchemaSource`, `tableSchemaSource`, `EntityPageFields`, `useEntity` and
`useWixPatternsContainer` are all exported and usable, and **none appear in
`dist/dts-bundle/index.json`**. Looking them up there and concluding they don't exist is how this
whole path gets missed — check `dist/types/index.d.ts`, which is what `tsc` resolves. See
[PATTERNS_BUNDLE_READING.md](PATTERNS_BUNDLE_READING.md#what-the-bundle-leaves-out).

## 1. The schema source

One source backs both pages. Build it once per page with `useMemo` — rebuilding it re-loads the
schema on every render.

```tsx
import { useWixPatternsContainer } from '@wix/patterns';
import { createCmsSchemaSource } from '@wix/patterns-cms';

// A CMS row always has _id; every other field comes from the schema.
interface CmsItem extends Record<string, unknown> {
  _id: string;
}

const { httpClient } = useWixPatternsContainer();

const source = useMemo(
  () => createCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID, httpClient }),
  [httpClient],
);
```

`COLLECTION_ID` is the full scoped id — `<app-namespace>/<idSuffix>` for a collection your extension
ships. See [DATA_COLLECTION.md](../DATA_COLLECTION.md).

**In a Wix CLI app the httpClient comes from `useWixPatternsContainer()`.** Cairo's own examples use
`useHttpClient` from `@wix/yoshi-flow-bm`, which does not exist here — copying that import is a
compile error. The schema itself loads through `@wix/data`; `httpClient` is only used for the
optional extras below.

**Leave `includeUserPermissions` off unless you need field management.** It fetches ABAC permissions
and needs a `metasiteId` you would have to plumb in; without it the flag is a wasted round trip that
silently does nothing.

## 2. Collection page

```tsx
import { CollectionPage } from '@wix/patterns/page';
import { PrimaryActions, Table, tableSchemaSource, useTableCollection } from '@wix/patterns';
import { usePatternsNavigate } from '@wix/patterns/router';

export const {Feature}CollectionPage: FC = () => {
  const { httpClient } = useWixPatternsContainer();
  const { navigateToEntityPage } = usePatternsNavigate<CmsItem>();

  const schemaSource = useMemo(
    () => tableSchemaSource(createCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID, httpClient })),
    [httpClient],
  );

  // No fetchData, no filters, no itemKey/itemName — collectionConfig carries all of it.
  const state = useTableCollection<CmsItem>({
    ...schemaSource.collectionConfig,
    persistQueryToUrl: true,
  });

  return (
    <CollectionPage>
      <CollectionPage.Header
        title={{ text: '{Page Title}' }}
        primaryAction={
          <PrimaryActions label="Create new" onClick={() => navigateToEntityPage({ path: '/new', entity: null })} />
        }
      />
      <CollectionPage.Content>
        <Table
          horizontalScroll
          state={state}
          fieldsSource={schemaSource}
          onRowClick={(item) => navigateToEntityPage({ path: `/${item._id}`, entity: item })}
          columns={[]}   {/* the schema renders the columns */}
        />
      </CollectionPage.Content>
    </CollectionPage>
  );
};
```

`tableSchemaSource()` wraps the source so the table and any import/field-management UI read the same
live schema. Spread `collectionConfig` **first** so your own options can still override it.

The aggregate rule from [COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md) is unchanged here: add a
`SummaryBar` only when the page answers a "how many / how much" question its rows don't.

## 3. Entity page — the same source drives the form

```tsx
import { EntityPage, EntityPageFields, useEntity, useEntityPage, type EntityPageState } from '@wix/patterns';
import { useForm } from '@wix/patterns/form';
import { Card } from '@wix/design-system';
import { useParams } from 'react-router-dom';

type CmsFormFields = Record<string, unknown>;

export const {Feature}EntityPage: FC = () => {
  const { id } = useParams<{ id?: string }>();
  const { httpClient } = useWixPatternsContainer();
  const source = useMemo(
    () => createCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID, httpClient }),
    [httpClient],
  );

  const form = useForm<CmsFormFields>();
  const state: EntityPageState<CmsItem, CmsFormFields> = useEntityPage<CmsItem, CmsFormFields>({
    parentPath: '/',
    form,
    schemaSource: source,
    // Reads and writes go through the source's backend — no data-access wiring of your own.
    fetch: async () => {
      if (!id) return { entity: undefined };
      const { backend } = await source.loadSchema();
      return { entity: await backend.get(id) };
    },
    onSave: async () => {
      const { backend } = await source.loadSchema();
      const values = form.getValues() as Partial<CmsItem>;
      const updatedEntity = state.entity
        ? await backend.update({ ...state.entity, ...values } as CmsItem)
        : await backend.create(values);
      return { updatedEntity };
    },
    saveSuccessToast: 'Saved',
    saveErrorToast: () => 'Failed to save',
  });

  const entity = useEntity(state);
  const displayField = state.schema?.displayField;
  const title = (displayField && (entity?.[displayField] as string)) || 'New {Entity}';

  return (
    <EntityPage state={state}>
      <EntityPage.Header title={{ text: title }} />
      <EntityPage.Content>
        <EntityPage.MainContent>
          {/* EntityPage.Card extends WDS CardProps — no `title` prop; the heading is content. */}
          <EntityPage.Card minHeight="204px">
            <Card.Header title="Fields" />
            <Card.Divider />
            <Card.Content>
              <EntityPageFields />
            </Card.Content>
          </EntityPage.Card>
        </EntityPage.MainContent>
      </EntityPage.Content>
    </EntityPage>
  );
};
```

`<EntityPageFields />` renders every schema field with the right control and validation. Reach for
hand-written `useController` + WDS fields only for something the schema genuinely cannot express —
and then keep them alongside it, not instead of it.

## 4. Routing

Identical to the hand-wired case: this is Case B, so the entry file, app shell and routes come from
[DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) unchanged, including the manual `location`
plumbing that `tsc` and `wix build` cannot catch.

## What still applies from the hand-wired template

The parts that aren't about where the data comes from carry over unchanged: MobX and `useSelector`
([TABLE_STATE.md](TABLE_STATE.md)), `errorState` on every table, the drill-in requirement, and the
release-and-update steps a Data Collection needs before the collection exists at all
([DATA_COLLECTION.md](../DATA_COLLECTION.md#the-extension-does-not-create-the-collection)).
