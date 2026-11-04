---
name: "Update Product Stock and Pre-Order (Catalog V3)"
description: "Changes the stock and pre-order settings of existing Catalog V3 product variants through their inventory items. Covers finding a variant's inventory item by product name or SKU, setting a quantity, adding or removing units, marking a variant in or out of stock, starting or stopping quantity tracking, and enabling or disabling pre-orders with a message and a limit."
---
# Update Product Stock and Pre-Order (Catalog V3)

Stock and pre-order settings are not part of the product. Each variant has an inventory item (one per location when the store has several), and the calls below change it without a product `revision` or a variants array. "Mark X in stock", "add 2 units", "set every product to 1 in stock", "stop tracking inventory" and "allow pre-orders for X" all use them. To give stock to variants that a product update has just created, use **Set Stock for New Variants** in [Update Product with Options (Catalog V3)](update-product-with-options.md).

## Required APIs

- [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products)
- [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) and [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product), for products Search Products has not indexed yet
- [Query Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/query-inventory-items)
- [Bulk Update Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-update-inventory-items)
- [Bulk Increment Inventory Items By Variant And Location](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-increment-inventory-items-by-variant-and-location) and [Bulk Decrement Inventory Items By Variant And Location](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-decrement-inventory-items-by-variant-and-location)
- [Bulk Increment Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-increment-inventory-items) and [Bulk Decrement Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-decrement-inventory-items), when you already hold the inventory item `id`
- [Update Inventory Item](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/update-inventory-item)

## Confirmation

A request that names the product and the change ("add 2 units to the Fertile Eggs", "mark the Tote Bag out of stock") is the user's confirmation. Ask first when:

- the product or the variant is unclear: the name matches no product or several, or the product has several variants and the user named none and did not say "all";
- the change covers the whole catalog and the user has not said "all";
- a tracked variant is to be marked in stock without a number (see Step 2);
- pre-orders are being enabled and the user gave no message for customers.

## Step 1: Find the inventory items

Every call in this recipe is complete and was run as written: send it without looking up its schema first.

**Lookups lag behind a new product.** Search Products, the `product.variantSku` filter and the `product` object on inventory items can miss a product created in the last seconds (on a site set up minutes ago, longer). Get Product and Query Products read the catalog itself and see it at once. So, in the same execution: when a lookup returns nothing for a product that should exist, wait 3 seconds and send it again, up to 3 times, before you try the next fallback; never tell the user a product or SKU does not exist until the Query Products fallback below also found nothing.

**By product name.** Users often put the variant in the product name ("the red Eval Tee", "Large Hoodie"). Search for the product name without the choice word, and keep the choice (`Red`, `Large`) to select the variant afterwards. Resolve the product with an exact, case-insensitive name filter:

```bash
curl -X POST "https://www.wixapis.com/stores/v3/products/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{ "search": { "filter": { "name": "Product name" } } }'
```

When that returns nothing, the user may have given part of the name: search `{ "search": { "search": { "expression": "Product name", "fields": ["name"], "mode": "AND" } } }` and pick a clear match from `products[].name`. Search can also miss a product created in the last few seconds: if both return nothing, list the products with `POST https://www.wixapis.com/stores/v3/products/query` and `{ "query": { "cursorPaging": { "limit": 100 } } }` and match `name` in code, ignoring case. Then query the inventory items by the `products[].id`:

```bash
curl -X POST "https://www.wixapis.com/stores/v3/inventory-items/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{ "query": { "filter": { "productId": { "$in": ["{productId}"] } }, "cursorPaging": { "limit": 1000 } } }'
```

**By SKU.** The inventory filter `{ "product.variantSku": "TEE-RED-L" }` (case-sensitive) is the fast path, but it and the Search Products SKU filter both miss a product created seconds ago. The SKU itself is on `product.variantsInfo.variants[].sku` in a default Get Product response, which is current at once. Run this lookup as written, in the same execution as the update:

