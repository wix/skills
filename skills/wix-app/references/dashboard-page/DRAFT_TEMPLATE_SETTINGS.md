# Draft Template — Settings page (Cases C and D)

> Split out of [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) so each file covers one case. Pick your case there first; come here only for Case C or D.

## The settings page

No dedicated toolkit file exists for this yet (unlike Entity/Collection) — the shape, verified against `useSettingsPage.md`:

```tsx
// {Feature}SettingsPage.tsx — Case C or D
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

`useSettingsPage`'s params are all required except `saveSuccessToast`/`saveErrorToast`: `form`, `fetch`, `onSave`, `onCancel`. There is no `parentPath`/`parentPageId` — a settings page isn't reached by drilling into a row, so it carries no back-navigation contract, and Case C needs no router at all to reach it (Section 1's entry renders it directly).
