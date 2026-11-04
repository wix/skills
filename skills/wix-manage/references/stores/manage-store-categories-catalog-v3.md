---
name: "Manage Store Categories (Catalog V3)"
description: "Organizes a Wix Store's products into categories with the Catalog V3 Categories API. Covers listing the category tree and finding a category by name; creating categories and subcategories; renaming a category or changing its description or URL slug; hiding or showing it; reordering it or moving it under another parent; deleting it; and adding products to a category, removing them, listing what a category holds, or moving all of a category's products to another category. Use when the user wants to see, set up, reorganize or clean up their store categories, or asks which products are in a category."
---

# Manage Store Categories (Catalog V3)

> These calls need the Wix Stores app on the site (`appDefId` `215238eb-22a5-4c36-9e7b-e7c08025e04e`); a `428`, a `400` naming the app, or an empty result on a site that should have content means it is not there. [List Installed Apps](../app-installation/list-installed-apps.md) shows what the site has; [Install Wix Apps](../app-installation/install-wix-apps.md) adds it by that id.

Wix Stores categories form one tree per site, up to 4 levels deep and up to 1,000 categories. A product can be in any number of categories.

This recipe is for Catalog V3 stores. When the site's catalog version is not known, call `GET https://www.wixapis.com/stores/v3/provision/version`: continue only when `catalogVersion` is `V3_CATALOG`. For `V1_CATALOG`, the store groups products in collections, not categories, and none of the calls below work: tell the user so, and give them the dashboard link to their products from [Stores Dashboard Navigation](stores-dashboard-navigation.md).

Every [Categories API](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/introduction) call (`/categories/v1/...`) needs the store's tree reference. The Stores calls (`/stores/v3/...`) and the async-jobs call in step 5 do not take it.

- In a request body: `"treeReference": { "appNamespace": "@wix/stores" }` at the top level, beside `category`. Inside `category` it is ignored and the call returns `400 treeReference must not be empty`.
- In a GET or DELETE URL: the query parameter `?treeReference.appNamespace=@wix/stores`.

Every call in this recipe is complete and was run as written on a live store: send it as shown, without looking up its docs page or method schema first. Look up a schema only for a field this recipe does not show.

A product is referenced as an item: `{ "catalogItemId": "<product id>", "appId": "215238eb-22a5-4c36-9e7b-e7c08025e04e" }`. The `appId` is Wix Stores and is the same for every product.

**Confirmation.** A request that names the category and the change ("create a category Shoes", "rename Dresses to Beauty", "move all products from Pipes to Pipes > Brass") is the user's confirmation: make the change. Ask first when:
- several categories match the name the user gave (list them with their parent);
- you decide which products go where (for example "sort my products into categories"): show the plan, category by category, and apply it after the user agrees;
- the user asks to delete a category that has subcategories or products: say how many of each are affected, because deleting also deletes the subcategories.

## Step 1: Read the category tree

`POST https://www.wixapis.com/categories/v1/categories/query`

```bash
curl -X POST 'https://www.wixapis.com/categories/v1/categories/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "treeReference": { "appNamespace": "@wix/stores" },
  "returnNonVisibleCategories": true,
  "fields": ["BREADCRUMBS_INFO"],
  "query": { "cursorPaging": { "limit": 1000 } }
}'
```

Without `"returnNonVisibleCategories": true`, hidden categories (and the subcategories of a hidden category) are left out. The categories are in `categories[]`:

| Field | What it holds |
|---|---|
| `id`, `revision` | `id` for every change; the current `revision` for Update Category and Update Category Visibility |
| `name` | The category's own name; a subcategory's name does not include its parent's |
| `parentCategory.id` | The parent's ID; missing for a top-level category |
| `parentCategory.index` | Position among its siblings, from 1 |
| `visible` | Whether site visitors see it |
| `itemCounter` | Products directly in this category, not counting its subcategories. It follows a change late (seconds, once over a minute), so count with list-items (step 5) right after products were added or removed |
| `slug` | The category page's URL path |
| `breadcrumbsInfo.breadcrumbs[]` | Ancestors from the top level down, each with `categoryId` and `categoryName` (only with `BREADCRUMBS_INFO`) |

To show the tree, group the categories by `parentCategory.id` and order each group by `parentCategory.index`; the response order is not the display order. When you list categories for the user, mark each hidden one (`visible: false`) in the answer, for example "Sale (hidden)": the user cannot tell from a name alone that visitors do not see it.

**Find a category by name.** Filter on `name`, with the other fields of the request above unchanged:

```json
"query": { "filter": { "name": "Dresses" } }
```

