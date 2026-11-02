# Stores context: `@wix/stores/context/product-by-slug` (part 1 of 2)

This context's reference is split across 2 files: [product-by-slug.md](product-by-slug.md), [product-by-slug-2.md](product-by-slug-2.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-by-slug`.

### `ProductBySlugContextProvider`

Loads the product identified by the page URL and supplies its product context.

```ts
import { ProductBySlugContextProvider } from '@wix/stores/context/product-by-slug';
```

- **Parameters:** `__0: { children?: ReactNode; }`
- **Returns:** `ReactNode`

### `useProductBySlugContext`

Reads the product context for the product page.

```ts
import { useProductBySlugContext } from '@wix/stores/context/product-by-slug';
```

- **Parameters:** none
- **Returns:** `ProductContextValue`

#### Returned types
