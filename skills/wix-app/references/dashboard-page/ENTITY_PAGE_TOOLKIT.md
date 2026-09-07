# Entity Page Toolkit — calling `useEntityPage`

[COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md) says a row the user cannot open is a defect, and sends you to `EntityPage` + `useEntityPage` to fix it. This file is the call itself.

## The call

```tsx
import { useEntityPage, EntityPage } from '@wix/patterns';
import { useForm } from '@wix/patterns/form';

interface Shift {
  id?: string;
  name?: string;
}

interface ShiftFormFields {
  name?: string;
}

const form = useForm<ShiftFormFields>({ defaultValues: { name: '' } });

const state = useEntityPage<Shift, ShiftFormFields>({
  fetch: () => api.getShift(shiftId).then((entity) => ({ entity })),
  onSave: ({ widgetsFormData }) =>
    api
      .updateShift(shiftId, { ...form.getValues(), ...widgetsFormData })
      .then((updatedEntity) => ({ updatedEntity })),
  form,
  parentPath: '/shifts',
});
```

`EntityPage` and `useEntityPage` are **root** exports. `@wix/patterns/page` holds `CollectionPage` and `WidgetsFormProvider` only, so importing the entity page from there is `TS2305: has no exported member` — the collection page and the entity page do not live in the same place. `Read <pkgRoot>/dist/dts-bundle/exports/page.d.ts` to see what that subpath actually gives you.

## Name both generics

`useEntityPage<T, V extends FieldValues = FieldValues>` takes the entity type **and** the form-values type. `V` does not infer from the `form` argument — it falls back to `FieldValues`, and a `useForm<ShiftFormFields>()` then fails to assign with `Type 'UseFormReturn<ShiftFormFields, …>' is not assignable to type 'UseFormReturn<FieldValues>'`. Naming a single generic only works when the form is untyped.

`useEntityPage<any, ShiftFormFields>` makes that error go away and takes the entity type with it — `state.entity` becomes `any`, and every field access below it stops being checked. Name the entity type.

## `onSave` does not hand you the form values

`OnSaveParams` has exactly one key. `widgetsFormData` carries what the **widget** fields contributed — extended fields, tags — not what the user typed into your own fields. Those come from the form you already own:

```tsx
onSave: ({ widgetsFormData }) => {
  const values = form.getValues();                  // your fields
  const { extendedFields, tags } = widgetsFormData; // widget fields
  …
};
```

Reaching for a `values`-shaped key on the `onSave` argument is the usual first guess, and there isn't one.

## The params are a `Pick`

