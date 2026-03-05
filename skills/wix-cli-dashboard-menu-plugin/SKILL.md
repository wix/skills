---
name: wix-cli-dashboard-menu-plugin
description: "MUST use whenever the user wants to add a clickable menu item, action, or option to an existing Wix dashboard page's more-actions menu, bulk-actions menu, or context menu. This includes any request to add actions/options/items to menus on Wix Stores (products, inventory), Wix Bookings (calendar, services, staff, booking list), Wix Blog (posts, categories, tags), Wix eCommerce (orders), Wix Events, Wix CRM (contacts), or Wix Restaurants (reservations, online orders, menus) dashboard pages. Trigger on phrases like: add menu item, add action to menu, add option to more actions, bulk action, custom action in dashboard menu, extend dashboard menu, dashboard menu plugin, context menu action on dashboard page. Do NOT use for: visual widgets/plugins embedded in dashboard page slots (use wix-cli-dashboard-plugin), standalone dashboard pages (use wix-cli-dashboard-page), standalone modals (use wix-cli-dashboard-modal), or site-facing UI."
compatibility: Requires Wix CLI development environment.
---

# Wix Dashboard Menu Plugin Builder

Creates dashboard menu plugin extensions for Wix CLI applications. Dashboard menu plugins are menu items that integrate into predefined **menu slots** on dashboard pages managed by Wix first-party business apps (Wix Stores, Wix Bookings, Wix Blog, Wix eCommerce, Wix Events, Wix CRM, Wix Restaurants).

When clicked, a dashboard menu plugin either **navigates to a dashboard page** or **opens a dashboard modal**.

Dashboard menu plugins are configuration-only extensions — they do NOT have a React component file.

---

## Quick Start Checklist

Follow these steps in order when creating a dashboard menu plugin:

1. [ ] Identify the target menu slot ID — see [Slots Reference](references/SLOTS.md)
2. [ ] Create plugin folder: `src/extensions/dashboard/menu-plugins/<plugin-name>/`
3. [ ] Create `<plugin-name>.extension.ts` with `extensions.dashboardMenuPlugin()` and unique UUID
4. [ ] Configure the `action` field to either navigate to a dashboard page or open a modal
5. [ ] Update `src/extensions.ts` to import and use the new extension

## Architecture

Dashboard menu plugins operate as **click-to-action** menu items. They:

1. Appear as labeled items with an icon in a menu slot on a Wix app's dashboard page
2. When clicked, perform one of two actions:
   - **Navigate to a dashboard page** — redirects to a specified dashboard page
   - **Open a dashboard modal** — displays a specified dashboard modal

## Files and Code Structure

Dashboard menu plugins live under `src/extensions/dashboard/menu-plugins/`. Each plugin has its own folder containing a single file.

```
src/extensions/dashboard/menu-plugins/
└── <plugin-name>/
    └── <plugin-name>.extension.ts   # Builder configuration
```

> **Note:** This is the default folder structure created by the CLI. You can move the file to any location within the `src/` folder and update the references in your `extension.ts` file.

## Plugin Builder Configuration

### File: `<plugin-name>.extension.ts`

```typescript
import { extensions } from "@wix/astro/builders";

export const dashboardmenupluginMyMenuPlugin = extensions.dashboardMenuPlugin({
  id: "{{GENERATE_UUID}}",
  title: "My Menu Plugin",
  extends: "<MENU_SLOT_ID>",
  iconKey: "Sparkles",
  action: {
    navigateToPage: {
      pageId: "<DASHBOARD_PAGE_ID>",
    },
  },
});
```

**CRITICAL: UUID Generation**

The `id` must be a unique, static UUID v4 string. Generate a fresh UUID for each extension — do NOT use `randomUUID()` or copy UUIDs from examples. Replace `{{GENERATE_UUID}}` with a freshly generated UUID like `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`.

### Builder Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique plugin ID (GUID). Must be unique across all extensions in the project. |
| `title` | string | Text displayed for the menu item. |
| `extends` | string | Menu slot ID where the extension integrates. See [Slots Reference](references/SLOTS.md). |
| `iconKey` | string | Icon name from Wix Design System appearing next to the title. |
| `action` | object | Navigation configuration determining behavior when clicked. |

### The `extends` Field

