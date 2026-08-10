---
name: "Update Product Variants (Catalog V1)"
description: Update prices, costs, and other per-variant fields for a product using the Catalog V1 Update Variants endpoint. Use this recipe when the site's catalog version is CATALOG_V1.
---
# RECIPE: Business Recipe - Update Product Variants (Catalog V1)

## STEP 1: Update Variants by Choices

Use `PATCH https://www.wixapis.com/stores/v1/products/{id}/variants` to update one or more variants of a product that has `manageVariants: true`.

Variants can be targeted either by their option `choices` or by `variantIds` — not both in the same variant entry.

```bash
curl -X PATCH \
   'https://www.wixapis.com/stores/v1/products/1044e7e4-37d1-0705-c5b3-623baae212fd/variants' \
   -H 'Content-Type: application/json' \
   -H 'Authorization: <AUTH>' \
   --data-binary '{
     "variants": [
       {
         "choices": {
           "Size": "S",
           "Color": "Blue"
         },
         "price": 100
       }
     ]
   }'
```

**Key fields (per variant entry):**

| Field | Type | Notes |
|---|---|---|
| `choices` | object | Option name → choice value map, e.g. `{"Size": "S"}`. Use instead of `variantIds`. |
| `variantIds` | array\<string\> | Variant GUIDs. Use instead of `choices`. |
| `price` | number | Variant price. Range: 0–999999999.99 |
| `cost` | number | Variant cost of goods. Range: 0–999999999.99 |

## STEP 2: Update Variants by ID

```bash
curl -X PATCH \
   'https://www.wixapis.com/stores/v1/products/1044e7e4-37d1-0705-c5b3-623baae212fd/variants' \
   -H 'Content-Type: application/json' \
   -H 'Authorization: <AUTH>' \
   --data-binary '{
     "variants": [
       {
         "variantIds": ["00000000-0000-0002-0005-918e4641acb0"],
         "price": 89.99
       }
     ]
   }'
```

## Important Notes

- The product must have `manageVariants: true` — variants are auto-generated from `productOptions` when the product is created (see [Create Product (Catalog V1)](create-product-catalog-v1.md)).
- **Never use `/stores/v3/` endpoints on a CATALOG_V1 site** — they return `428 Precondition Required`.
- **Required permission scope: `SCOPE.DC-STORES.MANAGE-PRODUCTS`** (Method Permissions: `WIX_STORES.MODIFY_PRODUCTS`) — the same legacy scope required by V1 Create Product. This is **not** the same as `SCOPE.STORES.PRODUCT_WRITE`, which only applies to Catalog V3 endpoints (e.g. Bulk Update Product Variants By Filter). A `403` with `"the auth identity is not allowed on this resource for this site/account"` on this endpoint means `SCOPE.DC-STORES.MANAGE-PRODUCTS` is missing — reconnecting an OAuth/API integration does not grant a new scope; the app's registered permissions must include it.

## References

- [V1 Update Product Variants](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/update-product-variants)
- [Catalog Versioning Overview](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/introduction)