`name` matching ignores case for `$eq` and `$startsWith`. `$contains` returns `400`. Names are not unique: two categories can have the same name, under the same parent or different ones. When the user names a subcategory by its path ("Pipes/Brass"), find the parent by name, then filter on `"parentCategory.id": "<parent id>"` and match the child's `name`, or read the path from `breadcrumbsInfo`.

**Paging.** A store has at most 1,000 categories, so one request with `limit: 1000` returns all of them. With a smaller limit, while `pagingMetadata.hasNext` is `true`, send `"query": { "cursorPaging": { "limit": <same limit>, "cursor": "<pagingMetadata.cursors.next>" } }` with the same `treeReference` and `returnNonVisibleCategories`. A cursor sent together with a `filter` or `sort` returns `400 INVALID_CURSOR`.

**All Products.** Every store has a system category named "All Products" that holds every product. `GET https://www.wixapis.com/stores/v3/all-products-category` returns its ID in `categoryId`. Leave it out of every change in this recipe, and do not count it as one of the user's categories.

## Step 2: Create a category

The API does not stop a duplicate: Create Category with a name that already exists under the same parent makes a second category with that name and a slug such as `shoes-1`. "Create a Shoes category" does not mean that no Shoes category exists. So, for every category the request names, the parents included, do these in this order before any create call:

1. Look it up: Query Categories (step 1) with `"returnNonVisibleCategories": true` and `"query": { "filter": { "name": "<name>" } }`. Keep the result whose `parentCategory.id` is the intended parent's ID (no `parentCategory.id` for a top-level category).
2. Found: use its `id` and do not create it.
3. Not found: create it with `POST https://www.wixapis.com/categories/v1/categories` (below).

Keep track of which categories you created and which already existed, and say so in the answer ("Shoes already existed; I created Sneakers under it"), never "created" for one that existed.

```bash
curl -X POST 'https://www.wixapis.com/categories/v1/categories' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "category": { "name": "Shoes" },
  "treeReference": { "appNamespace": "@wix/stores" }
}'
```

- **Subcategory:** add `"parentCategory": { "id": "<parent id>" }` to `category`. Without it, the category is created at the top level.
- **Description:** add `"description": "<plain text, up to 600 characters>"`. It is returned only when the request has `"fields": ["DESCRIPTION"]`.
- **Hidden from the start:** add `"visible": false`. Under a hidden parent, always send `"visible": false`: `"visible": true` returns `428 PARENT_CATEGORY_HIDDEN`, and a category created without `visible` reports `visible: true` although its parent hides it.

The new category is in `category`, with its `id`, `revision` and `parentCategory.id`; a `200` with this body is the proof that it exists, so do not query or read it again to confirm. The new category is last among its siblings; to place it elsewhere, move it (step 4).

## Step 3: Rename, describe or change the slug

`PATCH https://www.wixapis.com/categories/v1/categories/<CATEGORY_ID>`

Send the `id`, the current `revision` from step 1 and only the fields that change. Fields you leave out keep their values.

```bash
curl -X PATCH 'https://www.wixapis.com/categories/v1/categories/<CATEGORY_ID>' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "category": { "id": "<CATEGORY_ID>", "revision": "<CURRENT_REVISION>", "name": "Beauty" },
  "treeReference": { "appNamespace": "@wix/stores" }
}'
```

- A rename keeps the old `slug`, so the category page's URL still shows the old name. Send `"slug": "beauty"` in the same request when the user wants the URL to match.
- A `revision` that is not current returns `409 INVALID_REVISION`: read the category again and resend.
- This call cannot hide, show or move a category. A `visible` or `parentCategory` sent here is ignored: the call returns `200` and increases `revision`, but the value does not change. Use step 4.

## Step 4: Hide, show, reorder, move or delete

**Hide or show:** `PATCH https://www.wixapis.com/categories/v1/categories/visibility`

```bash
curl -X PATCH 'https://www.wixapis.com/categories/v1/categories/visibility' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "categoryId": "<CATEGORY_ID>",
  "revision": "<CURRENT_REVISION>",
  "visible": false,
  "treeReference": { "appNamespace": "@wix/stores" }
}'
```

Hiding a category also hides all its subcategories, and increases their `revision`. Showing it again does not show its subcategories: they stay hidden, and after the hide nothing records which of them were visible before. So:

- **When you hide a category**, read the whole tree first (step 1 without a `name` filter; a query filtered on the name returns only that category), take the visible categories below it (children, and their children), hide it, and name them in the answer: "Hiding <name> also hid its subcategories <names>. Showing <name> again does not show them; each one has to be shown again."
- **To show a category whose subcategories are hidden**, show the category, then list its hidden subcategories and ask which ones to show. Read the tree again and show each one the user picks, with its new `revision`. When the user asked to show the category "with everything in it", show all of them without asking.