```javascript
const sku = "TEE-RED-L";
const sameSku = value => (value ?? "").toLowerCase() === sku.toLowerCase();
const queryItems = filter => wix.request({
  method: "POST",
  url: "https://www.wixapis.com/stores/v3/inventory-items/query",
  body: { query: { filter, cursorPaging: { limit: 1000 } } }
}).then(response => response.data.inventoryItems);
let item = (await queryItems({ "product.variantSku": sku }))[0];
if (!item) {
  const page = (await wix.request({
    method: "POST",
    url: "https://www.wixapis.com/stores/v3/products/query",
    body: { query: { cursorPaging: { limit: 100 } } }
  })).data;
  let candidates = page.products;
  if (page.pagingMetadata.hasNext) {
    candidates = (await wix.request({
      method: "POST",
      url: "https://www.wixapis.com/stores/v3/products/search",
      body: { search: { filter: { "variantsInfo.variants": { $matchItems: [{ sku }] } } } }
    })).data.products;
  }
  let match = null;
  for (const candidate of candidates) {
    const product = (await wix.request({
      method: "GET",
      url: `https://www.wixapis.com/stores/v3/products/${candidate.id}`
    })).data.product;
    const variant = product.variantsInfo.variants.find(v => sameSku(v.sku));
    if (variant) { match = { productId: product.id, variantId: variant.id, productName: product.name }; break; }
  }
  if (!match) return { status: "NO_VARIANT_WITH_THIS_SKU" };
  for (let attempt = 0; attempt < 3 && !item; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 3000));
    item = (await queryItems({ productId: { $in: [match.productId] } })).find(i => i.variantId === match.variantId);
  }
}
if (!item) return { status: "INVENTORY_ITEM_NOT_FOUND" };
```

`item` then holds the `id`, `revision` and `trackQuantity` that Step 2 needs. Tell the user a SKU does not exist only when this lookup returns `NO_VARIANT_WITH_THIS_SKU`. Do not search a SKU as free text on Search Products: it splits the SKU at `-` and can match the whole catalog.

Each `inventoryItems[]` entry has:

| Field | What it holds |
| --- | --- |
| `id`, `revision` | Needed by Bulk Update (`revision` as returned, a string) |
| `productId`, `variantId`, `locationId` | Which variant and location the item belongs to |
| `product.name`, `product.variantName`, `product.variantSku` | `variantName` is the choice name (such as `Black`), or the product name for a product without options |
| `trackQuantity` | `true`: the item has `quantity`. `false`: the item has `inStock` (`true` or `false`) and no `quantity` |
| `availabilityStatus` | `IN_STOCK`, `OUT_OF_STOCK` or `PREORDER` |
| `preorderInfo` | `enabled`, `message`, `limit` |

To select a named variant, match `product.variantName` to the choice. For a few seconds after a product is created, its inventory items can come back without the `product` object; then map choices to `variantId` with Get Product. This lookup handles both cases, in the same execution as the search and the update:

```javascript
const items = inventoryResponse.data.inventoryItems;
let item = items.find(i => i.product?.variantName?.toLowerCase() === "red");
if (!item) {
  const product = (await wix.request({
    method: "GET",
    url: `https://www.wixapis.com/stores/v3/products/${productId}?fields=VARIANT_OPTION_CHOICE_NAMES`
  })).data.product;
  const variant = product.variantsInfo.variants.find(v =>
    v.choices.some(c => c.optionChoiceNames.choiceName.toLowerCase() === "red"));
  item = variant && items.find(i => i.variantId === variant.id);
}
if (!item) throw new Error("Ask the user which variant they mean");
```

## Step 2: Change the stock

Choose the body from the request and from the item's `trackQuantity`:

| Request | Tracked item (`trackQuantity: true`) | Untracked item (`trackQuantity: false`) |
| --- | --- | --- |
| Set a quantity ("set to 10", "1 in stock") | Bulk Update, `"quantity": 10` | Bulk Update, `"quantity": 10` — tracking starts |
| Add or remove units ("add 2", "sold 1") | Bulk Increment or Bulk Decrement By Variant And Location — never read the quantity and set a sum | Fails with `INVENTORY_QUANTITY_NOT_TRACKED`: ask how many are in stock and set that `quantity` |
| Mark out of stock | Bulk Update, `"quantity": 0` — tracking stays on | Bulk Update, `"inStock": false` |
| Mark in stock, no number given | Ask how many units are in stock, then set `quantity` | Bulk Update, `"inStock": true` |
| Stop tracking inventory | Bulk Update, `"inStock": true` (or `false` to keep it unavailable) | Nothing to change |

Send `inStock` to a tracked item only when the user asks to stop tracking: it ends tracking and the `quantity` is gone.

**Bulk Update Inventory Items** — `POST https://www.wixapis.com/stores/v3/bulk/inventory-items/update`, up to 1000 items, each with its `id` and the `revision` from Step 1:

```bash
curl -X POST "https://www.wixapis.com/stores/v3/bulk/inventory-items/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "inventoryItems": [
      { "inventoryItem": { "id": "{inventoryItemId1}", "revision": "{revision1}", "quantity": 0 } },
      { "inventoryItem": { "id": "{inventoryItemId2}", "revision": "{revision2}", "inStock": true } }
    ],
    "reason": "MANUAL",
    "returnEntity": true
  }'
```

