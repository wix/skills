# Stores context: `@wix/stores/category-by-slug-context-provider`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/category-by-slug-context-provider`.

### `CategoryBySlugContextProvider`

Loads the category identified by the page URL and supplies its category and product list contexts.

```ts
import { CategoryBySlugContextProvider } from '@wix/stores/category-by-slug-context-provider';
```

- **Parameters:** `__0: CategoryBySlugContextProviderProps`
- **Returns:** `Element`

### `CategoryBySlugContextValues`

```ts
import { CategoryBySlugContextValues } from '@wix/stores/category-by-slug-context-provider';
```

- **Parameters:** `__0: CategoryBySlugContextValuesProps`
- **Returns:** `Element`

### `useCategoryBySlugContext`

Reserved hook. Always throws; read useProductListContext, useCategoryInfoContext, and useCategoryListContext instead.

```ts
import { useCategoryBySlugContext } from '@wix/stores/category-by-slug-context-provider';
```

- **Parameters:** none
- **Returns:** `never`

#### Returned types

##### `CategoryBySlugContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `productsPerPage` | `number \| undefined` | How many products each page request fetches. Declared as a manifest data prop. |
| `children` | `ReactNode` |  |

##### `CategoryBySlugContextValuesProps`

| Property | Type | Description |
| --- | --- | --- |
| `categoryValue` | `CategoryInfoContextValue` |  |
| `categoryListValue` | `CategoryListContextValue` |  |
| `productListValue` | `ProductListContextValue` |  |
| `children` | `ReactNode` |  |
