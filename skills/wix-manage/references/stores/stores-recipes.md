---
name: "Stores Recipes"
description: "Store catalog work — find, create and update products and their options, variants, pricing, visibility and pre-orders, add missing store pages, and link to the stores dashboard. Use for anything users call store, shop, products, catalog, SKUs, variants, inventory, or product options."
---

# Stores Recipes

Catalog version decides the recipe: a site is on Catalog V3 or Catalog V1, and the request shapes differ, so establish which before mutating anything — **Find Products (Catalog V3)** and **Query Products (Catalog V1)** cover reading on each, **Create Product (Catalog V3)** and **Create Product (Catalog V1)** cover creating. Never invent a price: creating a product requires an explicit name and price, and an absent price is not zero. **Update Product with Options (Catalog V3)** handles option choices, variant pricing and storefront visibility; **Update Product Pre-Order (Catalog V3)** handles pre-order settings and their inventory prerequisites. Orders, coupons, discounts and shipping live in the ecommerce recipes, not here.

## Recipes

### [Find Products (Query and Search, Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/find-products-query-and-search-catalog-v3)
Use to find or list products on a V3 catalog — which endpoint to use, field enums, filtering including price, sorting and paging.

### [Query Products (Catalog V1)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/query-products-catalog-v1)
Use to find or list products when the site is on Catalog V1.

### [Create Product (Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/create-product-catalog-v3)
Use for every V3 create-product request — required name and price, and how to handle a product the user has not fully specified.

### [Create Product (Catalog V1)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/create-product-catalog-v1)
Use to create products when the site is on Catalog V1, including products with options.

### [Update Product with Options (Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/update-product-with-options-catalog-v3)
Use to change an existing V3 product: option choices, variant pricing, and showing or hiding it in the storefront.

### [Update Product Pre-Order (Catalog V3)](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/update-product-pre-order-catalog-v3)
Use for pre-order settings on variants — enabling, messages, limits, and the trackQuantity requirement.

### [Add Store Pages to Site](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/add-store-pages-to-site)
Use when cart or checkout pages are missing after a migration or a partial setup.

### [Stores Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/stores-dashboard-navigation)
Use when the user wants the products list, a product editor, categories, inventory, orders, abandoned checkouts, gift cards, or shipping and tax settings.