**Add or remove units** — [Bulk Increment Inventory Items By Variant And Location](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-increment-inventory-items-by-variant-and-location), `POST https://www.wixapis.com/stores/v3/bulk/inventory-items/increment-by-variant-and-location`, up to 300 items. It takes the `productId` and the variant's `id` from Search Products and Get Product, so it needs no inventory item lookup and no revision; leave out `locationId` for the store's default location. For a product without options, the one variant in `GET https://www.wixapis.com/stores/v3/products/{productId}` → `product.variantsInfo.variants[0].id` is the one to change. To remove units, send the same shape to `https://www.wixapis.com/stores/v3/bulk/inventory-items/decrement-by-variant-and-location` with `decrementData` and `decrementBy`.

```bash
curl -X POST "https://www.wixapis.com/stores/v3/bulk/inventory-items/increment-by-variant-and-location" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "incrementData": [ { "productId": "{productId}", "variantId": "{variantId}", "incrementBy": 2 } ],
    "reason": "MANUAL",
    "returnEntity": true
  }'
```

`results[].item.quantity` is the new total (3 + 2 = 5). When you already hold the inventory item `id`, `https://www.wixapis.com/stores/v3/bulk/inventory-items/increment` with `{ "incrementData": [ { "inventoryItemId", "incrementBy" } ] }` does the same.

## Step 3: Read the result per item

These bulk calls return `200` even when items fail. Check `bulkActionMetadata.totalFailures` and each `results[].itemMetadata.success`. A failed item has `results[].itemMetadata.error.code`:

| Code | Meaning | Fix |
| --- | --- | --- |
| `INVALID_REVISION` | The `revision` is stale | Query the item again (Step 1) and resend it with the new `revision` |
| `INVENTORY_QUANTITY_NOT_TRACKED` | Increment or decrement on an untracked item | Ask how many units are in stock and set `quantity` |

Confirm the new state from `results[].item.quantity`, `inStock`, `trackQuantity` and `availabilityStatus`. The product's `inventory.availabilityStatus` in Search and Query Products reflects the change at once.

## Pre-Order

Pre-order lets customers buy a variant after its stock reaches zero. It is set per inventory item in `preorderInfo`, with Bulk Update Inventory Items (several variants) or Update Inventory Item (one).

- Change only the variants the user named. When the product has several variants and the user named none, ask which ones, or whether all of them.
- When enabling pre-orders without a message from the user, ask for the message customers will see.
- A `limit` (how many units can be pre-ordered after stock reaches zero) works only on a tracked item. On an untracked item, tell the user that quantity tracking will be turned on, ask for the current quantity, and send it with the limit.
- Pre-orders can't be enabled for digital products or products with subscriptions.

**Enable pre-orders on several variants** — Bulk Update Inventory Items:

```json
{
  "inventoryItems": [
    {
      "inventoryItem": {
        "id": "<inventoryItemId_variant1>",
        "revision": "<revision>",
        "preorderInfo": {
          "enabled": true,
          "message": "Available for pre-order! Ships in 2 weeks."
        }
      }
    },
    {
      "inventoryItem": {
        "id": "<inventoryItemId_variant2>",
        "revision": "<revision>",
        "preorderInfo": {
          "enabled": true,
          "message": "Available for pre-order! Ships in 2 weeks."
        }
      }
    }
  ],
  "returnEntity": true,
  "reason": "MANUAL"
}
```

**With a limit, on an item that was not tracked** (the quantity is the one the user gave):

```json
{
  "inventoryItems": [
    {
      "inventoryItem": {
        "id": "<inventoryItemId>",
        "revision": "<revision>",
        "quantity": 100,
        "preorderInfo": {
          "enabled": true,
          "message": "Pre-order now!",
          "limit": 50
        }
      }
    }
  ],
  "returnEntity": true,
  "reason": "MANUAL"
}
```

With 10 in stock and a limit of 50, customers can order up to 60 units in total: 10 from stock and 50 as pre-orders.

**One variant** — Update Inventory Item, `PATCH https://www.wixapis.com/stores/v3/inventory-items/{inventoryItemId}`:

```json
{
  "inventoryItem": {
    "id": "<inventoryItemId>",
    "revision": "<revision>",
    "preorderInfo": {
      "enabled": true,
      "message": "Coming soon! Pre-order today."
    }
  },
  "reason": "MANUAL"
}
```

**Disable pre-orders** — the same call with `"preorderInfo": { "enabled": false, "limit": null }`.

After the change, confirm it from the returned item's `preorderInfo` and `availabilityStatus`. If the product description mentions availability, offer to update it.
