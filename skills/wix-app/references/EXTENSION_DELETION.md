# Extension Deletion

Covers safe deletion of any extension type from a Wix CLI project: dashboard pages, modals, plugins, menu plugins, service plugins, event extensions, data collections, backend APIs, editor React components, custom element widgets, site plugins, and embedded scripts.

**Scaffolding teardown is manual.** Unlike creation (which uses `wix generate`), there is no CLI command to delete an extension.

> ⚠️ **Always confirm with the user which extension(s) to delete before proceeding. Do not assume or decide on behalf of the user.** Check for dependent extensions — e.g., if a dashboard page that calls `dashboard.openModal()` is being deleted, ask whether the target modal should also be deleted.

## Extension Types Reference Table

| Extension Type | Category | Default Folder | Deviation |
| --- | --- | --- | --- |
| Dashboard Page | Dashboard | `src/extensions/dashboard/pages/<folder>/` | — |
| Dashboard Modal | Dashboard | `src/extensions/dashboard/modals/<folder>/` | — |
| Dashboard Plugin | Dashboard | `src/extensions/dashboard/plugins/<folder>/` | — |
| Dashboard Menu Plugin | Dashboard | `src/extensions/dashboard/menu-plugins/<folder>/` | — |
| Service Plugin | Backend | `src/extensions/backend/service-plugins/<folder>/` | — |
| Backend Event Extension | Backend | `src/extensions/backend/events/<folder>/` | — |
| Data Collection — single collection | Backend | — | See [Data Collection](#data-collection) |
| Data Collection — entire extension | Backend | `src/extensions/backend/data-collections/<folder>/` | — |
| Backend API (HTTP endpoint) | Backend | `src/pages/api/` | See [Backend API](#backend-api-http-endpoint) |
| Editor React Component | Site | `src/extensions/site/editor-react-components/<folder>/` | — |
| Custom Element Widget | Site | `src/extensions/site/custom-elements/<folder>/` | — |
| Site Plugin | Site | `src/extensions/site/site-plugins/<folder>/` | See [Site Plugin](#site-plugin) |
| Embedded Script | Site | `src/extensions/site/embedded-scripts/<folder>/` | — |

> **⚠️ Backend API is the only extension type with no `extensions.ts` registration.** Deletion requires file removal only — no `extensions.ts` changes needed.

> **Note:** If extension files were moved after generation, locate the actual folder from the `import` statement in `src/extensions.ts`.

## Extension-Specific Steps

### Data Collection

Two distinct deletion modes — confirm with the user which one applies.

**Mode A — Delete a single collection (keep the extension):**

1. Open `src/extensions/backend/data-collections/<folder>/data-collections.extension.ts`.
2. Delete the `import` for the collection schema file being deleted.
3. Delete the corresponding entry from the `collections` array in the extension config.
4. Delete the collection's schema file (e.g., `<collection-name>.ts`) from the folder.
5. Do **not** touch `src/extensions.ts` — the Data Collection extension itself remains registered.

**Mode B — Delete the entire Data Collection extension:**

Follow the [common deletion steps](#common-deletion-steps) to delete the full folder and its entry from `src/extensions.ts`.

> ⚠️ **Warning:** Deleting a data collection extension from a published app does not delete existing CMS data on installed sites. Communicate this to the user.

### Backend API (HTTP Endpoint)

Backend APIs are **never registered in `src/extensions.ts`** — auto-discovered by the Astro runtime from `src/pages/api/`.

1. Delete the relevant `*.ts` file(s) from `src/pages/api/`.
2. No `extensions.ts` changes are needed.

### Site Plugin

In addition to the common deletion steps, a Site Plugin stores a logo asset that must also be deleted:

1. Delete the extension folder (common step 1).
2. Delete the `import` + `.use()` from `src/extensions.ts` (common step 2).
3. Delete the plugin's logo SVG from `public/` (e.g., `public/<plugin-name>-logo.svg`).

## Common Deletion Steps

Applies to all extension types **except** Backend API and single Data Collection deletion. Check [Extension-Specific Steps](#extension-specific-steps) first.

**Step 1 — Delete the extension folder** using the path from the Extension Types Reference Table above.

**Step 2 — Delete from `src/extensions.ts`** — remove both:
1. The `import` statement for the extension
2. The `.use(<extensionName>)` call that registers it

**Example — before (deleting `myModal`):**
```typescript
import { app } from '@wix/astro/builders';
import myPage from './extensions/dashboard/pages/my-page/my-page.extension.ts';
import myModal from './extensions/dashboard/modals/my-modal/my-modal.extension.ts';

export default app()
  .use(myPage)
  .use(myModal);
```

**After:**
```typescript
import { app } from '@wix/astro/builders';
import myPage from './extensions/dashboard/pages/my-page/my-page.extension.ts';

export default app()
  .use(myPage);
```

When deleting multiple extensions, make all `src/extensions.ts` edits in a single pass to avoid intermediate broken states.

## Validation

Execute sequentially after all deletion steps are complete. Stop and report errors if either step fails.

1. **TypeScript compilation** — `npx tsc --noEmit`. If errors remain, search for leftover references to the deleted extension in other files and delete them.
2. **Build** — `npx wix build`. Check `.wix/debug.log` on failure.

## Post-Deletion Requirements

After completing deletion, the project must be rebuilt and re-deployed:

| Category | Headless project | App project |
| --- | --- | --- |
| Dashboard extensions | Build + deploy | Build + deploy |
| Backend extensions | Build + deploy | Build + deploy |
| Site extensions | N/A (app-only) | **Release a new app version** |

> **Site extensions note:** `wix release` is required — not just `wix build` + deploy — so the extension is deleted from all installed sites.

Communicate the appropriate requirement to the user as a manual action item.

## Cost Optimization

- **Validate once** — run validation after all extensions are deleted, not after each individual deletion
- **Single-pass `extensions.ts` edits** — batch all `import` and `.use()` deletions in one edit when deleting multiple extensions
- **Skip `extensions.ts` for Backend API** — HTTP endpoints are never registered there; no edit needed
- **Check the `import` path first** — always locate the actual folder from `extensions.ts` before deleting, in case files were moved after generation

## Documentation

Official Wix CLI documentation for extension deletion, organized by type:

| Extension Type | Delete Documentation |
| --- | --- |
| Dashboard Page | [Add Dashboard Page Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/dashboard-extensions/dashboard-pages/add-dashboard-page-extensions#delete-a-dashboard-page) |
| Dashboard Modal | [Add Dashboard Modal Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/dashboard-extensions/dashboard-modals/add-dashboard-modal-extensions#delete-a-dashboard-modal) |
| Dashboard Plugin | [Add Dashboard Plugin Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/dashboard-extensions/dashboard-plugins/add-dashboard-plugin-extensions#delete-a-dashboard-plugin) |
| Dashboard Menu Plugin | [Add Dashboard Menu Plugin Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/dashboard-extensions/dashboard-menu-plugins/add-dashboard-menu-plugin-extensions#delete-a-dashboard-menu-plugin) |
| Service Plugin | [Add Service Plugin Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/backend-extensions/service-plugins/add-service-plugin-extensions#delete-a-service-plugin) |
| Backend Event Extension | [Add Event Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/backend-extensions/events/add-event-extensions#delete-an-event-extension) |
| Data Collection | [Add Data Collection Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/backend-extensions/data-collections/add-a-data-collections-extension-with-the-wix-cli#delete-a-data-collection) |
| Custom Element Widget | [Add Custom Element Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/site-extensions/custom-elements/add-a-custom-element-extension#delete-a-custom-element) |
| Site Plugin | [Add Site Plugin Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/site-extensions/site-plugins/add-a-site-plugin-extension#delete-a-site-plugin) |
| Embedded Script | [Add Embedded Script Extensions — Delete](https://dev.wix.com/docs/wix-cli/guides/extensions/site-extensions/embedded-scripts/add-an-embedded-script-extension#delete-an-embedded-script) |
| About extensions.ts | [About the extensions.ts File](https://dev.wix.com/docs/wix-cli/guides/extensions/about-the-extensions-ts-file) |
