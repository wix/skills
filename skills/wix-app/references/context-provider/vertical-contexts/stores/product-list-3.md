# Stores context: `@wix/stores/context/product-list` (part 3 of 3)

This context's reference is split across 3 files: [product-list.md](product-list.md), [product-list-2.md](product-list-2.md), [product-list-3.md](product-list-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-list`.

##### `ProductItem`

| Property | Type | Description |
| --- | --- | --- |
| `product` | `Product` | The current entry of the `productItems` array. |
| `defaultLocationId` | `string \| undefined` | The default location ID for the product. |
