---
name: "Find Products (Query and Search, Catalog V3)"
description: Find, search, query, and list products from a Wix Store using Catalog V3 Search Products and Query Products endpoints. Explains when to use each endpoint, correct fields enum values, filtering, sorting, and paging. Also covers resolving a product name to its product ID for a follow-up write, and the removal endpoints to call next when the user asks to remove or delete a product by name.
---

# RECIPE: Business Recipe – Find Products in a Wix Store (Query and Search, Catalog V3)

Find products in a Wix store using the Catalog V3 Search Products and Query Products APIs.

## Article: How to Find Products

### STEP 0: Choose the right product lookup method

Use **Search Products** for text search and name-based lookup. Use **Query Products** for structured filtering, sorting, paging, and listing products.

| Need | Endpoint | Notes |
| ---- | -------- | ----- |
| Find products by name or free text | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) | Best for user-provided names, keywords, and broad product lookup. |
| List all products or page through the catalog | [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) | Supports paging and structured filters on the fields listed below. |
| Filter by `id`, `slug`, `handle`, dates, or `visible` | [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) | Best for exact structured criteria. |
| Need exact name matching after text lookup | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) + client-side match | Search by the name text, then match the returned `product.name` in your own code. |
| Remove, delete, or hide a product the user named | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) first, then the write in [After the lookup](#after-the-lookup-acting-on-the-product-you-found) | Every product write takes a product ID, so the name lookup always comes first. Do not stop at the lookup — carry out the write in the same task. |

### STEP 1: Search products by name or free text

Use Search Products when the user gives a product name, keyword, or other text expression:

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "expression": "Blue Shirt"
  }
}'
```

For exact name matching, search with the user-provided text and then compare the returned `product.name` values in your own code.

#### Return only the fields you need when you are resolving a name to an ID

Search Products returns **every default field of every match** — media, variants, price ranges, inventory, categories. A single product runs to dozens or hundreds of lines of JSON depending on its media and variants, and the search is fuzzy, so a query for one product name commonly matches several others. Returned raw from a sandboxed execution, that response can exceed the tool response size limit and be truncated — cutting off the very `id` you were looking for.

When the goal is a product ID for a follow-up write, reduce the response to `id` and `name` **before returning it**:

```js
async function() {
  const { products } = await wix.request({
    method: 'POST',
    url: 'https://www.wixapis.com/stores/v3/products/search',
    siteId: '<SITE_ID>',
    body: { search: { expression: 'Blue Shirt' } },
  });
  // Return the minimum you need — never the raw product objects.
  return products.map(p => ({ id: p.id, name: p.name, visible: p.visible }));
}
```

Then pick the product whose `name` matches what the user asked for, and use its `id` in the write.

### STEP 2: Query products with structured filters, sorting, or paging

Use the **POST** [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) endpoint to query products. The endpoint returns up to 100 products per request.

**Endpoint:** `POST https://www.wixapis.com/stores/v3/products/query`

**Basic query (all products, default fields):**

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {}
}'
```

This returns all products with their default fields (id, name, slug, visible, productType, priceData, stock, media, etc.).

### STEP 3: Understanding the `fields` parameter

The `fields` array requests **additional** fields beyond the defaults. It does **NOT** accept property names like `"name"` or `"id"`.

**⚠️ CRITICAL: Valid `fields` enum values:**

| Enum Value                         | Description                  |
| ---------------------------------- | ---------------------------- |
| `URL`                              | Product page URL             |
| `CURRENCY`                         | Currency information         |
| `INFO_SECTION`                     | Info sections (rich content) |
| `MERCHANT_DATA`                    | Merchant-specific data       |
| `PLAIN_DESCRIPTION`                | Plain text description       |
| `INFO_SECTION_PLAIN_DESCRIPTION`   | Info section plain text      |
| `SUBSCRIPTION_PRICES_INFO`         | Subscription pricing         |
| `BREADCRUMBS_INFO`                 | Category breadcrumbs         |
| `WEIGHT_MEASUREMENT_UNIT_INFO`     | Weight unit info             |
| `VARIANT_OPTION_CHOICE_NAMES`      | Variant option choice names  |
| `MEDIA_ITEMS_INFO`                 | Additional media items       |
| `DESCRIPTION`                      | Rich text description        |
| `DIRECT_CATEGORIES_INFO`           | Direct category info         |
| `ALL_CATEGORIES_INFO`              | All category info            |
| `MIN_VARIANT_PRICE_INFO`           | Minimum variant price        |
| `INFO_SECTION_DESCRIPTION`         | Info section rich content    |
| `THUMBNAIL`                        | Thumbnail image              |
| `DIRECT_CATEGORY_IDS`              | Direct category IDs          |
| `PRODUCT_CHOICES_MEDIA_REFERENCES` | Choice-specific media        |

**WRONG – these are NOT valid field values:**

```json
"fields": ["id", "name", "slug", "visible", "priceData"]
```

**CORRECT – use enum constants or leave empty for defaults:**

```json
"fields": []
```

**CORRECT – requesting additional fields:**

```json
"fields": ["DESCRIPTION", "URL", "ALL_CATEGORIES_INFO"]
```

### STEP 4: Filtering and sorting with Query Products

`QueryProducts` supports filters only on these fields:

| Field | Supported Filters | Sortable |
| ----- | ----------------- | -------- |
| `id` | `$eq`, `$ne`, `$exists`, `$in`, `$startsWith` | No |
| `handle` | `$eq`, `$ne`, `$exists`, `$in`, `$startsWith` | No |
| `options.id` | `$isEmpty`, `$hasAll`, `$hasSome` | No |
| `slug` | `$eq`, `$ne`, `$exists`, `$in`, `$startsWith` | Yes |
| `createdDate` | `$eq`, `$ne`, `$exists`, `$in`, `$lt`, `$lte`, `$gt`, `$gte` | Yes |
| `updatedDate` | `$eq`, `$ne`, `$exists`, `$in`, `$lt`, `$lte`, `$gt`, `$gte` | Yes |
| `visible` | `$eq`, `$ne`, `$exists`, `$in` | Yes |

**Query with filter and sort:**

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "fields": [],
  "query": {
    "filter": {
      "visible": true
    },
    "sort": [
      {
        "field_name": "createdDate",
        "order": "ASC"
      }
    ],
    "paging": {
      "limit": 50,
      "offset": 0
    }
  }
}'
```

