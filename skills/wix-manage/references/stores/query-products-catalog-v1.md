---
name: "Query Products (Catalog V1)"
description: Query and list products from a Wix Store using the Catalog V1 Query Products endpoint. Use this recipe when the site's catalog version is CATALOG_V1. Covers basic queries, filtering, sorting, and paging.
---
# RECIPE: Business Recipe - Query Products (Catalog V1)

## STEP 1: Query Products

Use `POST https://www.wixapis.com/stores-reader/v1/products/query` to query products from a V1 store.

**Basic query (all products):**

```bash
curl -X POST 'https://www.wixapis.com/stores-reader/v1/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {}
}'
```

---

## STEP 2: Filtering and Sorting

> **CRITICAL:** In V1, `filter` and `sort` are **JSON-encoded strings**, not objects — unlike V3 where they are plain objects.

**Query with filter and sort:**

```bash
curl -X POST 'https://www.wixapis.com/stores-reader/v1/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {
    "filter": "{\"visible\": true}",
    "sort": "[{\"fieldName\": \"name\", \"order\": \"ASC\"}]",
    "paging": {
      "limit": 50,
      "offset": 0
    }
  }
}'
```

**Query by product IDs:**

```bash
curl -X POST 'https://www.wixapis.com/stores-reader/v1/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {
    "filter": "{\"id\": {\"$in\": [\"product-id-1\", \"product-id-2\"]}}"
  }
}'
```

---

## STEP 3: Paging past the 10,000-item offset cap

**⚠️ Catalog V1 only supports `offset` paging, and `offset + limit` is capped at 10,000.** Once you hit that cap, you cannot page further by offset — there is no cursor-based alternative in V1. Do not report the capped result count as the exact product count; a search-backed total commonly stops at 10,000 even when the real catalog is larger.

For a catalog larger than ~10k products, the workaround is **seek paging**: sort by a stable, unique field, keep `offset: 0`, and filter for values greater than the last one you received on each subsequent call:

```bash
curl -X POST 'https://www.wixapis.com/stores-reader/v1/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {
    "sort": "[{\"fieldName\":\"<STABLE_SORT_FIELD>\",\"order\":\"ASC\"}]",
    "filter": "{\"<STABLE_SORT_FIELD>\":{\"$gt\":\"<lastValueFromPreviousPage>\"}}",
    "paging": { "limit": 100, "offset": 0 }
  }
}'
```

**⚠️ `<STABLE_SORT_FIELD>` is not yet confirmed.** This skill has not verified which V1 field is safe to both filter and sort on for seek paging — do not assume `numericId` (or any other field) works until it's been confirmed against the live API or by the Stores team. Before relying on this pattern, verify the candidate field is unique, monotonic, and supported by both `$gt` and `sort` on this endpoint.

---

## Key Differences from V3

| Feature | Catalog V1 | Catalog V3 |
|---|---|---|
| Query endpoint | `POST /stores-reader/v1/products/query` | `POST /stores/v3/products/query` |
| Filter/sort | JSON-encoded strings | Plain objects |
| Additional fields | Not applicable | Enum values like `DESCRIPTION`, `URL` |

---

## Important Notes

- **Never use `/stores/v3/` endpoints on a CATALOG_V1 site** — they return `428 Precondition Required`.
- Check the site's catalog version in dynamic context before choosing endpoints.
- To create products on a V1 site, see [Create Product (Catalog V1)](create-product-catalog-v1.md).

## References

- [V1 Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/query-products)
- [Catalog Versioning Overview](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/introduction)
