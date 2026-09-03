---
name: "CMS Recipes"
description: "CMS collections and their data — create and change collection schemas, insert, query, update and delete items in bulk, manage multi-reference relationships, sell collection items through checkout, handle draft/publish collections, and link to the Content Manager dashboard. Use for anything users call CMS, collections, content manager, database, data items, records, or fields."
---

# CMS Recipes

Decide schema versus data first: **CMS Schema Management** creates and alters collections and their fields; everything else operates on items inside an existing collection. **CMS Data Items CRUD** is the default for reading and writing items, with **CMS Data Operations Extended** for count, upsert and update-by-filter. Two cases have their own recipes because the ordinary endpoints silently will not do the job: multi-reference fields can only be changed through the reference endpoints in **CMS References And Relationships**, and collections using the Draft Items plugin need **CMS Publishing Flow & Visible/Hidden** to reach published versus draft items. Use **CMS eCommerce Catalog Integration** when collection items must become purchasable.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [CMS Data Items CRUD](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-data-items-crud)
**Technical:** Add, query, update, and delete items in CMS collections. Use this to
insert content, bulk insert/update/patch/delete items, query with filters, and manage
collection data. Key endpoints: /wix-data/v2/items, /wix-data/v2/bulk/items/*.

### [CMS Data Operations Extended](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-data-operations-extended)
**Technical:** Additional CMS data operations including count, upsert (bulk save), and
update by filter patterns.

### [CMS Schema Management](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-schema-management)
**Technical:** Create and modify CMS collection structures. Covers listing collections,
creating collections with fields, adding/removing fields, and updating collection
settings.

### [CMS References And Relationships](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-references-and-relationships)
**Technical:** Add, replace, or remove items from MULTI_REFERENCE fields. Use
insert-references, replace-references, remove-references endpoints. Required for
managing multi-reference relationships - these CANNOT be set via regular
insert/update/patch operations. Also covers single references and querying with expanded
references.

### [CMS eCommerce Catalog Integration](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-e-commerce-catalog-integration)
**Technical:** The recommended way to sell existing CMS collection items (tickets,
bookings, memberships) through Wix checkout. Add the CATALOG plugin to convert any CMS
collection into purchasable products with cart and payment integration.

### [CMS Publishing Flow & Visible/Hidden](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/hidden)
**Technical:** Interact with CMS collections that gate their items behind a
draft/publish workflow via the Draft Items plugin. Covers detecting the plugin, locating
the paired drafts collection, reading published vs draft items, authoring/editing
drafts, and publishing, unpublishing, reverting, and deleting items. Key endpoints:
/wix-data/v2/items/publish-draft, /wix-data/v2/items/unpublish,
/wix-data/v2/collections/add-draft-items-plugin, and the paired drafts collection
referenced by draftItemsPluginOptions.draftsCollectionId.

### [CMS Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-dashboard-navigation)
**Technical:** Builds direct links to the Wix CMS (Content Manager) dashboard pages on
manage.wix.com — the collections list and a specific collection's items view. Pairs
collections and data items with their read APIs so you can fetch data and hand back a
'view it in your dashboard' link. Use when the user asks where something is in the Wix
dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to
include with the result of an API operation.
