---
name: "Query Products (Catalog V3)"
description: Query, search, and list products from a Wix Store using Catalog V3 Query Products and Search Products endpoints. Explains when to use each endpoint, correct fields enum values, filtering, sorting, and paging.
---

# RECIPE: Business Recipe – Query Products from a Wix Store (Catalog V3)

Retrieve products from a Wix store using the Catalog V3 Query Products and Search Products APIs.

## Article: How to Query Products

### STEP 0: Choose Query Products or Search Products

Use **Query Products** when you need structured filters, sorting, paging, or listing products. Use **Search Products** when you need text search, especially looking up products by name.

| Need | Endpoint | Notes |
| ---- | -------- | ----- |
| List all products or page through the catalog | [Query Products](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/query-products) | Supports paging and structured filters on the fields listed below. |
| Filter by `id`, `slug`, `handle`, dates, or `visible` | [Query Products](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/query-products) | Do not use unsupported fields in `query.filter`. |
| Find a product by name or other free text | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) | `name` is not a supported Query Products filter field. |
| Need exact name matching but Search Products is unavailable or too broad | [Query Products](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/query-products) + client-side match | Query a bounded page and match `product.name` in your own code. |

### STEP 1: Call Query Products endpoint

Use the **POST** [Query Products](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/query-products) endpoint to query products. The endpoint returns up to 100 products per request.

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

### STEP 2: Understanding the `fields` parameter

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

### STEP 3: Filtering and sorting

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

For name-based lookup, use [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products), or query a bounded page and match by `product.name` in your own code.

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

### STEP 4: Search by product name

Use Search Products for name or free-text lookup:

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

## Important Notes

- **Variant data is NOT returned** by Query Products. To get variant details, use [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) for individual products.
- **Non-visible products** require the `SCOPE.STORES.PRODUCT_READ_ADMIN` permission.
- Default fields include: `id`, `name`, `slug`, `visible`, `productType`, `priceData`, `stock`, `media`, `createdDate`, `updatedDate`.
- The `fields` parameter adds fields **on top of** the defaults — you never need to request `id` or `name` explicitly.

## Conclusion

To list or structurally filter products, use `POST https://www.wixapis.com/stores/v3/products/query`. To find products by name or free text, use `POST https://www.wixapis.com/stores/v3/products/search`. Use `fields: []` for defaults, or pass valid enum values like `DESCRIPTION`, `URL`, `ALL_CATEGORIES_INFO` for additional data. Never pass property names as field values.
