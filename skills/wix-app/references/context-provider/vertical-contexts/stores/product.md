# Stores context: `@wix/stores/context/product` (part 1 of 2)

This context's reference is split across 2 files: [product.md](product.md), [product-2.md](product-2.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product`.

### `ProductContextProvider`

Supplies a product context value to descendant components.

```ts
import { ProductContextProvider } from '@wix/stores/context/product';
```

- **Parameters:** `__0: ProductContextProviderProps`
- **Returns:** `ReactNode`

### `useProductContext`

The Product context provides access to a store product's details, prices, media, and stock, and to the visitor's selection of options, modifiers, subscription plan, and quantity. Use it to show a product, let visitors choose what to buy, and let them add their selection to the cart, start a checkout, or sign up for a back-in-stock email.

```ts
import { useProductContext } from '@wix/stores/context/product';
```

- **Parameters:** none
- **Returns:** `ProductContextValue`

#### Returned types

##### `ProductContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `value` | `ProductContextValue \| undefined` |  |
| `children` | `ReactNode` |  |
