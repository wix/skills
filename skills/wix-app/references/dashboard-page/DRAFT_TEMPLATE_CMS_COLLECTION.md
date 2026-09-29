# Draft Template — CMS-backed collection and entity (schema-driven)

> The schema-driven one of the two data paths;
> [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md#then-which-data-path) chooses. Converting later rewrites
> both pages, so settle it first.

**The tell is where the field list lives.** Columns a CMS schema owns belong here; hand-writing them
throws away the add/edit-field UI and the field types. Columns you chose from a bookings row give
the schema nothing to read, so [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md) is
right. A CMS collection wired by hand compiles, runs, and silently loses schema-driven columns,
field management and the generated form.

**The prompt's fields are the collection's fields.** Every schema field is a column, so a prompt
listing what a row holds is the field list for the collection you create — not a subset to pick
([DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md#then-which-data-path)).

You write a `SchemaSource` and no field columns; `<EntityPageFieldsCard />` renders the whole form.
The cost is one dependency — `@wix/patterns-cms`, plus `@wix/patterns` at the **exact** version it
pins.

## Take the `@wix/patterns/schema` entry of each name

`Table`, `useTableCollection`, `EntityPage` and `useEntityPage` exist twice, and the key's own
`importPath` is `@wix/patterns` — the **root, hand-wired** version, whose signature cannot read a
schema. Taking it is worse than a miss: nothing says you're on the wrong path.

`dist/dts-bundle/index.txt` lists each of the four on two lines; use the one whose `importPath` is
`@wix/patterns/schema`. In `index.json` that entry is the key's `variants` item, with its own
`file`; in `dist/docs/index.json`, `useSchemaSource` carries `EntityPageFieldsCard` among its
`symbols`. `useCmsSchemaSource` is in another package.

**No `@wix/patterns/schema` line** means an older build than the variants: resolve these names
from **`dist/types/exports/schema.d.ts`** instead — the root `dist/types/index.d.ts` does not
re-export them ([WIX_PATTERNS_DOCS.md § 5](../WIX_PATTERNS_DOCS.md#5--traps-that-make-a-read-wrong)).

## 1. The schema source

One source backs both pages, and it is a **hook** — no httpClient, no `useMemo`:

```tsx
import { useCmsSchemaSource } from '@wix/patterns-cms';

// A CMS row always has _id; every other field comes from the schema.
interface CmsItem extends Record<string, unknown> {
  _id: string;
}

const source = useCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID });
```

Call it on **both** pages — each builds its own from the same `collectionId`, as `example-bm`'s
`CmsEntitiesTable` and `CmsSourceEntityPage` do. A hook, not a prop to thread.

`COLLECTION_ID` is the full scoped id — `<app-namespace>/<idSuffix>` for a collection your extension
ships ([DATA_COLLECTION.md](../DATA_COLLECTION.md)).

**`httpClient` defaults to the patterns container's client**, so a Wix CLI app passes nothing.
`includeUserPermissions` fetches ABAC permissions for field management and needs a `metasiteId`;
leave it off unless you want that UI.

**Install both, and match the pin — a floor is not enough.** `@wix/patterns-cms` depends on an
**exact** `@wix/patterns` version (no caret). Install that exact version, or npm keeps a second copy
and the two halves of the page land on different React contexts. Never hardcode the pair — read it
off the installed package, then confirm one copy survives: a second line is a bug `tsc` and
`wix build` both pass. (`@wix/patterns-fields` is pinned too, but it is `patterns-cms`'s own
dependency — let npm pull it in.)

```bash
npm install @wix/patterns-cms
npm install @wix/patterns@$(node -p "require('@wix/patterns-cms/package.json').dependencies['@wix/patterns']")
npm dedupe
find node_modules -path '*@wix/patterns/package.json' -not -path '*/dist/*'
```

## 2. Collection page

Import the collection hook and `Table` from **`@wix/patterns/schema`** — see above.

```tsx
import { CollectionPage } from '@wix/patterns/page';
import { PrimaryActions } from '@wix/patterns';
import { Table, useTableCollection } from '@wix/patterns/schema';
import { usePatternsNavigate } from '@wix/patterns/router';
import { useCmsSchemaSource } from '@wix/patterns-cms';

export const FeatureCollectionPage: FC<{ onAddItem: () => void }> = ({ onAddItem }) => {
  const { navigateToEntityPage } = usePatternsNavigate<CmsItem>();
  const source = useCmsSchemaSource<CmsItem>({ collectionId: COLLECTION_ID });

  // The source carries fetch, filters, itemKey and itemName — you write none of them.
  const state = useTableCollection(source, { persistQueryToUrl: true });

  return (
    <CollectionPage>
      <CollectionPage.Header
        title={{ text: 'Page Title' }}
        primaryAction={
          <PrimaryActions label="Add item" onClick={onAddItem} />
        }
      />
      <CollectionPage.Content>
        {/* No `columns` prop: the schema renders one column per field. */}
        <Table
          state={state}
          onRowClick={(item: CmsItem) => navigateToEntityPage({ path: '/' + item._id, entity: item })}
        />
      </CollectionPage.Content>
    </CollectionPage>
  );
};
```

**`onAddItem` opens the create route** — the one navigation with no record to pass:
`navigateToEntityPage({ path: '/new' })`, with `entity` omitted. That omission needs
`@wix/patterns` **≥ 1.464.0**, which the pin in §1 already gives you; on an older install `entity`
is typed required, and passing a placeholder to satisfy it is the bug rather than the fix. Every
other navigation has a record — pass it, as `onRowClick` does above, and the entity header renders
before the fetch resolves.

Two rules carry over unchanged from the hand-wired path, and both are about what is *not* here:
**no `SummaryBar`** unless the request asked for one, and **the row opens a page, never a panel** —
`navigateToEntityPage` to §3's entity page either way; a display-only collection keeps that page and
simply has nothing that writes.

### Search is the source's job, and its scope is the visible columns

You write no search filter: the source ORs `contains` across its searchable fields and `and()`s that
onto the query, so the filters still apply. The scope is `query.columns` — what the table is
showing — falling back to the source's `searchableFieldIds` (default: the display field alone)
before any columns are known. Two consequences, both reported as "search is broken":

- **Only `SHORT_TEXT` and `LONG_TEXT` fields are searched.** A number, date or reference column
  contributes nothing, so a term matching one of those finds no rows.
- **A field that is not a visible column is not searched.** Hiding a column narrows search too.

To pin the scope — search a hidden field, or keep a status column out — override `columns` for the
search fetch only:

```tsx
const SEARCHABLE = ['assetTag', 'equipmentName', 'location'];

const state = useTableCollection(source, {
  persistQueryToUrl: true,
  wrapFetchData: (next) => (query) =>
    next({ ...query, columns: query.search ? SEARCHABLE : query.columns }),
});
```

## 3. Entity page — the same source drives the form

```tsx
import { useEntity } from '@wix/patterns';
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
  const entity = useEntity(state);
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

`entityId: undefined` makes it a create page, so one component serves `/new` and `/:id`. Reach for
`useController` + WDS fields only for what the schema cannot express, alongside
`EntityPageFieldsCard`, not instead of it.

## 4. Routing

Take **only §1 (entry) and §2 (app shell + routes)** from
[DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md): identical for both paths, including the
`location` plumbing `tsc` and `wix build` both miss.

**Do not take that file's §3 or §4.** Its entity page is the *hand-wired* one —
`useEntityPage({ fetch, onSave, isNewEntity })` — which is a different API from the schema-driven
`useEntityPage(source, { entityId, form, parentPath })` in §3 above. Reading "unchanged" to include
the entity page is how a CMS page ends up with the wrong one. Its §4 (the read-only detail
route) is likewise hand-wired Case A, and this path does not need it.

## What still applies from the hand-wired template

What isn't about where the data comes from carries over: MobX and `useSelector`
([TABLE_STATE.md](TABLE_STATE.md)), `errorState` on every table, the drill-in requirement, and the
release a Data Collection needs before the collection exists
([LIFECYCLE.md](../data-collection/LIFECYCLE.md#the-extension-does-not-create-the-collection)).
