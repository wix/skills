# Auto Patterns Dashboard Page

Generates declarative `patterns.json` + a thin page component (`<page-name>.tsx`) for simple CRUD dashboard pages using `@wix/auto-patterns`. Supports both creating new pages and updating existing ones.

## Quick Start Checklist

- [ ] **Step 1:** Determine if this is a new page or update to existing
- [ ] **Step 2:** For new pages — scaffold via `wix generate`, generate schema, run generator script
- [ ] **Step 2 (alt):** For existing pages — read `patterns.json`, consult references, edit directly
- [ ] **Step 3:** Install dependencies (`@wix/auto-patterns`, `@wix/patterns`)
- [ ] **Step 4:** Verify per [APP_VALIDATION.md](APP_VALIDATION.md)

---

## Required App Permissions

Auto-patterns calls `@wix/data` at runtime to CRUD the collection. The app must declare these scopes in the Wix Dev Center — they are NOT added automatically:

- `SCOPE.DC-DATA.READ` — for `get`, `query`, `count`, `distinct`
- `SCOPE.DC-DATA.WRITE` — for `insert`, `update`, `save`, `remove`, `bulk*`

Add them at: `https://manage.wix.com/apps/{app-id}/dev-center-permissions` (replace `{app-id}` with your app ID).

Without these scopes, the dashboard page renders but all data operations fail.

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

### Step 1: Scaffold the Dashboard Page

An auto-patterns page is a dashboard page — scaffold it with the Wix CLI:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

The CLI generates the page folder, the component stub `<page-name>.tsx`, the builder file `<page-name>.extension.ts` (which registers the extension and points its `component` at `<page-name>.tsx`), a unique UUID, and the `src/extensions.ts` registration — do NOT hand-write any of these. The folder name comes from `route`. After scaffolding, the page folder looks like this:

```
src/extensions/dashboard/pages/<page-name>/
├── <page-name>.extension.ts   # Builder file (generated — registration + UUID, component → <page-name>.tsx)
├── <page-name>.tsx            # CLI component stub (overwritten in Step 3)
└── patterns.json              # Declarative AppConfig — added in Step 3, edit this to iterate
```

> **Why this matters for Step 3:** the generator writes the auto-patterns wrapper to `<page-name>.tsx` — the SAME file the builder already registers — so it overwrites the stub and is wired up automatically. Do NOT let it produce a separate `page.tsx`; that would leave the wrapper unregistered next to the empty stub, and the dashboard would render blank.

### Step 2: Generate the Schema

You must produce the input JSON for the generator script. Top-level keys: `collection`, `schema`, `relevantCollectionId`, `extensionName`.

**`collection`** (from the data collection you scaffolded):

- `idSuffix` — the collection's short ID
- `fields` — array of `{ key, displayName, type }` (types: TEXT, NUMBER, BOOLEAN, DATE, IMAGE, URL, RICH_TEXT, etc.)

**`relevantCollectionId`** (top-level, sibling to `collection` and `schema`) — full scoped collection ID (e.g., `@namespace/my-collection`)

**`schema.content`** — 20 string fields you generate:

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

**`schema.layout`** — organize ALL collection fields into sections:

```json
{
  "main": [
    {
      "title": "Basic Info",
      "subtitle": "Core details",
      "fields": ["field1", "field2"]
    }
  ],
  "sidebar": [
    { "title": "Status", "subtitle": "Metadata", "fields": ["isActive"] }
  ]
}
```

Rules: Every field must appear exactly once. Main = user-facing content. Sidebar = metadata/status. If there are no sidebar-worthy fields, use `"sidebar": []`.

**`schema.columns`** — ordered list for the table view:

```json
[{ "id": "fieldKey", "displayName": "Short Name" }]
```

Include ALL fields, primary identifiers first. Display names target ≤10 characters.

**`schema.gridItem`** (only if IMAGE fields exist, otherwise `null`):

```json
{
  "titleFieldId": "name",
  "subtitleFieldId": "category",
  "imageFieldId": "photo"
}
```

> **🛑 Nesting is required.** Content, layout, columns, and gridItem are **not** top-level keys and **not** flat siblings under `schema`. The generator rejects flat shapes like `"schema": { "collectionRouteId": "...", "main": [...] }`. Always nest as `"schema": { "content": {...}, "layout": {...}, "columns": [...], "gridItem": null }`.

### Step 3: Run the Generator Script

