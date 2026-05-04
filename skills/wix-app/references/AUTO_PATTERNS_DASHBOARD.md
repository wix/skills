# Auto Patterns Dashboard Page

Generates declarative `patterns.json` + thin `page.tsx` for simple CRUD dashboard pages using `@wix/auto-patterns`. Supports both creating new pages and updating existing ones.

## Quick Start Checklist

- [ ] **Step 1:** Determine if this is a new page or update to existing
- [ ] **Step 2:** For new pages — generate schema, run generator script, register extension
- [ ] **Step 2 (alt):** For existing pages — read `patterns.json`, consult references, edit directly
- [ ] **Step 3:** Install dependencies (`@wix/auto-patterns`, `@wix/patterns`)
- [ ] **Step 4:** Verify per [APP_VALIDATION.md](APP_VALIDATION.md)

---

## Core Rules

### Configuration Generation
1. **Analyze** schema requirements.
2. **Select** fields based on data types (max 3 initially).
3. **Validate** against the constraints below.

### Enum Handling
- **IF** `enumConfig` is required (implicit or explicit):
    - **THEN** ASK user for possible option values.
    - **THEN** Derive `label` from `value` (e.g., "dog" -> "Dog") unless specified.
    - **NEVER** guess or invent enum values.

### Structural Limits
- **MUST** have exactly 2 pages in `pages` array (`collectionPage` + `entityPage`).
- **MUST** have exactly 1 component with `layout` array in `collectionPage`.
- **MUST** use TypeScript for configuration.

### Field Selection
- **MAX** 3 columns initially for `collectionPage`.
- **MUST** include `create` action in `collectionPage` navigating to `entityPage`.
- **NEVER** fill optional fields unless explicitly requested.

### Type Binding
- **IF** `type: 'collectionPage'` **THEN** only `collectionPage` field allowed.
- **IF** `type: 'entityPage'` **THEN** only `entityPage` field allowed.
- **NEVER** mix types in single page config.

### Validation
- **MUST** align with `AppConfig` structure.
- **MUST** remove unsupported configuration entries.

---

## Part A: Creating a New Auto-Patterns Page

### Directory Layout

Create the page folder under `src/extensions/dashboard/pages/<page-name>/` with this structure:

```
src/extensions/dashboard/pages/<page-name>/
├── extensions.ts        # Extension registration
├── page.tsx             # Thin React wrapper (generated)
└── patterns.json        # Declarative AppConfig — edit this to iterate
```


### Step 1: Generate the Schema

You must produce the input JSON for the generator script. The schema has these parts:

**Collection info** (provided by orchestrator):
- `idSuffix` — the collection's short ID
- `fields` — array of `{ key, displayName, type }` (types: TEXT, NUMBER, BOOLEAN, DATE, IMAGE, URL, RICH_TEXT, etc.)
- `relevantCollectionId` — full scoped collection ID (e.g., `@namespace/my-collection`)

**Content fields** (20 string fields you generate):
- `collectionRouteId` — URL-friendly collection ID (kebab-case, e.g., "cool-gadgets")
- `singularEntityName` — URL-friendly singular form (e.g., "cool-gadget")
- `pageTitle` — Main page title (e.g., "Cool Gadgets Collection")
- `pageSubtitle` — Page description
- `actionButtonLabel` — Primary create button (e.g., "Add New Gadget")
- `toolbarTitle` — Table toolbar title
- `toolbarSubtitle` — Table toolbar subtitle
- `emptyStateTitle` — Title when no items exist
- `emptyStateSubtitle` — Empty state description
- `emptyStateButtonText` — Empty state CTA button text
- `deleteModalTitle` — Delete confirmation title
- `deleteModalDescription` — Delete confirmation description
- `deleteSuccessToast` — Delete success message
- `deleteErrorToast` — Delete error message
- `bulkDeleteModalTitle` — Bulk delete title
- `bulkDeleteModalDescription` — Bulk delete description
- `bulkDeleteSuccessToast` — Bulk delete success
- `bulkDeleteErrorToast` — Bulk delete error
- `entityPageTitle` — Entity detail page title
- `entityPageSubtitle` — Entity detail page subtitle