**Filter by product IDs:**

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "fields": [],
  "query": {
    "filter": {
      "id": {
        "$in": [
          "product-id-1",
          "product-id-2"
        ]
      }
    }
  }
}'
```

### STEP 5: Handling pagination

When there are more products than the page limit, use cursor-based or offset-based paging:

```json
{
  "query": {
    "paging": {
      "limit": 100,
      "offset": 0
    }
  }
}
```

Check the response `pagingMetadata` to determine if more pages exist.

---

## After the lookup: acting on the product you found

Every Catalog V3 product write is keyed by **product ID**, and neither Search nor Query accepts a name as an exact filter (`name` is not in the filterable list in STEP 4). So a request that names a product is always a two-call flow: look the name up, then write with the ID. Once you have the ID, go straight to the write — the request shapes below are complete, and no further schema lookup is needed.

**Catalog V3 has no "archive" operation for products.** "Removing" a product means one of exactly two different things, and the user's wording tells you which:

| The user says | What they mean | Do this |
| ------------- | -------------- | ------- |
| remove, delete, get rid of, take it out of my store/catalog | Permanent deletion | **Delete Product** — below |
| hide, unpublish, take it off the storefront, stop showing it to shoppers | Keep the product, stop displaying it | Set `visible: false` — see [Update Product with Options (Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/update-product-with-options-catalog-v3) |

Match the request to a row and carry that operation out — a user who names a product and asks for it to be removed has already authorised the change, so do not stop to re-confirm. Do confirm the list first when the request is a broad clear-out that would delete products the user never named. The API exposes no restore or undelete for a deleted product, so mention that deletion is permanent when you report back.

### Delete one product

**Endpoint:** `DELETE https://www.wixapis.com/stores/v3/products/{productId}` — takes no request body.

```bash
curl -X DELETE 'https://www.wixapis.com/stores/v3/products/PRODUCT_ID' \
-H 'Authorization: <AUTH>'
```

A 2xx response with an empty body means the product was deleted.

### Delete several products at once

**Endpoint:** `POST https://www.wixapis.com/stores/v3/bulk/products/delete`

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/bulk/products/delete' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "productIds": [
    "product-id-1",
    "product-id-2"
  ]
}'
```

`productIds` is required, 1–100 IDs per request. The response carries a per-product `results[].itemMetadata.success` plus `bulkActionMetadata.totalSuccesses` / `totalFailures` — a 200 does **not** mean every ID succeeded, so check them.

### Deleting everything that matches a filter

`POST https://www.wixapis.com/stores/v3/bulk/products/delete-by-filter` takes a required `filter` (plus an optional fuzzy `search`) and returns only a `jobId` to poll via [Get Async Job](https://dev.wix.com/docs/api-reference/business-management/async-job/introduction) — the deletion is asynchronous, so nothing is confirmed by the response itself. It deletes **every** match, and search matching is fuzzy, so never use it to satisfy a request about one named product; resolve that product's ID and use Delete Product instead. Reserve delete-by-filter for an explicit bulk clear-out.

---

## Important Notes

- **Variant data is NOT returned** by Query Products. To get variant details, use [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) for individual products.
- **Non-visible products** require the `SCOPE.STORES.PRODUCT_READ_ADMIN` permission.
- Default fields include: `id`, `name`, `slug`, `visible`, `productType`, `priceData`, `stock`, `media`, `createdDate`, `updatedDate`.
- The `fields` parameter adds fields **on top of** the defaults — you never need to request `id` or `name` explicitly.

## Conclusion

To find products by name or free text, use `POST https://www.wixapis.com/stores/v3/products/search`. To list, page, sort, or structurally filter products, use `POST https://www.wixapis.com/stores/v3/products/query`. Use `fields: []` for defaults, or pass valid enum values like `DESCRIPTION`, `URL`, `ALL_CATEGORIES_INFO` for additional data. Never pass property names as field values. When the lookup exists to feed a write, reduce the response to the fields you need and then act on the ID: `DELETE https://www.wixapis.com/stores/v3/products/{productId}` to remove a product, or `visible: false` to hide one.
