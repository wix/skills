
# Wix Dashboard Page Builder

Dashboard pages appear in the site owner's Wix dashboard and enable site administrators to manage data, configure settings, and perform admin tasks.

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

When you need to display popup forms, confirmations, detail views, or any dialog overlays from a dashboard page, you **MUST** use dashboard modals, not custom overlay modals.

- **Use dashboard modals** for: edit forms, delete confirmations, detail views, settings dialogs, any popup content
- **Do NOT use** custom React modal overlays or dialog components
- **See [Dashboard Modal reference](DASHBOARD_MODAL.md)** for complete implementation guide

Dashboard modals are opened using `dashboard.openModal()` and provide proper integration with the dashboard lifecycle, state management, and navigation.

**Ecom Navigation:** See [Ecom Navigation Reference](dashboard-page/ECOM_NAVIGATION.md) for ecom-specific navigation helpers.

### Embedded Script Configuration API

When building a dashboard page to configure an embedded script, see [Dynamic Parameters Reference](dashboard-page/DYNAMIC_PARAMETERS.md) for complete implementation guide.

**Key points:**

- Use `embeddedScripts` from `@wix/app-management`
- Parameters are returned as strings - handle type conversions when loading
- All parameters must be saved as strings (convert booleans/numbers to strings)
- Use Tailwind CSS for all UI — see [TAILWIND.md](TAILWIND.md)

## Optional builder fields

The CLI scaffolds the builder with `id`, `title`, `routePath`, and `component`. To customize sidebar placement and routing, edit the generated builder file to set:

- `additionalRoutes` (string[]): extra routes leading to this page.
- `sidebar.disabled` (boolean, default false): hide page from sidebar.
- `sidebar.priority` (number): sidebar ordering; lower is higher priority.
- `sidebar.whenActive.selectedPageId` (string): which page appears selected when this page is active.
- `sidebar.whenActive.hideSidebar` (boolean): hide sidebar when this page is active.

## Examples

### Data Management Table

**Request:** "Create a dashboard page to manage blog posts"

**Output:** Page with table displaying posts, search toolbar, add/edit/delete actions, empty state.

### Settings Form

**Request:** "Build a settings page for notification preferences"

**Output:** Page with form fields, save button with toast confirmation, unsaved changes warning.

### Order Management

**Request:** "Create an admin panel for customer orders"

**Output:** Page with orders table, status badges, filters, detail dashboard modal (using [Dashboard Modal reference](DASHBOARD_MODAL.md)), status update actions.

### Embedded Script Configuration

**Request:** "Create a settings page for the coupon popup embedded script"

**Output:** Page with form fields for popup headline, coupon code, minimum cart value, and enable toggle. Uses `embeddedScripts` API to load/save parameters.

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


## Layout

Use **Tailwind CSS** for all layout and styling — see [TAILWIND.md](TAILWIND.md). Put primary content near the top of the page; use responsive utilities (`md:`, `lg:`) for wider screens.

### Tailwind Layout Patterns

See [TAILWIND.md](TAILWIND.md) for component patterns. Common layouts:

- **Page wrapper** — `<main className="min-h-screen bg-gray-50 p-6">`
- **Card / section** — `<section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">`
- **Grid layout** — `<div className="grid grid-cols-1 gap-6 md:grid-cols-2">`
- **Page header** — `<header className="mb-6 flex items-center justify-between">`