**Layout** — organize ALL collection fields into sections:
```json
{
  "main": [{ "title": "Basic Info", "subtitle": "Core details", "fields": ["field1", "field2"] }],
  "sidebar": [{ "title": "Status", "subtitle": "Metadata", "fields": ["isActive"] }]
}
```
Rules: Every field must appear exactly once. Main = user-facing content. Sidebar = metadata/status.

**Columns** — ordered list for the table view:
```json
[{ "id": "fieldKey", "displayName": "Short Name" }]
```
Include ALL fields, primary identifiers first. Display names target ≤10 characters.

**Grid item** (only if IMAGE fields exist, otherwise `null`):
```json
{ "titleFieldId": "name", "subtitleFieldId": "category", "imageFieldId": "photo" }
```

### Step 2: Run the Generator Script

Write the input JSON to a temp file and run the script:

```bash
# Write input to temp file
cat > /tmp/auto-patterns-input.json << 'EOF'
{
  "collection": { ... },
  "schema": { ... },
  "relevantCollectionId": "...",
  "extensionName": "My Extension Name"
}
EOF

# Run generator
node scripts/generate-auto-patterns.js --input /tmp/auto-patterns-input.json --output ./src/dashboard/pages/my-page/
```

The script produces:
- `patterns.json` — The declarative AppConfig
- `page.tsx` — Thin React wrapper component

### Step 3: Post-Generation Setup

1. **Create `extensions.ts`** in the page directory:

   **File:** `src/extensions/dashboard/pages/<page-name>/extensions.ts`

   ```typescript
   import { extensions } from "@wix/astro/builders";

   export const dashboardpageMyPage = extensions.dashboardPage({
     id: "{{GENERATE_UUID}}",
     title: "My Page",
     routePath: "my-page",
     component: "./extensions/dashboard/pages/my-page/page.tsx",
   });
   ```

   The `id` must be a unique, static UUID v4 string. Generate a fresh UUID for each extension — do NOT use `randomUUID()` or copy UUIDs from examples. Replace `{{GENERATE_UUID}}` with a freshly generated UUID like `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`.

2. **Register the extension** — see [EXTENSION_REGISTRATION.md](EXTENSION_REGISTRATION.md)

3. **Install dependencies**:
```bash
npm install @wix/auto-patterns @wix/patterns
```

### Step 4: Validate

Run validation per [APP_VALIDATION.md](APP_VALIDATION.md) to verify TypeScript compilation and build.

---

## Part B: Updating an Existing Auto-Patterns Page

When `patterns.json` already exists in a page directory, edit it directly. **This is the iteration model**: changes to layout, columns, actions, and content are made by editing JSON — `page.tsx` rarely changes. No React rewrite, no rebuild of CRUD logic.

### Step 1: Read the Existing Config

Read the current `patterns.json` to understand the configuration structure.

### Step 2: Consult Reference Documentation

Use the topic index below to find the right reference file for your change:

