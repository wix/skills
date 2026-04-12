---
name: wix-cli-auto-patterns-dashboard
description: Use when building simple CRUD dashboard pages that manage a single data collection with standard table/grid views and basic entity forms. Triggers include auto-patterns, simple dashboard, CRUD page, collection management, patterns.json.
compatibility: Requires Wix CLI development environment.
---

# Auto Patterns Dashboard Page

Generates declarative `patterns.json` + thin `page.tsx` for simple CRUD dashboard pages using `@wix/auto-patterns`. Supports both creating new pages and updating existing ones.

## Quick Start Checklist

- [ ] **Step 1:** Determine if this is a new page or update to existing
- [ ] **Step 2:** For new pages — generate schema, run generator script, register extension
- [ ] **Step 2 (alt):** For existing pages — read `patterns.json`, consult references, edit directly
- [ ] **Step 3:** Install dependencies (`@wix/auto-patterns`, `@wix/patterns`)
- [ ] **Step 4:** Verify with `wix-cli-app-validation`

---

## When to Use Auto Patterns

**Use auto patterns when ALL are true:**
- Single-collection CRUD operations (Create, Read, Update, Delete)
- Standard table/grid views with sorting and filtering
- Basic form layouts for entity pages
- No custom business logic or calculations
- No embedded script configuration
- No external API integrations

**Use custom code (`wix-cli-dashboard-page`) when ANY are true:**
- Multi-collection data joining or aggregation
- Custom business logic or calculations
- External API integrations or webhooks
- Embedded script parameter management
- Custom UI components beyond standard forms/tables
- Complex workflows or state management
- Advanced search or filtering logic

---

## Part A: Creating a New Auto-Patterns Page

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
```typescript
import { createDashboardExtension } from '@wix/cli-app';

export const myPageExtension = createDashboardExtension();
```

2. **Register the extension** — follow `wix-cli-extension-registration` skill

3. **Install dependencies**:
```bash
npm install @wix/auto-patterns @wix/patterns
```

### Step 4: Validate

Run `wix-cli-app-validation` to verify TypeScript compilation and build.

---

## Part B: Updating an Existing Auto-Patterns Page

When `patterns.json` already exists in a page directory, edit it directly.

### Step 1: Read the Existing Config

Read the current `patterns.json` to understand the configuration structure.

### Step 2: Consult Reference Documentation

Use the topic index below to find the right reference file for your change:

| Topic | Keywords | Reference File |
|-------|----------|---------------|
| Core rules, structural limits, field selection, validation | configuration generation, enum handling, constraints | [introduction.md](references/introduction.md) |
| AppConfig structure, page types, component types, page.tsx template | AppConfig, PageConfig, CollectionPageConfig, EntityPageConfig | [app-config-structure.md](references/app-config-structure.md) |
| Page setup, relationships, routing, URL configuration, sticky columns | page relationships, routing, entityPageId, parentPageId, route parameters | [pages-configuration.md](references/pages-configuration.md) |
| Collection page components, table/grid layouts, column configuration | table/grid configuration, columns, customColumns, view switching | [collection-page.md](references/collection-page.md) |
| Views configuration, presets, categories, filters integration | views, presets, categories, columnPreferences, filters, default view | [views.md](references/views.md) |
| Page-level actions, create actions, custom collection actions, row click actions | primaryActions, secondaryActions, onRowClick, action menus | [collection-page-actions.md](references/collection-page-actions.md) |
| Row-level actions, update/delete actions, custom row actions | actionCell, edit, delete, inline actions, custom resolver | [action-cell.md](references/action-cell.md) |
| Bulk operations, bulk delete, bulk action toolbar | bulk delete, multi-select actions, bulkActionToolbar | [bulk-actions.md](references/bulk-actions.md) |
| Entity page layout, grid system, field layout, containers | entity page layout, grid system, column spans, main/sidebar, 12-column grid | [entity-page.md](references/entity-page.md) |
| Entity page edit mode actions, moreActions, custom entity actions | edit mode actions, moreActions, duplicate, clone | [entity-page-actions.md](references/entity-page-actions.md) |
| Entity page view mode actions, primaryActions, secondaryActions | view mode actions, read-only entity actions, navigation actions | [entity-page-view-actions.md](references/entity-page-view-actions.md) |
| ResolvedAction interface, common return type for custom actions | ResolvedAction, label, icon, onClick, disabled, hidden, tooltip, skin | [resolved-action.md](references/resolved-action.md) |
| AppContext hook, shared collection data, refresh functionality | useAppContext, items, refreshCollection | [app-context.md](references/app-context.md) |
| SDK utilities, optimistic actions, schema access | AutoPatternsSDK, optimisticActions, getSchema, createOne, updateOne, deleteOne | [sdk-utilities.md](references/sdk-utilities.md) |
| Custom action resolvers, action overrides, useActions hook | custom actions, action resolver, useActions, ResolvedAction | [custom-actions-override.md](references/custom-actions-override.md) |
| Column rendering overrides, IColumnValue, custom column display | column override, IColumnValue, useColumns, custom rendering | [custom-columns-override.md](references/custom-columns-override.md) |
| Custom form components, useController, entity page customization | custom components, useComponents, useController, form, entity | [custom-components-override.md](references/custom-components-override.md) |
| Entity page header, dynamic subtitle, dynamic badges | header override, subtitle, badges, entityPageHeaderSubtitle, entityPageHeaderBadges | [custom-header-override.md](references/custom-header-override.md) |
| Table row grouping, section headers, section renderer | sections, grouping, useSections, section renderer, row grouping | [custom-sections-override.md](references/custom-sections-override.md) |
| Custom slot components, page slots, banners, informational sections | slots, useSlots, banner, custom content, top section | [custom-slots-override.md](references/custom-slots-override.md) |

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
- User needs multi-collection data display → use `wix-cli-dashboard-page`
- User needs embedded script configuration → use `wix-cli-dashboard-page`
- User needs custom business logic or external APIs → use `wix-cli-dashboard-page`
- User needs a modal/popup → use `wix-cli-dashboard-modal`
- User needs backend endpoints → use `wix-cli-backend-api`

---

## Example patterns.json

See [assets/example-patterns.json](assets/example-patterns.json) for a complete working example.
