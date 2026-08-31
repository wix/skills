# Entity Page Toolkit — calling `useEntityPage`

[COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md) says a row the user cannot open is a defect, and sends you to `EntityPage` + `useEntityPage` to fix it. This file is the call itself.

## The call

```tsx
import { useEntityPage, EntityPage } from '@wix/patterns/page';
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

`UseEntityPageParams` picks a fixed set off `EntityPageStateParams` — `fetch`, `onSave`, `saveSuccessToast`, `saveErrorToast`, `deleteAction`, `transformEntityToCollectionItem`, `isNewEntity`, `form`, `parentPageId`, `parentPath`, `parentReferrer`, `schemaSource`. Anything outside that list is an excess-property error on the object literal. `container` is the common guess and is not one of them: the hook calls `useWixPatternsContainer()` itself.

Confirm the shape rather than guessing — the hook's `docs` output has an empty API section, because props tables only exist for components:

```
node <this-skill-dir>/scripts/patterns.cjs types useEntityPage UseEntityPageParams OnSaveParams
```

`types` takes a list and each call is a full model turn, so ask for all three at once.

## Around the call

| Step | What owns it |
| --- | --- |
| Getting here from the collection page | `usePatternsNavigate()` → `navigateToEntityPage({ path, entity })` |
| Registering the route | `PatternsReactRoute` inside `PatternsReactRouter` |
| Form state and field binding | `useForm` / `useController` from `@wix/patterns/form` |
| Body layout | `EntityPage.Header`, `.MainContent`, `.AdditionalContent`, `.Card` |
| The fields inside those cards | `@wix/design-system` (`FormField`, `Input`, `Text`) |

`@wix/patterns/form` re-exports `@wix/bex-core/form`, which wraps `react-hook-form` — so `form.getValues()`, `form.reset()` and the rest are react-hook-form's API, documented there rather than in the patterns docs.

Adding, editing or viewing a collection item is **not** a dashboard modal — see [DASHBOARD_MODAL.md](../DASHBOARD_MODAL.md).