The generator script is bundled with this skill at `<SKILL_ROOT>/scripts/generate-auto-patterns.js` — it is **not** copied into the user's app repo. Run it from the project directory using the skill's absolute path (`<SKILL_ROOT>` is the folder containing this skill's `SKILL.md`).

Write the input JSON to a temp file and run the script, pointing `--output` at the folder the CLI scaffolded in Step 1:

```bash
# Write input to temp file
cat > /tmp/auto-patterns-input.json << 'EOF'
{
  "collection": {
    "idSuffix": "<collection-id>",
    "fields": [
      { "key": "<field-key>", "displayName": "<Field Label>", "type": "<TYPE>" }
    ]
  },
  "schema": {
    "content": {
      "collectionRouteId": "<collection-route-id>",
      "singularEntityName": "<singular-entity-name>",
      "pageTitle": "<Page Title>",
      "pageSubtitle": "<Page subtitle>",
      "actionButtonLabel": "<Create button label>",
      "toolbarTitle": "<Toolbar title>",
      "toolbarSubtitle": "<Toolbar subtitle>",
      "emptyStateTitle": "<Empty state title>",
      "emptyStateSubtitle": "<Empty state subtitle>",
      "emptyStateButtonText": "<Empty state button>",
      "deleteModalTitle": "<Delete modal title>",
      "deleteModalDescription": "<Delete modal description>",
      "deleteSuccessToast": "<Delete success toast>",
      "deleteErrorToast": "<Delete error toast>",
      "bulkDeleteModalTitle": "<Bulk delete modal title>",
      "bulkDeleteModalDescription": "<Bulk delete modal description>",
      "bulkDeleteSuccessToast": "<Bulk delete success toast>",
      "bulkDeleteErrorToast": "<Bulk delete error toast>",
      "entityPageTitle": "<Entity page title>",
      "entityPageSubtitle": "<Entity page subtitle>"
    },
    "layout": {
      "main": [
        {
          "title": "<Section title>",
          "subtitle": "<Section subtitle>",
          "fields": ["<field-key>"]
        }
      ],
      "sidebar": []
    },
    "columns": [
      { "id": "<field-key>", "displayName": "<Short Name>" }
    ],
    "gridItem": null
  },
  "relevantCollectionId": "@<namespace>/<collection-id>",
  "extensionName": "<Extension Name>"
}
EOF

# Run generator
node <SKILL_ROOT>/scripts/generate-auto-patterns.js --input /tmp/auto-patterns-input.json --output ./src/extensions/dashboard/pages/<page-name>/
```

The `--output` directory MUST be the exact folder the CLI scaffolded in Step 1 — the script derives the component filename from that folder's name.

The script produces:

- `patterns.json` — The declarative AppConfig
- `<page-name>.tsx` — Thin React wrapper component, written to the SAME filename the CLI scaffolded and the builder already registers (overwrites the stub)

The builder file (`<page-name>.extension.ts`) and `src/extensions.ts` registration from Step 1 stay as-is — no manual registration edit, and no stray `page.tsx`.

### Step 4: Install Dependencies

The CLI template pins `@wix/auto-patterns` and `@wix/patterns` to exact versions — keep it that way. Check `package.json` first: if both are already in `dependencies`, **skip this step**.

If one is missing, install only that package:

```bash
npm install --save-exact <missing-package>
```

### Step 5: Validate

Run validation per [APP_VALIDATION.md](APP_VALIDATION.md) to verify TypeScript compilation and build.

---

## Part B: Updating an Existing Auto-Patterns Page

> **🛑 STOP — UI changes go through overrides, NOT page-component edits.**
> If you're adding a banner, custom header, action, slot, custom column rendering, or row sectioning to an auto-patterns page, you MUST use the matching `custom-*-override.md` reference (see the topic index in Step 2). Do NOT add the UI by hand-writing JSX in the page component (`<page-name>.tsx`) — that bypasses the override registration and breaks the iteration model.

When `patterns.json` already exists in a page directory, edit it directly. **This is the iteration model**: changes to layout, columns, actions, and content are made by editing JSON — the page component (`<page-name>.tsx`) only changes to register new overrides. No React rewrite, no rebuild of CRUD logic.

> **Component filename:** the page component is `<page-name>.tsx` (the file the CLI scaffolded and the `<page-name>.extension.ts` builder registers). The override reference files below say "`page.tsx`" as shorthand for this component — edit the existing `<page-name>.tsx`; **never create a new `page.tsx`**, or it will sit unregistered next to the real component.

### Step 1: Read the Existing Config

Read the current `patterns.json` to understand the configuration structure.

### Step 2: Consult Reference Documentation

Use the topic index below to find the right reference file for your change:

| Topic                                                                            | Keywords                                                                            | Reference File                                                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AppConfig structure, page types, component types, page.tsx template              | AppConfig, PageConfig, CollectionPageConfig, EntityPageConfig                       | [app-config-structure.md](auto-patterns-dashboard/app-config-structure.md)             |
| Page setup, relationships, routing, URL configuration, sticky columns            | page relationships, routing, entityPageId, parentPageId, route parameters           | [pages-configuration.md](auto-patterns-dashboard/pages-configuration.md)               |
| Collection page components, table/grid layouts, column configuration             | table/grid configuration, columns, customColumns, view switching                    | [collection-page.md](auto-patterns-dashboard/collection-page.md)                       |
| Views configuration, presets, categories, filters integration                    | views, presets, categories, columnPreferences, filters, default view                | [views.md](auto-patterns-dashboard/views.md)                                           |
| Page-level actions, create actions, custom collection actions, row click actions | primaryActions, secondaryActions, onRowClick, action menus                          | [collection-page-actions.md](auto-patterns-dashboard/collection-page-actions.md)       |
| Row-level actions, update/delete actions, custom row actions                     | actionCell, edit, delete, inline actions, custom resolver                           | [action-cell.md](auto-patterns-dashboard/action-cell.md)                               |
| Bulk operations, bulk delete, bulk action toolbar                                | bulk delete, multi-select actions, bulkActionToolbar                                | [bulk-actions.md](auto-patterns-dashboard/bulk-actions.md)                             |
| Entity page layout, grid system, field layout, containers                        | entity page layout, grid system, column spans, main/sidebar, 12-column grid         | [entity-page.md](auto-patterns-dashboard/entity-page.md)                               |
| Entity page edit mode actions, moreActions, custom entity actions                | edit mode actions, moreActions, duplicate, clone                                    | [entity-page-actions.md](auto-patterns-dashboard/entity-page-actions.md)               |
| Entity page view mode actions, primaryActions, secondaryActions                  | view mode actions, read-only entity actions, navigation actions                     | [entity-page-view-actions.md](auto-patterns-dashboard/entity-page-view-actions.md)     |
| ResolvedAction interface, common return type for custom actions                  | ResolvedAction, label, icon, onClick, disabled, hidden, tooltip, skin               | [resolved-action.md](auto-patterns-dashboard/resolved-action.md)                       |
| AppContext hook, shared collection data, refresh functionality                   | useAppContext, items, refreshCollection                                             | [app-context.md](auto-patterns-dashboard/app-context.md)                               |
| SDK utilities, optimistic actions, schema access                                 | AutoPatternsSDK, optimisticActions, getSchema, createOne, updateOne, deleteOne      | [sdk-utilities.md](auto-patterns-dashboard/sdk-utilities.md)                           |
| Custom action resolvers, action overrides, useActions hook                       | custom actions, action resolver, useActions, ResolvedAction                         | [custom-actions-override.md](auto-patterns-dashboard/custom-actions-override.md)       |
| Column rendering overrides, IColumnValue, custom column display                  | column override, IColumnValue, useColumns, custom rendering                         | [custom-columns-override.md](auto-patterns-dashboard/custom-columns-override.md)       |
| Custom form components, useController, entity page customization                 | custom components, useComponents, useController, form, entity                       | [custom-components-override.md](auto-patterns-dashboard/custom-components-override.md) |
| Entity page header, dynamic subtitle, dynamic badges                             | header override, subtitle, badges, entityPageHeaderSubtitle, entityPageHeaderBadges | [custom-header-override.md](auto-patterns-dashboard/custom-header-override.md)         |
| Table row grouping, section headers, section renderer                            | sections, grouping, useSections, section renderer, row grouping                     | [custom-sections-override.md](auto-patterns-dashboard/custom-sections-override.md)     |
| Custom slot components, page slots, banners, informational sections              | slots, useSlots, banner, custom content, top section                                | [custom-slots-override.md](auto-patterns-dashboard/custom-slots-override.md)           |

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
2. Update the page component (`<page-name>.tsx`) to register overrides via `PatternsWizardOverridesProvider`
3. See the `custom-*-override.md` reference files for implementation patterns

> **🛑 Overrides ALWAYS go in their own file under `components/<type>/`** (e.g. `components/columns/status.tsx`) with a `use*` hook — **regardless of size, even for a single small override.** This is structural, required by the override-registration model. **Never inline override render logic in the page component** (`<page-name>.tsx`), and do NOT apply the general ~300-line "split only if large" rule here — it does not override this requirement.

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
