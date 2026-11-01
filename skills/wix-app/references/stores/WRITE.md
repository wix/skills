# Stores — Write Operations (Create / Update / Delete)

## Create a product (single-variant, with price)

```typescript
if (v === 'V3_CATALOG') {
  const product = await productsV3.createProduct({
    name: 'My Product',
    productType: 'PHYSICAL',                            // UPPER_CASE
    variantsInfo: {
      variants: [{
        price: { actualPrice: { amount: '19.99' } },    // string, on the variant
        sku: 'SKU-001',
      }],
    },
  });
  return product;
}

const { product } = await products.createProduct({
  name: 'My Product',
  productType: 'physical',                              // lower-case
  priceData: { price: 19.99 },                          // number, on the product
  sku: 'SKU-001',
});
return product;
```

---

## Update a product (V3 needs `revision`)

```typescript
if (v === 'V3_CATALOG') {
  // Signature: updateProduct(_id, productFields). Returns V3Product directly.
  const current = await productsV3.getProduct(id);
  if (current.revision == null) throw new Error(`Product ${id} has no revision`);
  return await productsV3.updateProduct(id, {
    revision: current.revision,  // narrowed — required under exactOptionalPropertyTypes
    name: 'New name',
  });
}
// V1: updateProduct(id, productFields). Returns { product }.
const { product } = await products.updateProduct(id, { name: 'New name' });
return product;
```

---

## Save product media

Detect the catalog version first; see [STORES_VERSIONING.md](../STORES_VERSIONING.md).
Call these writes only from the entity Save action, after the image draft has changed.

### V3: write the gallery, with the main image first

The SDK writes `media.itemsInfo.items` using `{ _id: fileId }` for a Media Manager file or
`{ url: externalUrl }` for an external URL. `media.main` and the decoded `image` value are
read-only. Request `MEDIA_ITEMS_INFO` before building the write: arrays replace the whole
field. This example promotes the selection to main and keeps the previous gallery, including
the former main image, so existing choice references remain valid.

```typescript
import { productsV3 } from '@wix/stores';

export async function saveV3MainImage(productId: string, fileId: string) {
  if (!fileId) throw new Error('A Media Manager file ID is required');
  const current = await productsV3.getProduct(productId, { fields: ['MEDIA_ITEMS_INFO'] });
  if (current.revision == null) throw new Error('Product revision is missing');
  const gallery = current.media?.itemsInfo?.items;
  if (current.media?.main && !gallery) throw new Error('The full gallery was not loaded');

  const writable = (gallery ?? []).map(item => {
    const source = item._id ? { _id: item._id }
      : item.url ? { url: item.url, ...(item.displayName ? { displayName: item.displayName } : {}) }
      : undefined;
    if (!source) throw new Error('An existing media item has no writable source');
    return { ...source, ...(item.altText ? { altText: item.altText } : {}) };
  });
  const chosen = writable.find(item => item._id === fileId) ?? { _id: fileId };
  const items = [chosen, ...writable.filter(item => item._id !== fileId)];

  return productsV3.updateProduct(productId, {
    revision: current.revision,
    media: { itemsInfo: { items } },
  });
}
```

Pass the selected descriptor's `_id` as `fileId`; use its image URI separately for preview.
Retaining a full gallery can reach the API's item limit: validate capacity before Save and
keep the draft if the write fails. For an image-only edit, send only revision and media;
other edited fields belong in the same Save payload. A removed gallery item may be referenced
by option/modifier choices, so handle those references explicitly when implementing removal.

Sources: [Update Product — SDK request schema](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product?apiView=SDK)
and [About Product Media](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/about-product-media).
The article uses REST `id`; the SDK request schema uses `_id`.

### V1: use the dedicated media methods

V1 `updateProduct()` treats `media` as read-only. Add a selected file with:

```typescript
import { products } from '@wix/stores';

export async function addV1ProductImage(productId: string, fileId: string) {
  await products.addProductMedia(productId, [{ mediaId: fileId }]);
  return products.getProduct(productId);
}
```

An external source uses `{ url: externalUrl }` instead. For removal,
`products.removeProductMedia(productId, [mediaId])` removes that item; an empty array removes
**all** media. Preserve the remaining gallery and choice associations.

Adding media alone does not establish main-image replacement. These references do not provide
a V1 main-image ordering contract. Enable Replace only through a V1 save adapter whose ordering
and choice preservation have been confirmed; otherwise offer supported gallery addition and
report main-image replacement as unavailable. Avoid rebuilding the whole gallery merely to
simulate replacement.

Sources: [Add Product Media](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/add-product-media?apiView=SDK),
[Remove Product Media](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/remove-product-media?apiView=SDK),
and [Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/update-product?apiView=SDK).

---

## Delete a product

```typescript
if (v === 'V3_CATALOG') await productsV3.deleteProduct(id);
else await products.deleteProduct(id);
```