Showing a subcategory while its parent is hidden returns `428 PARENT_CATEGORY_HIDDEN`. Hidden categories keep their products.

**Reorder or move:** `POST https://www.wixapis.com/categories/v1/categories/<CATEGORY_ID>/move`

```bash
curl -X POST 'https://www.wixapis.com/categories/v1/categories/<CATEGORY_ID>/move' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "treeReference": { "appNamespace": "@wix/stores" },
  "parentCategoryId": "<PARENT_ID>",
  "position": "FIRST"
}'
```

- `position` is required (without it the call returns `400`): `FIRST`, `LAST`, or `AFTER` with `"moveAfterCategoryId": "<sibling id>"` (a category under the same target parent).
- `parentCategoryId` is the parent the category ends up under. To reorder a category within its current parent, send that parent's ID. To place it at the top level, leave `parentCategoryId` out; leaving it out for a subcategory moves the subcategory to the top level.
- The response holds `categoriesAfterMove`, the sibling IDs in their new order. A read in the next few seconds can still show the old parent; trust the response.
- A move that would go deeper than 4 levels returns `428 CATEGORY_DEPTH_LIMIT_EXCEEDED`.

**Delete:** `DELETE https://www.wixapis.com/categories/v1/categories/<CATEGORY_ID>?treeReference.appNamespace=@wix/stores`

Deleting a category also deletes all its subcategories. Its products stay in the store and in their other categories. The response is `{}`.

Before the delete, count what it affects:
- the subcategories: read the whole tree (step 1 without a `name` filter) and take the categories below it (children, and their children);
- the products: list-items on the category (step 5) with `"includeItemsFromSubcategories": true`, with duplicate IDs removed.

When it has neither, delete it. When it has subcategories or products, do not delete yet: name the subcategories and say how many products are in it, that the subcategories are deleted with it, and that the products stay in the store. Then ask the user to confirm (see **Confirmation**). To keep the subcategories, move them out first. To keep the products in another category, move them first (step 5).

## Step 5: Products in categories

**Which products are in a category:** `POST https://www.wixapis.com/categories/v1/categories/<CATEGORY_ID>/list-items`

```bash
curl -X POST 'https://www.wixapis.com/categories/v1/categories/<CATEGORY_ID>/list-items' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "treeReference": { "appNamespace": "@wix/stores" },
  "cursorPaging": { "limit": 100 }
}'
```

The products are in `items[]`, with `catalogItemId` (the product ID). The response has no `hasNext`: while `pagingMetadata.cursors.next` is present, send the same request with `"cursorPaging": { "limit": 100, "cursor": "<pagingMetadata.cursors.next>" }`. To get the names, send up to 100 IDs to Query Products (`POST https://www.wixapis.com/stores/v3/products/query` with `{ "query": { "filter": { "id": { "$in": ["<product id>"] } }, "cursorPaging": { "limit": 100 } } }`; the names are in `products[].name`). `"includeItemsFromSubcategories": true` adds the products of subcategories, and lists a product once for each category it is in, so remove duplicate IDs.

**Which categories a product is in:** `POST https://www.wixapis.com/categories/v1/categories/list-categories-for-items` with `{ "items": [<up to 100 items>], "treeReference": { "appNamespace": "@wix/stores" } }`. Each entry of `categoriesForItems[]` has the `item`, `directCategoryIds` (this includes All Products) and `indirectCategoryIds` (ancestors of those categories).

**Add products to one category:** `POST https://www.wixapis.com/categories/v1/bulk/categories/<CATEGORY_ID>/add-items`

```bash
curl -X POST 'https://www.wixapis.com/categories/v1/bulk/categories/<CATEGORY_ID>/add-items' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "items": [
    { "catalogItemId": "<product id>", "appId": "215238eb-22a5-4c36-9e7b-e7c08025e04e" },
    { "catalogItemId": "<product id>", "appId": "215238eb-22a5-4c36-9e7b-e7c08025e04e" }
  ],
  "treeReference": { "appNamespace": "@wix/stores" }
}'
```

Send up to 100 items per request. To add one product to several categories, use `POST https://www.wixapis.com/categories/v1/bulk/categories/add-item` with `{ "item": { "catalogItemId": "<product id>", "appId": "215238eb-22a5-4c36-9e7b-e7c08025e04e" }, "categoryIds": ["<category id>", "<category id>"], "treeReference": { "appNamespace": "@wix/stores" } }`. To find a product's ID by its name, search for it:

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "search": { "search": { "expression": "Baseball Cap", "fields": ["name"], "fuzzy": false } } }'
```

The products are in `products[]`, with `id` and `name`; the search ignores case and also matches part of a name, so pick the product whose `name` matches the user's wording, and ask when several do. For other ways to find products, see [Find Products](find-products-query-and-search-catalog-v3.md).

**Remove products from one category:** `POST https://www.wixapis.com/categories/v1/bulk/categories/<CATEGORY_ID>/remove-items`, with the same body as add-items and up to 100 items. The products stay in the store.

