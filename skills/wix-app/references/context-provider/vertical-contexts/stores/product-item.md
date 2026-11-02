# Stores context: `@wix/stores/context/product-item` (part 1 of 3)

This context's reference is split across 3 files: [product-item.md](product-item.md), [product-item-2.md](product-item-2.md), [product-item-3.md](product-item-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-item`.

### `ProductItemContextProvider`

Supplies product details and purchase actions for one product list entry.

```ts
import { ProductItemContextProvider } from '@wix/stores/context/product-item';
```

- **Parameters:** `__0: ProductItemContextProviderProps`
- **Returns:** `Element`

### `useProductItemContext`

Reads the product context for the current product list item.

```ts
import { useProductItemContext } from '@wix/stores/context/product-item';
```

- **Parameters:** none
- **Returns:** `ProductContextValue`

### `useProductItemContextValue`

```ts
import { useProductItemContextValue } from '@wix/stores/context/product-item';
```

- **Parameters:** `__0: ProductItem`
- **Returns:** `useProductItemContextValue return value` (below)

#### Returned types

##### `ProductItemContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `productItem` | `ProductItem \| undefined` |  |
| `children` | `ReactNode` |  |