The `extends` field specifies which dashboard menu slot hosts your menu plugin. Each Wix business app exposes menu slots on its dashboard pages. You must provide the exact slot ID.

**Important:** Some slots with the same ID appear on different pages within the dashboard. If you create a menu plugin for a slot that exists on multiple pages, the menu plugin is displayed on all of those pages.

For the complete list of available menu slot IDs, see [Slots Reference](references/SLOTS.md).

### The `action` Field

The `action` field determines what happens when the user clicks the menu item. You must configure exactly one of the following:

#### Option 1: Navigate to a Dashboard Page

```typescript
action: {
  navigateToPage: {
    pageId: "<DASHBOARD_PAGE_ID>",
  },
},
```

| Field | Type | Description |
|-------|------|-------------|
| `action.navigateToPage` | object | Page navigation configuration object. |
| `action.navigateToPage.pageId` | string | The `id` of the target dashboard page extension. |

#### Option 2: Open a Dashboard Modal

```typescript
action: {
  openModal: {
    componentId: "<DASHBOARD_MODAL_ID>",
  },
},
```

| Field | Type | Description |
|-------|------|-------------|
| `action.openModal` | object | Modal navigation configuration object. |
| `action.openModal.componentId` | string | The `id` of the target dashboard modal extension. |

### The `iconKey` Field

The `iconKey` must be a valid icon name from the Wix Design System icon set (`@wix/wix-ui-icons-common`). Use the `wds-docs` skill to look up available icon names.

## Extension Registration

**Extension registration is MANDATORY and has TWO required steps.**

### Step 1: Create Plugin-Specific Extension File

Each dashboard menu plugin requires a `<plugin-name>.extension.ts` file in its folder. See [Plugin Builder Configuration](#plugin-builder-configuration) above.

### Step 2: Register in Main Extensions File

**CRITICAL:** After creating the plugin-specific extension file, you MUST read [wix-cli-extension-registration](../wix-cli-extension-registration/SKILL.md) and follow the "App Registration" section to update `src/extensions.ts`.

**Without completing Step 2, the dashboard menu plugin will not appear on the dashboard page.**

## Hard Constraints

- Do NOT invent or assume new types, modules, functions, props, events, or imports — use only entities explicitly present in the provided references or standard libraries already used in this project
- NEVER use mocks, placeholders, or TODOs in any code — ALWAYS implement complete, production-ready functionality
- The `extends` field MUST contain a valid menu slot ID from a Wix business app — do NOT invent slot IDs
- The `action.navigateToPage.pageId` MUST reference the `id` of an existing dashboard page extension in the project
- The `action.openModal.componentId` MUST reference the `id` of an existing dashboard modal extension in the project
- A dashboard menu plugin does NOT have a React component — it is configuration-only
- Do NOT confuse dashboard menu plugins with dashboard plugins — they are different extension types

## Examples

### Blog Posts More Actions Menu Item

**Request:** "Add a menu item to the Blog posts more actions menu that navigates to a custom analytics page"

**Output:** Menu plugin targeting slot `62eee170-31e0-4e71-b3ac-e357a9326a8c` (Blog Published posts more actions menu) with `navigateToPage` action pointing to the analytics dashboard page's `id`.

### Bookings Calendar Menu Item with Modal

**Request:** "Add a menu item to the Bookings calendar more actions menu that opens a quick-add modal"

**Output:** Menu plugin targeting slot `f3ad314d-0704-48e5-86b5-81acaf43e036` (Bookings Calendar more actions menu) with `openModal` action pointing to the quick-add dashboard modal's `id`.

### Stores Product Bulk Action

**Request:** "Add a bulk action to the Stores products page that opens a batch pricing modal"

**Output:** Menu plugin targeting slot `23986555-0ea3-49b4-bcaa-56cfe1ad35bf` (Stores bulk actions toolbar more actions menu) with `openModal` action pointing to the batch pricing dashboard modal's `id`.

### Output Constraints

**Token limits:** Your max output is ~10,000 tokens. Plan your response to stay under this limit.

- Only output files that are directly required for the task
- Do NOT add README.md or documentation files unless explicitly requested

## Verification

After implementation, use [wix-cli-app-validation](../wix-cli-app-validation/SKILL.md) to validate TypeScript compilation, build, preview, and runtime behavior.
