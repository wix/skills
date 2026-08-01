---
name: "Delete Product (Catalog V1)"
description: Delete a product using the Catalog V1 Products API. Use this recipe when the site's catalog version is CATALOG_V1. Covers the delete endpoint and what to check when a deleted product keeps appearing on the live storefront.
---
# RECIPE: Business Recipe - Delete Product (Catalog V1)

## STEP 1: Delete a Product

Use `DELETE https://www.wixapis.com/stores/v1/products/{productId}` to delete a product.

```bash
curl -X DELETE 'https://www.wixapis.com/stores/v1/products/{productId}' \
-H 'Authorization: <AUTH>'
```

There is no response body on success. To confirm the deletion, query for the product ID with [Query Products (Catalog V1)](query-products-catalog-v1.md) — it should no longer be returned.

---

## Troubleshooting: deleted product still visible on the live storefront

Catalog V1 deletes are immediate in the Catalog API, but the **public storefront (product pages, "All Products"/category galleries) is served from a separate rendering/index layer that is only eventually consistent** with the catalog. After a delete, a product can keep rendering live — with its own working product-page URL and category-page listing — for some time even though it is already gone from every Catalog V1 query (`stores-reader/v1/products/query`, `stores/v1/products/query`, including with `includeHiddenProducts: true`).

If you (or the site owner) hit this:
1. **Confirm it's a storefront/index staleness issue, not a wrong query**, by checking the product is truly absent from `QueryProducts` with `includeHiddenProducts: true` set — if the product is missing even with that flag, the catalog itself no longer has it.
2. **This resolves on its own** — the storefront cache/index has a TTL and self-heals; it is not permanent data corruption.
3. **To force an immediate refresh instead of waiting**, republish the site (`POST` the site's publish endpoint from the Sites API, or use `ManageWixSite`). Republishing busts the site's page/CDN cache and has been observed to immediately clear stale storefront product data faster than waiting out the cache TTL.
4. Do not assume the product still exists just because the storefront shows it — trust the Catalog V1 query result as the source of truth for whether the delete succeeded.

## References

- [V1 Delete Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/delete-product)
- [Query Products (Catalog V1)](query-products-catalog-v1.md)
- [Catalog Versioning Overview](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/introduction)
