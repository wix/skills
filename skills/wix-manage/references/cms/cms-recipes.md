---
name: "CMS Recipes"
description: "CMS collections and their data — create and change collection schemas, insert, query, update and delete items in bulk, manage multi-reference relationships, sell collection items through checkout, handle draft/publish collections, and link to the Content Manager dashboard. Use for anything users call CMS, collections, content manager, database, data items, records, or fields."
---

# CMS Recipes

Decide schema versus data first: **CMS Schema Management** creates and alters collections and their fields; everything else operates on items inside an existing collection. **CMS Data Items CRUD** is the default for reading and writing items, with **CMS Data Operations Extended** for count, upsert and update-by-filter. Two cases have their own recipes because the ordinary endpoints silently will not do the job: multi-reference fields can only be changed through the reference endpoints in **CMS References And Relationships**, and collections using the Draft Items plugin need **CMS Publishing Flow & Visible/Hidden** to reach published versus draft items. Use **CMS eCommerce Catalog Integration** when collection items must become purchasable.

## Recipes

### [CMS Data Items CRUD](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-data-items-crud)
Use for the everyday item work: insert, query with filters, update, patch, delete, and the bulk variants.

### [CMS Data Operations Extended](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-data-operations-extended)
Use for count, upsert / bulk save, and update-by-filter operations.

### [CMS Schema Management](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-schema-management)
Use when the collection itself must change: listing collections, creating one, adding or removing fields, collection settings.

### [CMS References And Relationships](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-references-and-relationships)
Use for MULTI_REFERENCE fields — these cannot be set through ordinary insert or update calls.

### [CMS eCommerce Catalog Integration](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-e-commerce-catalog-integration)
Use when collection items (tickets, memberships, bookings) should be sold through Wix checkout.

### [CMS Publishing Flow & Visible/Hidden](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/hidden)
Use when a collection gates items behind draft/publish — detecting the plugin, finding the drafts collection, reading and authoring either version.

### [CMS Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-dashboard-navigation)
Use when the user wants the collections list or a specific collection's items view.
