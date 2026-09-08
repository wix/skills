
# Wix Data Collection Builder

Creates CMS data collections for Wix CLI apps. The data collections extension allows your app to automatically create CMS collections when it's installed on a site. Collections store structured data that can be accessed from dashboard pages, site pages, backend code, and external applications.

**Important:** This extension automatically enables the site's code editor, which is required for the Wix Data APIs to work. Without this extension, apps using Data APIs would need the Wix user to manually enable the code editor on their site, which isn't guaranteed. With the data collections extension, your app can reliably use Data APIs to read and write data in the collections.

## Scaffold

Use `wix generate --params` with `extensionType: DATA_COLLECTION`. The only other param is `collectionName` (1-36 chars: letters, numbers, underscores, hyphens) — fields, permissions, displayName overrides, etc. are all edited after scaffolding in the generated file.

The CLI manages a shared aggregator file (`data-collections.extension.ts`) that imports every collection file and registers them in one `extensions.dataCollections({...})` builder. The aggregator and `src/extensions.ts` are updated automatically — don't edit them manually.

## App Namespace Handling

**App namespace is REQUIRED** for data collections to work. The namespace scopes your collection IDs to prevent conflicts between apps.

### Implementation Behavior

**If app namespace is provided in the prompt:**
- Use it in all code examples: `<actual-namespace>/collection-suffix`

**If app namespace is NOT provided:**
- Use the placeholder `<app-namespace>` in all code examples: `<app-namespace>/collection-suffix`
- Add to Manual Action Items: "Replace `<app-namespace>` with your actual app namespace from Wix Dev Center"

### Collection ID Format

- **In extension definition (`idSuffix`):** Use just the suffix, e.g., `"products"`. The CLI uses `collectionName` from the scaffold params as the `idSuffix` for the generated entry.
- **In API calls:** Use the full scoped ID: `"<app-namespace>/products"` — MUST match `idSuffix` exactly (case-sensitive, no camelCase/PascalCase transformation)
- **In `referencedCollectionId`:** Use the `idSuffix` only (not the full scoped ID) — the system resolves it automatically
- Example: If `idSuffix` is `"product-recommendations"`, API calls use `"<app-namespace>/product-recommendations"` NOT `"<app-namespace>/productRecommendations"`

## Collection File Shape

The CLI scaffolds `<CollectionName>.ts` as a `satisfies DataCollection` default export. The scaffolded `fields` and `dataPermissions` are placeholders — replace them with your real schema, and set permissions per [Permissions](data-collection/LIFECYCLE.md#permissions) before shipping.

**Import `DataCollection` from the package this project actually uses.** A standalone
`@wix/custom-extensions` project — what `wix generate` scaffolds today — emits
`from '@wix/custom-extensions'`; only an Astro project uses `'@wix/astro/builders'`. The scaffolded
file already has the right one: keep the import the CLI wrote and replace the body around it.

```typescript
import type { DataCollection } from '@wix/custom-extensions'; // or '@wix/astro/builders' in an Astro project

export const collectionIdSuffix = '<CollectionName>';

export default {
  idSuffix: collectionIdSuffix,
  displayName: '<CollectionName>',
  displayField: 'title',            // Field shown when referencing items
  fields: [ /* field definitions */ ],
  dataPermissions: { itemRead: 'ANYONE', itemInsert: 'PRIVILEGED', itemUpdate: 'PRIVILEGED', itemRemove: 'PRIVILEGED' },
  indexes: [],
  initialData: [],
} satisfies DataCollection;
```

## Schema, and getting the collection onto a site

Two leaf files carry the detail, so this file stays the workflow:

| You need | Read |
| --- | --- |
| Field types, field properties, indexes, naming, relationships, worked examples | [data-collection/SCHEMA.md](data-collection/SCHEMA.md) |
| Permissions, and why a collection isn't on the site yet: CMS prerequisite, release + update steps, item vs management scopes | [data-collection/LIFECYCLE.md](data-collection/LIFECYCLE.md) |

**Read LIFECYCLE.md before reporting completion.** Scaffolding and releasing both succeed while the
collection still does not exist on the site, and the steps that finish the job are manual ones you
have to surface — that gap is the single most common way this extension "silently doesn't work".


## Permissions

Access levels, the common patterns, and the context rules that decide which to use now live in
[data-collection/LIFECYCLE.md](data-collection/LIFECYCLE.md#permissions) — permissions are part of
getting a collection working on a real site, not part of writing its schema.

## Wix CLI-Specific Constraints

### When NOT to use a Collection

Collections are for **data**, not configuration:

- **Embedded script settings** → use `embeddedScriptParameters` instead.
- **Custom element widget settings** → use the widget's `panel.tsx` (settings panel) instead. A widget-only blueprint usually needs **zero** collections.
- **Single-value config** (theme, mode, threshold) → put it in the host extension's settings, not a one-field collection.
- **Computed / aggregated values** (averages, counts) → calculate dynamically, don't store.

Common values that do **not** belong in a collection: colors, fonts, sizes, headlines, labels, messages, dates/times, coupon codes, display positions, feature toggles, frequencies, numeric thresholds.

Collections are for: business data (products, orders, inventory), user-generated content (reviews, comments, submissions), event logs, and multi-record relational data.

### Initial Data Rules

Each item in `initialData` must match the collection schema exactly:

- Field keys must be `lowerCamelCase` and match the schema
- `TEXT` → string, `NUMBER` → number, `BOOLEAN` → boolean
- `DATE`/`DATETIME` → use `{ "$date": "2024-01-15T10:30:00.000Z" }` format
- `REFERENCE` → provide the `idSuffix` of the referenced collection
- Required fields must always have values

## Common Patterns

**Soft Delete:** Add `isDeleted` (BOOLEAN), defaulted at the insert path

**Status/Workflow:** Add `status` (TEXT) with values like draft/pending/published

**URL Slug:** Add `slug` (TEXT) plus a `{ fields: [{ path: 'slug' }], unique: true }` entry in `indexes` for SEO-friendly URLs

**Owner Tracking:** Add `createdBy` (REFERENCE → custom collection, not Members)

**Note:** For owner tracking, create a custom collection for users rather than referencing Wix Members directly.

## Reference Documentation

- [Wix Data SDK Reference](data-collection/WIX_DATA.md) - Complete reference for reading and writing data using `@wix/data`

### Public Documentation

- [About Data Collections Extensions](https://dev.wix.com/docs/build-apps/develop-your-app/extensions/backend-extensions/data-collections/about-data-collections-extensions) - When to use the extension, implementation options, and app version update behavior
- [Add a Data Collections Extension in the App Dashboard](https://dev.wix.com/docs/build-apps/develop-your-app/extensions/backend-extensions/data-collections/add-a-data-collections-extension-in-the-app-dashboard) - Step-by-step guide to configuring collections via the app dashboard JSON editor, with example configuration
- [Data Collections Extension JSON Reference](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections-extension/introduction) - Complete JSON schema and field definitions for the data collections extension
