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

Confirm the shape rather than guessing — the hook's doc ends by pointing at the bundle rather than tabulating props, because props tables only exist for components. `Read <pkgRoot>/dist/dts-bundle/index.json`, then `Read` the bundled `.d.ts` for each of `useEntityPage`, `UseEntityPageParams`, and `OnSaveParams` at exactly the `file` path the index gives.

## Create route

The example above is edit-only. "Add new" is an `EntityPage` too, and it is not the same call with the id left out. Four things differ, and three of them fail silently if you guess:

- The route is its own `PatternsReactRoute type="createEntity"`. One component can serve both entity routes; the route is what tells them apart.
- `navigateToEntityPage({ path })` — omit `entity`. It exists so the header can render a title before the fetch resolves, and a create route has no record to give it. A placeholder is worse than nothing: until `fetch` resolves it *is* `state.entity`.
- `fetch` is required on the create route too, and `{ entity: undefined }` is the create case built into its return type — not a loading state, and there is no `fetch`-less variant.
- `isNewEntity` is the only param that tells the page which route it is on. Omitted, a create page that seeds defaults through `fetch` is announced to the collection as an *update*: the collection changes a row it does not have, the new record never appears in the list, and the only trace is a `Fetched page info for updated entity not found` console error.

`Read <pkgRoot>/dist/docs/useEntityPage.md` before writing one — its **Create route** section carries the worked component that serves both routes off one `useParams` answer, and the `boolean | (() => boolean)` getter form for `isNewEntity`.

**If that file has no `Create route` heading, the installed `@wix/patterns` predates 1.464.0.** Upgrade and re-read rather than working around it: on those versions `navigateToEntityPage` types `entity` as required, so omitting it does not compile, and passing the placeholder that satisfies it is the failure the bullet above describes.

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
