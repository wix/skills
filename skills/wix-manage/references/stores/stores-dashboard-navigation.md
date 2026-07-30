---
name: "Stores Dashboard Navigation"
description: "Builds direct links to Wix Stores and eCommerce dashboard pages on manage.wix.com — products list, edit a specific product, categories, inventory, orders list, a specific order, abandoned checkouts, gift cards, shipping and tax settings. Pairs each main Stores/eCommerce entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Stores Dashboard Navigation

Build direct links into the store pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

Store pages are split across **two apps** with two URL namespaces:

- **Wix Stores** (`215238eb-22a5-4c36-9e7b-e7c08025e04e`) — catalog: products, categories, inventory. Routes under `wix-stores/`.
- **Checkout & Orders / eCommerce platform** (`1380b703-ce81-ff05-f115-39571d94dfcd`) — orders, checkout, gift cards, shipping, tax. Routes under `ecom-platform/`.

Older `store/...` links (e.g. `store/orders`, `store/inventory`) redirect to the current routes.

## Catalog Pages (Wix Stores)

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Products list | `wix-stores/products` | All products |
| New product | `wix-stores/products/new-product` | Create a product |
| Edit product | `wix-stores/products/product/{productId}` | A specific product |
| Categories | `wix-stores/categories/list` | Product categories |
| Inventory | `wix-stores/inventory` | Stock levels per variant |
| Import products | `wix-stores/import-products` | CSV import |
| Back in stock | `wix-stores/back-in-stock` | Back-in-stock notification requests |
| Store settings | `wix-stores/settings` | Stores-level settings |

Sales-channel pages (Google, Meta, Amazon, eBay, Pinterest, PayPal) live at `wix-stores/channel/{channel}`, e.g. `wix-stores/channel/google`.

## Orders & Checkout Pages (eCommerce)

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Orders list | `ecom-platform/orders-list` | All orders |
| Order details | `ecom-platform/order-details/{orderId}` | A specific order |
| Create manual order | `ecom-platform/orders/create-manual` | Draft/manual orders |
| Abandoned checkouts | `ecom-platform/abandoned-checkouts` | Abandoned cart recovery |
| Gift cards | `ecom-platform/gift-cards` | Gift card products |
| Gift card sales | `ecom-platform/gift-cards/sales` | Sold gift cards |
| Shipping | `ecom-platform/delivery-profile` | Shipping rates and regions (delivery profiles) |
| Tax | `ecom-platform/tax` | Tax rules |
| Tax exemptions | `ecom-platform/tax-exemptions` | Exempt customer groups |
| Checkout settings | `ecom-platform/checkout-settings` | Checkout configuration |

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header. Dashboard routes are the same whether the site's catalog is V1 or V3.

| Entity | Read API | Dashboard link |
|---|---|---|
| Product (Catalog V3) | `POST /stores/v3/products/search` · `POST /stores/v3/products/query` | `wix-stores/products/product/{productId}` (edit) or `wix-stores/products` (list) |
| Product (Catalog V1) | `POST /stores-reader/v1/products/query` | same as above |
| Category | Categories API (`/categories/v1/categories`) | `wix-stores/categories/list` |
| Inventory item (V3) | `POST /stores/v3/inventory-items/query` | `wix-stores/inventory` |
| Order | `POST /ecom/v1/orders/search` · `GET /ecom/v1/orders/{orderId}` | `ecom-platform/order-details/{orderId}` |
| Abandoned checkout | Abandoned Checkouts API (`/ecom/v1/abandoned-checkouts`) | `ecom-platform/abandoned-checkouts` |

Example — after creating a product, hand back its edit link:

```
Created "Organic Cotton Tee".
Manage it here: https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/products/product/{productId}
```
