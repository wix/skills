
# Wix Dashboard Page Builder
Dashboard pages appear in the site owner's Wix dashboard and enable site administrators to manage data, configure settings, and perform admin tasks.

## UI Libraries — Read Before Writing Any JSX

At Wix, dashboard pages are built from `@wix/patterns` and `@wix/design-system`, in that order of preference:

1. **`@wix/patterns` first** — page shells (`CollectionPage`, `EntityPage`, `SettingsPage`), tables/grids, collection state hooks, filters, sorting, row and bulk actions, in-extension routing. Look every name up in the generated docs at `node_modules/@wix/patterns/dist/docs/` (start with `index.json`). See [WIX_PATTERNS_DOCS.md](WIX_PATTERNS_DOCS.md).
2. **`@wix/design-system` second** — the leaf UI inside that shell (inputs, buttons, form fields, text, layout, cards, badges, icons). Choose components via the `wix-design-system` skill.
3. **Custom React last** — only when neither library has it.

Do not hand-write React for anything either library already provides, and do not decide a component is missing without checking. Full rule: [SKILL.md → Component Selection Order](../SKILL.md#component-selection-order).

## Scaffold

Use `wix generate --params` with all required fields:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

| Field | Constraint |
| --- | --- |
| `title` | Display name shown in the dashboard sidebar. |
| `route` | URL path segment (lowercase alphanumeric + hyphens). The page is served at `/dashboard/<route>`. The scaffold param is `route`; the builder file's runtime field is `routePath`. |

The CLI generates the folder, `page.tsx`, the builder file, the UUID, and the `src/extensions.ts` registration. After scaffolding, implement the page UI in the generated `page.tsx`.

**Then, before writing UI:** confirm `@wix/patterns` is a dependency and its docs are present.

```bash
ls node_modules/@wix/patterns/dist/docs/index.json
```

If it's missing, add the package (`^1.367.0` or later — earlier versions don't ship `dist/docs/`) and install. Without this, the patterns lookup in step 1 of [Component Selection Order](../SKILL.md#component-selection-order) silently finds nothing and the page gets built entirely from WDS.

## Capabilities

### Data Operations (Wix Data SDK)

See [Wix Data Reference](data-collection/WIX_DATA.md) in the Data Collection reference for complete documentation.

**Summary:**

- Read: `items.query('Collection').filter/sort.limit.find()` → `{ items, totalCount, hasNext }`
- Write: `items.insert | update | remove`. Ensure collection permissions allow the action

**Query methods:** `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `between`, `contains`, `startsWith`, `endsWith`, `hasSome`, `hasAll`, `isEmpty`, `isNotEmpty`, `and`, `or`, `not`, `ascending`, `descending`, `limit`, `skip`, `include`

### Dashboard APIs

See [Dashboard API Reference](dashboard-page/DASHBOARD_API.md) for complete documentation including all methods, page IDs, and examples.

**Key methods:**

- `dashboard.navigate()` - Navigate between dashboard pages
- `dashboard.observeState()` - Receive contextual state and environmental information
- `dashboard.showToast()` - Display toast notifications
- `dashboard.openModal()` - Open dashboard modal extensions (see [Dashboard Modal reference](DASHBOARD_MODAL.md))
- `dashboard.navigateBack()` - Navigate back to previous page
- `dashboard.getPageUrl()` - Get full URL for a dashboard page
- `dashboard.openMediaManager()` - Open Wix Media Manager
- `dashboard.onBeforeUnload()` - Register beforeunload handler
- `dashboard.addSitePlugin()` - Add site plugin to slots
- `dashboard.setPageTitle()` - Set page title in browser tab
- `dashboard.onLayerStateChange()` - Handle foreground/background state changes

**CRITICAL: Using Modals in Dashboard Pages**

When you need to display popup forms, confirmations, detail views, or any dialog overlays from a dashboard page, you **MUST** use dashboard modals, not regular React modals or WDS Modal components.

- **Use dashboard modals** for: edit forms, delete confirmations, detail views, settings dialogs, any popup content
- **Do NOT use** WDS `Modal` component or custom React modal implementations
- **See [Dashboard Modal reference](DASHBOARD_MODAL.md)** for complete implementation guide

Dashboard modals are opened using `dashboard.openModal()` and provide proper integration with the dashboard lifecycle, state management, and navigation.

**Ecom Navigation:** See [Ecom Navigation Reference](dashboard-page/ECOM_NAVIGATION.md) for ecom-specific navigation helpers.

### Embedded Script Configuration API

When building a dashboard page to configure an embedded script, see [Dynamic Parameters Reference](dashboard-page/DYNAMIC_PARAMETERS.md) for complete implementation guide.

**Key points:**

- Use `embeddedScripts` from `@wix/app-management`
- Parameters are returned as strings - handle type conversions when loading
- All parameters must be saved as strings (convert booleans/numbers to strings)
- Use `withProviders` wrapper when dynamic parameters are present

## Examples

Each output below names the library that owns each part. Confirm every patterns component and prop in `node_modules/@wix/patterns/dist/docs/` before use — these examples name the shape, not a verified API.

### Data Management Table

**Request:** "Create a dashboard page to manage blog posts"

**Output:** A `@wix/patterns` `CollectionPage` shell wrapping a `Table` driven by a collection state hook (`useTableCollection`), with the search, add/edit/delete row actions, and empty state supplied by the collection's own APIs. WDS only for the leaf UI inside cells and the add form. The provider lives in a parent component, in a separate file from the hook call.

### Settings Form

**Request:** "Build a settings page for notification preferences"

**Output:** A `@wix/patterns` `SettingsPage` shell. WDS form fields inside it (`FormField`, `Input`, `ToggleSwitch`), save button with `dashboard.showToast()` confirmation, and `dashboard.onBeforeUnload()` for the unsaved-changes warning. No collection here, so no table hook.

### Order Management

**Request:** "Create an admin panel for customer orders"

**Output:** A `@wix/patterns` `CollectionPage` + `Table`, with filters, sorting, and row actions from the collection APIs — **not** a hand-built WDS filter bar. Status badges are WDS leaf UI inside a cell. Detail view opens as a separate Dashboard Modal via `dashboard.openModal()` (see [Dashboard Modal reference](DASHBOARD_MODAL.md)).

### Embedded Script Configuration

**Request:** "Create a settings page for the coupon popup embedded script"

**Output:** A `@wix/patterns` `SettingsPage` shell with WDS form fields for popup headline, coupon code, minimum cart value, and enable toggle. Uses `embeddedScripts` API to load/save parameters.

```typescript
// Key pattern for embedded script configuration pages
import { embeddedScripts } from "@wix/app-management";

// Load on mount
useEffect(() => {
  const load = async () => {
    const script = await embeddedScripts.getEmbeddedScript();
    const data = script.parameters || {};
    setOptions({
      headline: data.headline || "Default",
      enabled: data.enabled === "true",
      threshold: Number(data.threshold) || 0,
    });
  };
  load();
}, []);

// Save handler
const handleSave = async () => {
  await embeddedScripts.embedScript({
    parameters: {
      headline: options.headline,
      enabled: String(options.enabled),
      threshold: String(options.threshold),
    },
  });
  dashboard.showToast({ message: "Saved!", type: "success" });
};
```


## API Spec Support

When an API specification is provided, you can make API calls to those endpoints. See [API Spec Reference](dashboard-page/API_SPEC.md) for details on how to use API specs in dashboard pages.


## Layout Guidelines

Content layout inside the page shell — the 6px base unit, the 12-column grid, spacing tokens, form/display/marketing/wizard layouts: see [WDS Layout Reference](dashboard-page/WDS_LAYOUT.md).

Remember the split: `@wix/patterns` owns the page shell and anything collection-shaped (tables, grids, filters, sorting, empty states); that reference covers the content you place inside it.
