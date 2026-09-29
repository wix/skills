---
name: "Find Products (Query and Search, Catalog V3)"
description: Find, search, query, and list products from a Wix Store using Catalog V3 Search Products and Query Products endpoints. Explains when to use each endpoint, correct fields enum values, filtering (including by price), sorting, and paging.
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
| Filter by price — "products under $20", "between $10 and $50" | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) | Query Products has no price filter, so filter server-side here (STEP 1) instead of paging the catalog and comparing amounts yourself. |
| Need exact name matching after text lookup | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) + client-side match | Search by the name text, then match the returned `product.name` in your own code. |

### STEP 1: Search products by name, free text, or price

Use Search Products when the user gives a product name, keyword, or other text expression, and for price criteria, which Query Products cannot filter on. Free text goes in `search.search`; price and other structured criteria go in `search.filter`. Send only the part you need:

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "search": { "expression": "Blue Shirt" },
    "filter": { "actualPriceRange.minValue.amount": { "$lt": 20 } }
  }
}'
```

The response puts the matches in `products`:

```json
{
  "products": [
    { "id": "...", "name": "Blue Shirt", "slug": "blue-shirt" }
  ],
  "pagingMetadata": { "count": 1 }
}
```

Query Products returns the same envelope.

For exact name matching, search with the user-provided text and then compare the returned `product.name` values in your own code.

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

This returns all products with their default fields, including `inventory` for product-level availability.

Take availability from `inventory`, and look up any other field you need in the Catalog V3 docs rather than carrying a name over from Catalog V1 — the two catalogs do not share a product shape. A name that isn't on the V3 product reads as `undefined` rather than raising, so the request still succeeds and a check against it quietly matches nothing: an availability question answered that way returns an empty list, which reads as "everything is in stock" instead of as a failure.

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
| `MIN_PRICE_VARIANT`                | Lowest-priced visible variant |
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

`QueryProducts` supports filters only on these fields. Price is not among them, so answer a price question with Search Products rather than paging the whole catalog and comparing amounts in your own code:

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

**⚠️ `offset` paging is capped at `offset + limit ≤ 10,000`.** Past that, the request fails or silently truncates — so offset paging can never walk a full catalog larger than ~10k products. Use `offset` only for a one-off "show page N" request against a small, already-filtered result set. For listing, counting, or exporting the catalog — anything that walks every product — use `cursorPaging` instead. A cursor has no depth limit: paging a 50k-product catalog in pages of 100 takes ~500 calls and never hits the cap, because the engine continues from a bookmark instead of re-sorting and skipping N rows.

**Cursor paging (default for listing/counting/exporting):**

First call — omit `cursor`:

```json
{
  "query": {
    "cursorPaging": {
      "limit": 100
    }
  }
}
```

Each later call sends back the cursor from the previous response's `pagingMetadata.cursors.next`:

```json
{
  "query": {
    "cursorPaging": {
      "limit": 100,
      "cursor": "<pagingMetadata.cursors.next>"
    }
  }
}
```

Stop when `pagingMetadata.cursors.next` is empty or absent — that's the last page.

**Offset paging (only for "show page N" on a small, filtered result set):**

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

Never let `offset + limit` exceed 10,000. If you need page N of a large or unfiltered catalog, narrow the result set first (e.g. `visible`, date range, category) or switch to `cursorPaging`.

---

## Important Notes

- **Variant data is NOT returned** by Query Products. To get variant details, use [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) for individual products.
- **Non-visible products** require the `SCOPE.STORES.PRODUCT_READ_ADMIN` permission.
- Default fields include: `id`, `name`, `slug`, `visible`, `productType`, `inventory`, `media`, `createdDate`, `updatedDate`.
- **Availability is not in STEP 4's filterable set.** To list out-of-stock products, query the catalog — paging until `pagingMetadata` reports no more results — and select on each returned product's `inventory` availability status in your own code, rather than putting it in `query.filter`.
- The `fields` parameter adds fields **on top of** the defaults — you never need to request `id` or `name` explicitly.
- **Never report `pagingMetadata.count` (or a count you stopped at) as the exact product count once it reads exactly `10,000`.** A search-backed total commonly caps its reported count at that number even when the real catalog is much larger — reading it as ground truth understates the count with no error. If you need an exact total, walk `cursorPaging` to the end and count the products yourself, or ask whether a dedicated count endpoint exists for this catalog before trusting `count`.
- **Narrow before you page.** Filters like `visible`, date ranges, or categories keep each result set small, which limits how much cursor-paging work is needed and avoids offset-cap edge cases entirely.

## Conclusion

To find products by name or free text, use `POST https://www.wixapis.com/stores/v3/products/search`. To list, page, sort, or structurally filter products, use `POST https://www.wixapis.com/stores/v3/products/query`. Use `fields: []` for defaults, or pass valid enum values like `DESCRIPTION`, `URL`, `ALL_CATEGORIES_INFO` for additional data. Never pass property names as field values.