The bulk calls return `200` even when some items fail. Read `bulkActionMetadata.totalSuccesses` and `totalFailures`. Each entry of `results[]` names its product in `itemMetadata.item.catalogItemId`, with `itemMetadata.success` and, for a failure, `itemMetadata.error.code`; match results to products on that ID, not on their order. A response with `totalFailures: 0` proves the change: do not list the category again to confirm it, unless the user asked for the new contents. `ALREADY_EXISTS` (on add) and `ITEM_NOT_IN_CATEGORY` (on remove) mean the product was already in the requested state: count it as done, not as an error.

**Move all products of one category to another** ("move everything in Pipes to the Brass subcategory"). Do these in this order:

1. List the source category's products with list-items, every page, and keep their IDs.
2. Add those products to the target category with add-items, up to 100 per request.
3. Then remove from the source category, with remove-items (up to 100 per request), only the products whose add succeeded or returned `ALREADY_EXISTS`. A product whose add failed with any other code stays in the source category, so it is not lost. Removing first can lose products when an add fails.
4. Report how many products moved, and name each product that did not move with its error code. To check, list the items of both categories.

**Large categories.** For a source category with more than 1,000 products (`itemCounter` above 1000, or more than 10 pages of list-items), the by-filter methods do the same move in two calls. Do these in this order:

1. Add the products to the target category by filter:

   ```bash
   curl -X POST 'https://www.wixapis.com/stores/v3/bulk/products/add-to-categories-by-filter' \
   -H 'Content-Type: application/json' \
   -H 'Authorization: <AUTH>' \
   -d '{
     "categoryIds": ["<TARGET_CATEGORY_ID>"],
     "filter": { "directCategoriesInfo.categories": { "$matchItems": [{ "id": "<SOURCE_CATEGORY_ID>" }] } }
   }'
   ```

   Write the filter key as one dotted string, `"directCategoriesInfo.categories"`, as above. A nested object (`{ "directCategoriesInfo": { "categories": ... } }`) is accepted here with a `jobId`, but the job stays `INITIALIZED` and never runs.
2. The response holds a `jobId`. Read the job with `GET https://www.wixapis.com/async-jobs/v1/async-jobs/<jobId>` every second or two until `job.status` is `FINISHED` (or `FAILED`); it usually takes a few seconds. A job still `INITIALIZED` after 15 seconds has an invalid filter: stop, and check the filter with Search Products (below), which returns `400` for it. `job.counts.successCount` is the number of products added. Failures with the code `ALREADY_EXISTS` in `job.counts.errorByCodeCount` were already in the target.
3. Only after the job is `FINISHED` and `job.counts.errorByCodeCount` holds no code other than `ALREADY_EXISTS`, remove the products from the source category with `POST https://www.wixapis.com/stores/v3/bulk/products/remove-from-categories-by-filter` and the same filter, with `"categoryIds": ["<SOURCE_CATEGORY_ID>"]`. Read its job the same way. Removing first would leave the add filter with no products to match.
4. List the target's items. A product added to the source in the last few seconds can be missed by the add but caught by the remove; add any such product to the target with add-items.

   When the add job is `FAILED`, remove nothing and tell the user. When it holds another error code, do not remove by filter: list the items of both categories, remove from the source with remove-items only the source's products that are now in the target, and name the rest in the answer.

The filter is a Search Products filter; `categoryIds` takes up to 5 categories. The by-filter methods and Search Products read a search index that shows a category change a few seconds late, so they can miss a product added to the source category in the last few seconds. To find products by category in Search Products (`POST https://www.wixapis.com/stores/v3/products/search`), use the same filter: `{ "search": { "filter": { "directCategoriesInfo.categories": { "$matchItems": [{ "id": "<category id>" }] } } } }`; `allCategoriesInfo.categories` with the same shape also matches the products of its subcategories.

**Sort products into categories** ("organize my products by type"): read the products with [Find Products](find-products-query-and-search-catalog-v3.md) and the tree (step 1), propose which product goes in which category, and ask the user. After the user agrees, create the missing categories (step 2), then add the products with one add-items request per category.

To give the user a link to the categories page in the dashboard, see [Stores Dashboard Navigation](stores-dashboard-navigation.md). For the order of products inside a category, see [Set Arranged Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/set-arranged-items).