| Topic | Keywords | Reference File |
|-------|----------|---------------|
| AppConfig structure, page types, component types, page.tsx template | AppConfig, PageConfig, CollectionPageConfig, EntityPageConfig | [app-config-structure.md](auto-patterns-dashboard/app-config-structure.md) |
| Page setup, relationships, routing, URL configuration, sticky columns | page relationships, routing, entityPageId, parentPageId, route parameters | [pages-configuration.md](auto-patterns-dashboard/pages-configuration.md) |
| Collection page components, table/grid layouts, column configuration | table/grid configuration, columns, customColumns, view switching | [collection-page.md](auto-patterns-dashboard/collection-page.md) |
| Views configuration, presets, categories, filters integration | views, presets, categories, columnPreferences, filters, default view | [views.md](auto-patterns-dashboard/views.md) |
| Page-level actions, create actions, custom collection actions, row click actions | primaryActions, secondaryActions, onRowClick, action menus | [collection-page-actions.md](auto-patterns-dashboard/collection-page-actions.md) |
| Row-level actions, update/delete actions, custom row actions | actionCell, edit, delete, inline actions, custom resolver | [action-cell.md](auto-patterns-dashboard/action-cell.md) |
| Bulk operations, bulk delete, bulk action toolbar | bulk delete, multi-select actions, bulkActionToolbar | [bulk-actions.md](auto-patterns-dashboard/bulk-actions.md) |
| Entity page layout, grid system, field layout, containers | entity page layout, grid system, column spans, main/sidebar, 12-column grid | [entity-page.md](auto-patterns-dashboard/entity-page.md) |
| Entity page edit mode actions, moreActions, custom entity actions | edit mode actions, moreActions, duplicate, clone | [entity-page-actions.md](auto-patterns-dashboard/entity-page-actions.md) |
| Entity page view mode actions, primaryActions, secondaryActions | view mode actions, read-only entity actions, navigation actions | [entity-page-view-actions.md](auto-patterns-dashboard/entity-page-view-actions.md) |
| ResolvedAction interface, common return type for custom actions | ResolvedAction, label, icon, onClick, disabled, hidden, tooltip, skin | [resolved-action.md](auto-patterns-dashboard/resolved-action.md) |
| AppContext hook, shared collection data, refresh functionality | useAppContext, items, refreshCollection | [app-context.md](auto-patterns-dashboard/app-context.md) |
| SDK utilities, optimistic actions, schema access | AutoPatternsSDK, optimisticActions, getSchema, createOne, updateOne, deleteOne | [sdk-utilities.md](auto-patterns-dashboard/sdk-utilities.md) |
| Custom action resolvers, action overrides, useActions hook | custom actions, action resolver, useActions, ResolvedAction | [custom-actions-override.md](auto-patterns-dashboard/custom-actions-override.md) |
| Column rendering overrides, IColumnValue, custom column display | column override, IColumnValue, useColumns, custom rendering | [custom-columns-override.md](auto-patterns-dashboard/custom-columns-override.md) |
| Custom form components, useController, entity page customization | custom components, useComponents, useController, form, entity | [custom-components-override.md](auto-patterns-dashboard/custom-components-override.md) |
| Entity page header, dynamic subtitle, dynamic badges | header override, subtitle, badges, entityPageHeaderSubtitle, entityPageHeaderBadges | [custom-header-override.md](auto-patterns-dashboard/custom-header-override.md) |
| Table row grouping, section headers, section renderer | sections, grouping, useSections, section renderer, row grouping | [custom-sections-override.md](auto-patterns-dashboard/custom-sections-override.md) |
| Custom slot components, page slots, banners, informational sections | slots, useSlots, banner, custom content, top section | [custom-slots-override.md](auto-patterns-dashboard/custom-slots-override.md) |

### Step 3: Make Targeted Edits

Edit `patterns.json` based on the user's request. Key constraints:
- **Always 2 pages** — one `collectionPage` + one `entityPage`
- **Bidirectional linking** — `entityPageId` in collection component ↔ `parentPageId` in entity page
- **Max 3 columns initially** for new table views
- **`biName` is mandatory** for every action (kebab-case: `{action-purpose}-action`)
- **`customColumns.enabled: true`** when > 5 columns
- **Grid item only if IMAGE fields exist**
- **Route format**: entity page must be `/[segment]/:entityId`
- **Exactly 1 `appMainPage: true`** across all pages

If adding custom overrides (actions, columns, components, slots, etc.):
1. Create the override files in the appropriate `components/` subfolder
2. Update `page.tsx` to register overrides via `PatternsWizardOverridesProvider`
3. See the `custom-*-override.md` reference files for implementation patterns

---

## Non-Matching Intents

Do NOT use this skill when:
- User needs multi-collection data display → see [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md)
- User needs embedded script configuration → see [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md)
- User needs custom business logic or external APIs → see [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md)
- User needs a modal/popup → see [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md)
- User needs backend endpoints → see [BACKEND_API.md](BACKEND_API.md)

---

## Example patterns.json

See [auto-patterns-dashboard/example-patterns.json](auto-patterns-dashboard/example-patterns.json) for a complete working example.
