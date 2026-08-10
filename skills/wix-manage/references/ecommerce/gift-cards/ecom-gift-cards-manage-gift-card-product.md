# Manage an Existing Gift Card Product

Use this recipe for any request to **edit an existing gift card product** — rename it, change its
denominations (preset/custom variants), or change its expiration policy. Gift card products have their
own API; manage them through the **Gift Cards Products API**.

> A site currently has at most one gift card product.

## Flow

1. **Read it first.** Call [Query Gift Card Products](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/query-gift-card-products)
   (`POST /gift-cards/v1/gift-card-products/query`) or [Get Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/get-gift-card-product)
   (`GET /gift-cards/v1/gift-card-products/{giftCardProductId}`) to get the product `id` and current `revision`.
2. **Update it.** Call [Update Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/update-gift-card-product)
   (`PATCH /gift-cards/v1/gift-card-products/{giftCardProduct.id}`). Send `id`, the current `revision`, and only
   the field you are changing. `revision` must match the latest or the update is rejected.

### Rename example

```http
PATCH https://www.wixapis.com/gift-cards/v1/gift-card-products/{giftCardProductId}
```
```json
{
  "giftCardProduct": {
    "id": "{giftCardProductId}",
    "revision": "{currentRevision}",
    "name": "Holiday Gift Card 2025"
  }
}
```

## Notes

- The `name` field is a top-level string on the gift card product — updating it only changes the name.
- To change denominations, send the **entire** `presetVariants` list (the list is replaced, not merged).
- Deleting is [Delete Gift Card Product](https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/delete-gift-card-product); already-purchased gift cards stay valid.
