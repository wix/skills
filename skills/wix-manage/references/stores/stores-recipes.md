---
name: "Stores Recipes"
description: "Store catalog work — find, create and update products and their options, variants, pricing, visibility and pre-orders, add missing store pages, and link to the stores dashboard. Use for anything users call store, shop, products, catalog, SKUs, variants, inventory, or product options."
---

# Stores Recipes

Catalog version decides the recipe: a site is on Catalog V3 or Catalog V1, and the request shapes differ, so establish which before mutating anything — **Find Products (Catalog V3)** and **Query Products (Catalog V1)** cover reading on each, **Create Product (Catalog V3)** and **Create Product (Catalog V1)** cover creating. Never invent a price: creating a product requires an explicit name and price, and an absent price is not zero. **Update Product with Options (Catalog V3)** handles option choices, variant pricing and storefront visibility; **Update Product Pre-Order (Catalog V3)** handles pre-order settings and their inventory prerequisites. Orders, coupons, discounts and shipping live in the ecommerce recipes, not here.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Find Products (Query and Search, Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/find-products-query-and-search-catalog-v3)
**Technical:** Find, search, query, and list products from a Wix Store using Catalog V3
Search Products and Query Products endpoints. Explains when to use each endpoint,
correct fields enum values, filtering (including by price), sorting, and paging.

### [Query Products (Catalog V1)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/query-products-catalog-v1)
**Technical:** Query and list products from a Wix Store using the Catalog V1 Query
Products endpoint. Use this recipe when the site's catalog version is CATALOG_V1. Covers
basic queries, filtering, sorting, and paging.

### [Create Product (Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/create-product-catalog-v3)
**Technical:** Mandatory first recipe for every Wix Stores Catalog V3 create-product
request. Before any mutation, require an explicit name and price for every product; an
absent price is never 0. If no product is identified, offer both image-upload and
text-description paths and stop. If name or price is missing, ask or offer a suggestion
and stop. When both are present, create from the supplied details without requiring
optional enrichment. Covers single/bulk creation, inventory, physical/digital products,
images, options, variants, SKUs, and validation.

### [Create Product (Catalog V1)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/create-product-catalog-v1)
**Technical:** Create products using the Catalog V1 Products API. Use this recipe when
the site's catalog version is CATALOG_V1. Covers simple product creation, product with
options, and key V1 request structure differences from V3.

### [Update Product with Options (Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/update-product-with-options-catalog-v3)
**Technical:** Modifies existing products and variants using Catalog V3 Products API.
Covers adding/removing option choices, variant-specific pricing, product visibility
(hide, unhide, or show a product in the storefront — a product-level `visible` update,
never a delete), and revision-based updates to prevent conflicts.

### [Update Product Pre-Order (Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/update-product-pre-order-catalog-v3)
**Technical:** Manages pre-order settings for product variants using V3 Inventory API.
Covers enabling/disabling pre-orders, setting messages, configuring limits, and handling
trackQuantity requirements.

### [Add Store Pages to Site](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/add-store-pages-to-site)
**Technical:** Adds missing checkout and cart pages to a site when Stores app is
installed. Used when store pages are missing after migration or setup issues.

### [Stores Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/stores-dashboard-navigation)
**Technical:** Builds direct links to Wix Stores and eCommerce dashboard pages on
manage.wix.com — products list, edit a specific product, categories, inventory, orders
list, a specific order, abandoned checkouts, gift cards, shipping and tax settings.
Pairs each main Stores/eCommerce entity with its read API so you can fetch an entity and
hand back a 'view it in your dashboard' link. Use when the user asks where something is
in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard
URL to include with the result of an API operation.
