---
name: "Assign Product Ribbon (Catalog V3)"
description: Adds a ribbon badge such as "Sale", "New", or "Bestseller" to a store product using the Catalog V3 Ribbons API and the product's ribbon field. Ribbons are catalog badges, not discounts — no discount rule or coupon is involved.
---
**RECIPE**: Business Recipe - Assigning a Ribbon to a Wix Store Product (Catalog V3)

Use this recipe when a merchant wants a badge on a product — "Sale", "New", "Bestseller", "Limited
Edition", or any custom label.

## Ribbons are not discounts

A ribbon is a **label on the product**, set through the Catalog V3 Products API. It changes nothing
about price.

- It is **not** a discount rule, and **not** a coupon. Creating a discount rule does not produce a
  ribbon, and assigning a ribbon does not reduce any price.
- A request for a ribbon is a request for the badge. **Assign it — do not ask the merchant to
  choose first.** "Put a sale ribbon on it" means the badge, and nothing about the price.
- If the merchant asks for the price reduced *as well*, that is two separate operations: this
  recipe for the badge, and
  [Create Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule)
  for the price. Do both rather than picking one.

## Before assigning

Catalog V3 product updates are revision-based:

- If the merchant gives a product name rather than an id, use
  [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products)
  and take the exact name match.
- Use [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product)
  to read the current `product.revision`. Update Product requires it.

## Assign the ribbon

**Endpoint**: `PATCH https://www.wixapis.com/stores/v3/products/{product.id}`

Pass a ribbon **name** and Wix resolves it: if a ribbon with that name already exists it is
assigned, otherwise a new one is created. There is no need to create the ribbon first.

```json
{
  "product": {
    "id": "<PRODUCT_ID>",
    "revision": "<REVISION>",
    "ribbon": { "name": "Sale" }
  }
}
```

To assign a ribbon that already exists and you hold its id, pass the id instead:

```json
{
  "product": {
    "id": "<PRODUCT_ID>",
    "revision": "<REVISION>",
    "ribbon": { "id": "<RIBBON_ID>" }
  }
}
```

Both forms work the same way for `additionalRibbons`.

| Field               | Description                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| `ribbon`            | The single **primary** ribbon. Accepts `{ "name": … }` or `{ "id": … }`           |
| `additionalRibbons` | Up to **4** further ribbons, shown alongside the primary one                       |

Rules worth knowing before you build the request:

- A product has **one** primary `ribbon`. Assigning another replaces it.
- A ribbon can be on a product at most once: the same ribbon cannot repeat within
  `additionalRibbons`, and the primary `ribbon` cannot also appear in `additionalRibbons`.
- `additionalRibbons` is an array field, so Update Product's array semantics apply — pass the
  **entire** intended array, since passing one entry overwrites the whole list rather than merging.

## Reading and managing ribbons

The [Ribbons API](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/ribbons-v3/introduction)
creates, queries, and manages the ribbons themselves, independently of any product. Use it to list
what ribbons a site already has — useful for reusing the merchant's existing "Sale" ribbon instead
of creating a near-duplicate with different casing.

## Confirming to the merchant

Say which ribbon is now on which product, and that the price is unchanged.
