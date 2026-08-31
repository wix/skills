# Entity Page Toolkit — calling `useEntityPage` correctly

[COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md) says a row the user cannot open is a defect, and sends you to `EntityPage` + `useEntityPage` to fix it. This file is the call itself, because the hook's own published example has been wrong in three ways and following it fails `tsc` twice.

**Trust this file over the published `useEntityPage.md` example.** Through `@wix/patterns@1.452.0` that example destructures `submittedValues`, passes `container`, and omits the generics — none of which type-check against the same package's `.d.ts`. Measured runs lose whole minutes to it: the model writes the example, the build fails, and a validate subagent spends the rest of the run reverse-engineering `node_modules` to undo it.

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

## The three ways it goes wrong

| Wrong | Right | What `tsc` says |
| --- | --- | --- |
| `onSave: ({ submittedValues }) => …` | `onSave: ({ widgetsFormData }) => …`, form values from `form.getValues()` | `Property 'submittedValues' does not exist on type 'OnSaveParams'` |
| `useEntityPage({ … })` with a typed `form` | `useEntityPage<Entity, FormFields>({ … })` | `Type 'UseFormReturn<ShiftFormFields, …>' is not assignable to type 'UseFormReturn<FieldValues>'` |
| `container,` in the params | omit it — the hook calls `useWixPatternsContainer()` itself | excess-property error on the object literal |

### `onSave` does not hand you the form values

`OnSaveParams` is `{ widgetsFormData: { [key: string]: any } }` and nothing else. `widgetsFormData` carries what the **widget** fields contributed — extended fields, tags — not what the user typed into your own fields. Those come from the form you already own:

```tsx
onSave: ({ widgetsFormData }) => {
  const values = form.getValues();      // your fields
  const { extendedFields, tags } = widgetsFormData; // widget fields
  …
}
```

Reaching for a `values`-shaped property on the `onSave` argument is the single most common failure here. There isn't one — the argument has exactly one key.

### Both generics, always

`useEntityPage<T, V extends FieldValues = FieldValues>` takes the entity type **and** the form-values type. `V` does not infer from the `form` you pass; it falls back to `FieldValues`, and a `useForm<ShiftFormFields>()` then fails to assign. One generic only works when the form is untyped (`useForm()`), which is not what you want.

Do **not** paper over this with `useEntityPage<any, ShiftFormFields>`. That compiles and silently discards entity typing — `state.entity` becomes `any` and every downstream field access stops being checked. Name the entity type.

## Verify before writing

The hook's props table is empty in `docs` output — props tables only exist for components — so ask for the signature instead:

```
node <this-skill-dir>/scripts/patterns.cjs types useEntityPage UseEntityPageParams OnSaveParams
```

`types` takes a list, and each call is a full model turn, so ask for all three at once. That is also the check that settles which params exist: `UseEntityPageParams` is a `Pick`, and anything not in it (`container`, `entityId` on the non-schema overload) is an excess-property error.

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
