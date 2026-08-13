---
name: "Setup Online Store (Catalog V3)"
description: Initializes a Stores catalog with Catalog V3 Products API, bulk products endpoint, and Categories API. Covers product creation, option configuration, variant management, and category assignment.
---
**RECIPE**: Business Recipe – Initial Setup for a Wix Online Store (Catalog V3)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for preparing any new Wix site that uses the Online Stores app with Catalog V3.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial catalog setup.

---

## Article: Steps for Setting Up a Wix Online Store
**YOU MUST** Complete all the following steps **in the given order** (1 -5) without skipping any and **without requiring additional user input**.
**YOU MUST** remind yourself as many times as needed throughout the process that you most complete all the steps and not stop at all in the middle.


**⚠️ CRITICAL ORDER REQUIREMENT: You MUST start with creating products FIRST (Steps 1-2), then categories (Steps 3-5). Categories API might take some time to be fully available after Stores installation, so always create products before attempting category operations.**

### STEP 1: Confirm Catalog V3 & Stick to V3 APIs

- **Check if the site uses Catalog V3.**
 This can be done using the [Get Catalog Version](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/get-catalog-version) endpoint.
 path: `https://www.wixapis.com/stores/v3/provision/version`


- From this point forward, as long as the result is V3, use only Catalog V3 REST endpoints.
All API calls should be directed to endpoints starting with `/stores/v3/....` Do not mix V3 calls with earlier versions.


- Exception for Categories:
The Categories API is an exception. It uses a v1 endpoint, as it replaces the older Collections API. For example, to create a category in V3, use the following endpoint:
`https://www.wixapis.com/categories/v1/categories`


### STEP 2: Create the requested products with the right Catalog V3 shape
1. Determine the product list from the user request. If the user provided product names, prices, descriptions, quantities, or a product count, **honor that exact catalog**. Do not cap the request at 5 products. The Catalog V3 bulk products endpoint supports up to 100 products per request; split into multiple bulk requests only if the requested catalog exceeds that limit.
2. If the user did not provide a product list or count, create a small starter catalog of 5 relevant sample products. Treat 5 products as the fallback default only, not as a maximum or mandatory count.
3. Use [Bulk Create Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-create-products) for simple products. Use [Bulk Create Products With Inventory](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-create-products-with-inventory) or the [Bulk Create Wix Store Products with Options](bulk-create-products-with-options.md) recipe only when the user requested options, variants, or inventory quantities.
4. Media is optional. Include `media` only when the user provided image URLs, uploaded media, or an existing Wix media reference. **Do not invent, search for, or use external image URLs just to satisfy this recipe.** If no reliable media is available, omit the `media` field and create the products as text-only.
5. Product descriptions are rich-content objects, not plain strings. If adding a description, send a valid rich-content paragraph object; do **not** send `description: "plain text"` because Catalog V3 can reject it with `Expected an object`. If you cannot safely format a description, omit `description` and keep the product name/price.
6. Use `variantsInfo.variants[].price.actualPrice.amount` for prices. Add `compareAtPrice` only when the user provided a sale/list price relationship or explicitly requested compare-at pricing.
7. Do not force an in-stock/out-of-stock mix unless the user requested stock status or quantities. When inventory is not part of the request, create the products first and leave inventory setup for a follow-up user-confirmed step.


### STEP 3: Prepare Three Store Categories
1. Determine how many categories the user requested.
2. If fewer than **3** are provided, create additional categories until the total equals **3** which are relevant for the type of store.
3. Examples for different types of stores:
  - **Book store** → Drama, Kids, Sci-Fi
  - **Fashion** → Men, Women, Kids
  - **Other industries** → any logical grouping that fits the catalog.
4. Use the Categories API to create each category. **YOU MUST USE** the endpoint: [Create Category](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/create-category) based on the example below. Endpoint path: `POST https://www.wixapis.com/categories/v1/categories`. **There is no bulk-create endpoint for `/categories/v1/`** (the `events/v1/bulk/categories/create` URL is for the Events product, not Stores).
5. **Fire all N category-create calls as a single concurrent batch.** Each call is independent (creates a different category), so issue them as siblings in one assistant message — do not serialize. For 3 categories this saves ~6–8 s of wall vs. sequential calls.

When calling the endpoint, make sure the request body includes a top-level `treeReference` field. It must **not** be nested inside the `category` object.

Use the following example format:

```json
{
  "category": {
    "name": "Drinkware",
    "description": "The Drinkware category includes a wide range of containers designed for holding beverages",
    "visible": true
  },
  "treeReference": {
    "appNamespace": "@wix/stores",
    "treeKey": null
  }
}
```


### STEP 4: Add Each Product to a Category
1. **YOU MUST** add each existing product to at least one category that most makes sense.
2. First acquire the product's ids to use for this action.
3. Then adding a product to a category **MUST** be done using the Category API, specifically [Bulk Add Items To Category](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/bulk-add-items-to-category), where products are referred to as items. This endpoint enables adding multiple products at once to a category.
4. **Fire all N add-items calls as a single concurrent batch.** Each call targets a different `categoryId` (the path parameter is single, so one call per category is unavoidable), but the calls are independent and run as siblings in one assistant message. For 3 categories this saves another ~6–8 s of wall.

**⚠️ CRITICAL: Use correct endpoint `/categories/v1/bulk/categories/{categoryId}/add-items` with `catalogItemId`, `appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e"`, and `treeReference` object.**
**Make Sure** you pass the treeReference correctly at the same level as "items".


### STEP 5: (Optional) Verify Each Product was Added to a Category
**Skip this step in trusting flows.** Step 4's bulk add-items endpoint returns an `itemMetadata` array per call — check each result there for failures (`itemMetadata[i].success === false`). The `list-items` round-trip is a defense-in-depth that adds ~10 s of wall and rarely surfaces a failure that the metadata didn't already report.

If you keep the verification (e.g., for high-stakes catalogs):
1. Use [List Items In Category](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/list-items-in-category) for each category. Path: `https://www.wixapis.com/categories/v1/categories/{categoryId}/list-items`.
2. **Fire all N list-items calls as a single concurrent batch** — they're independent.
3. Body must include a top-level `treeReference` field (not nested inside `category`).
4. If a list is empty for a category that should have items, repeat STEP 4 for that category only.

---

## Conclusion
Following these steps **in order** guarantees the creation flow for new V3 Wix Online Store sites:
- Contains exactly **3** categories
- Contains the user-requested products, or 5 relevant sample products only when the user did not provide a catalog
- Each product is connected to at least one category.
- Product media and compare-at pricing are included only when supported by user-provided data.
- Product descriptions use Catalog V3 rich-content objects, or are omitted when only plain text is available.
- All products follow the correct Catalog V3 API format for the requested catalog complexity.