`UseEntityPageParams` picks a fixed set off `EntityPageStateParams` — `fetch`, `onSave`, `saveSuccessToast`, `saveErrorToast`, `deleteAction`, `transformEntityToCollectionItem`, `isNewEntity` (create vs edit — [Create route](#create-route)), `form`, `parentPageId`, `parentPath`, `parentReferrer`, `schemaSource`. Anything outside that list is an excess-property error on the object literal. `container` is the common guess and is not one of them: the hook calls `useWixPatternsContainer()` itself.

Confirm the shape rather than guessing — the hook's doc has an empty API section, because props tables only exist for components. `Read <pkgRoot>/dist/dts-bundle/index.json`, then `Read` the bundled `.d.ts` for each of `useEntityPage`, `UseEntityPageParams`, and `OnSaveParams` at exactly the `file` path the index gives.

## Create route

The example above is edit-only. "Add new" is an `EntityPage` too, and it is not the same call with the id left out — four pieces differ, each one covering a distinct failure.

**Register it as its own route, typed `createEntity`.** One component can serve both entity routes; the route is what tells them apart.

```tsx
<PatternsReactRoute type="collection"   path="/shifts"          element={<ShiftsCollectionPage />} />
<PatternsReactRoute type="createEntity" path="/shifts/new"      element={<ShiftEntityPage />} />
<PatternsReactRoute type="editEntity"   path="/shifts/:shiftId" element={<ShiftEntityPage />} />
```

`RouteType` is `'collection' | 'createEntity' | 'editEntity' | 'other'` — `Read <pkgRoot>/dist/dts-bundle/components/PatternsReactRoute.d.ts`.

**Navigating there still needs an `entity`, and you have no record yet.** `navigateToEntityPage({ path, entity })` types `entity` as a required `T` (`dist/dts-bundle/hooks/usePatternsNavigate.d.ts`), with no create-shaped overload. Pass an empty value of the entity type:

```tsx
const BLANK_SHIFT: Shift = { id: '', name: '' };

<PrimaryActions
  label="Add Shift"
  prefixIcon={<Add />}
  onClick={() => navigateToEntityPage({ path: '/shifts/new', entity: BLANK_SHIFT })}
/>
```

The argument goes into router state and the entity page header reads it, which is why the title and subtitle render immediately instead of waiting on the fetch — the same reason to prefer `navigateToEntityPage` over a plain route change on the edit path. Keep the placeholder's fields empty: it *is* `state.entity` until `fetch` resolves.

**`fetch` is required, and `{ entity: undefined }` is the create answer.** Its type is `() => Promise<{ entity: T | undefined }>`; the `undefined` is that case, not a loading state. There is nothing to load, so resolve straight away rather than reaching for a `fetch`-less variant that does not exist.

**Set `isNewEntity`.** It is the only param that tells the page which route it is on. Omitted, the page infers from data — an entity is loaded, so this must be an edit — and a create page that seeds local defaults through `fetch` is then announced to the collection as an *update*. The collection changes a row it does not have instead of adding one: the new record never appears in the list, and the only trace is a console error about page info for the updated entity not being found. Its docstring says as much (`dist/dts-bundle/types/UseEntityPageParams.d.ts`): the flag "decides how a save is announced to the parent page — created vs updated — so a new item seeded with local defaults is still announced as created."

Together, on the component that serves both routes:

```tsx
const { shiftId } = useParams<{ shiftId?: string }>();
const isNewEntity = !shiftId;

const state = useEntityPage<Shift, ShiftFormFields>({
  isNewEntity,
  fetch: () =>
    shiftId
      ? api.getShift(shiftId).then((entity) => ({ entity }))
      : Promise.resolve({ entity: undefined }),
  onSave: async ({ widgetsFormData }) => {
    const values = { ...form.getValues(), ...widgetsFormData };
    const updatedEntity = shiftId
      ? await api.updateShift(shiftId, values)
      : await api.createShift(values);
    return { updatedEntity };
  },
  saveSuccessToast: isNewEntity ? 'Shift added' : 'Shift updated',
  ...(isNewEntity ? {} : { deleteAction: { onDelete: (shift: Shift) => api.deleteShift(shift.id!) } }),
  form,
  parentPath: '/shifts',
});
```

`onSave` returns `{ updatedEntity }` on both branches — the key does not change name for an insert. Spread `deleteAction` in only on the edit route; a record that does not exist yet has no delete. The header title is the same conditional: `isNewEntity ? 'Add Shift' : entity?.name`.

`useEntityPage` reads its params once, in a `useState` initializer, so a boolean `isNewEntity` is fixed at mount. That is what you want when each route mounts its own page. Pass the getter form — `isNewEntity?: boolean | (() => boolean)` — reading a live source when a single mounted page survives the route change instead.

> Written against the installed `@wix/patterns`. `BLANK_SHIFT` exists only to satisfy the required `entity`; if a later version makes that param optional, drop it and pass `path` alone. Re-read `usePatternsNavigate.d.ts` before assuming either way.

## Around the call

| Step | What owns it |
| --- | --- |
| Getting here from the collection page | `usePatternsNavigate()` → `navigateToEntityPage({ path, entity })` |
| Registering the route | `PatternsReactRoute` inside `PatternsReactRouter` |
| Form state and field binding | `useForm` / `useController` from `@wix/patterns/form` — `useController`, never `register` |
| Body layout | `EntityPage.Header`, `.MainContent`, `.AdditionalContent`, `.Card` |
| The fields inside those cards | `@wix/design-system` (`FormField`, `Input`, `Text`) |

`@wix/patterns/form` re-exports `@wix/bex-core/form`, which wraps `react-hook-form` — so `form.getValues()`, `form.reset()` and the rest are react-hook-form's API, documented there rather than in the patterns docs.

## Binding a field: `useController`, never `register`

`register` returns props for a plain `<input>`, and WDS components are not one. Two ways it fails:

`<Input {...register('qty')} />` does not compile — `register` always returns `min`/`max` as `string | number`, whatever options you passed, and WDS types them `number | undefined`. The error names `InputProps`, which reads like a WDS bug and isn't.

`<Input ref={register('qty').ref} />` **does** compile and is wrong. `Input`'s `ref` is its imperative handle (`Ref<InputImperativeActions>`); `register`'s ref is `(instance: any) => void`, so it accepts that and binds the handle rather than the `<input>`. The field never registers, validation never sees it, and nothing reports it.

Bind through value/onChange instead:

```tsx
import { useController, useForm } from '@wix/patterns/form';
import { FormField, Input } from '@wix/design-system';

type ProductForm = { name: string; qty: number };

function NameField({ form }: { form: ReturnType<typeof useForm<ProductForm>> }) {
  const { field, fieldState } = useController({
    name: 'name',
    control: form.control,
    rules: { required: 'Name is required' },
  });

  return (
    <FormField label="Name" required status={fieldState.error ? 'error' : undefined} statusMessage={fieldState.error?.message}>
      <Input value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
    </FormField>
  );
}
```

Rules live in `rules`, not on the WDS component. If you need `register` for a DOM concern such as input masking, `Input` takes `inputRef?: React.Ref<HTMLInputElement>` — pass the ref there, never to `ref`.

A dialog that creates, updates or displays one listed record is **not** a dashboard modal — a create / "add new" form included, since it writes the record. See [DASHBOARD_MODAL.md](../DASHBOARD_MODAL.md).
