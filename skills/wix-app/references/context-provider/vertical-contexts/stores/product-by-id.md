# Stores context: `@wix/stores/product-by-id-context-provider` (part 1 of 6)

This context's reference is split across 6 files: [product-by-id.md](product-by-id.md), [product-by-id-2.md](product-by-id-2.md), [product-by-id-3.md](product-by-id-3.md), [product-by-id-4.md](product-by-id-4.md), [product-by-id-5.md](product-by-id-5.md), [product-by-id-6.md](product-by-id-6.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/product-by-id-context-provider`.

### `ProductByIdContextProvider`

Loads a product by ID and supplies its details and purchase actions to descendants.

```ts
import { ProductByIdContextProvider } from '@wix/stores/product-by-id-context-provider';
```

- **Parameters:** `__0: ProductByIdContextProviderProps`
- **Returns:** `ReactNode`

### `useProductByIdContext`

Reads the product context for the configured product.

```ts
import { useProductByIdContext } from '@wix/stores/product-by-id-context-provider';
```

- **Parameters:** none
- **Returns:** `ProductContextValue`

#### Returned types

##### `ProductByIdContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `productId` | `string \| undefined` |  |
| `children` | `ReactNode` |  |
