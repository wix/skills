# Stores context: `@wix/stores/category-by-id-context-provider`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/category-by-id-context-provider`.

### `CategoryByIdContextProvider`

Loads a category by ID and supplies its category info and product list contexts.

```ts
import { CategoryByIdContextProvider } from '@wix/stores/category-by-id-context-provider';
```

- **Parameters:** `__0: CategoryByIdContextProviderProps`
- **Returns:** `Element \| null`

### `CategoryByIdContextValues`

```ts
import { CategoryByIdContextValues } from '@wix/stores/category-by-id-context-provider';
```

- **Parameters:** `__0: CategoryByIdContextValuesProps`
- **Returns:** `Element`

### `useCategoryByIdContext`

Reserved hook. Always throws; read useProductListContext and useCategoryInfoContext instead.

```ts
import { useCategoryByIdContext } from '@wix/stores/category-by-id-context-provider';
```

- **Parameters:** none
- **Returns:** `never`

#### Returned types

##### `CategoryByIdContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `categoryId` | `string \| undefined` |  |
| `productsPerPage` | `number \| undefined` | How many products each page request fetches. Declared as a manifest data prop. |
| `children` | `ReactNode` |  |

##### `CategoryByIdContextValuesProps`

| Property | Type | Description |
| --- | --- | --- |
| `categoryValue` | `CategoryInfoContextValue` |  |
| `productListValue` | `ProductListContextValue` |  |
| `children` | `ReactNode` |  |
