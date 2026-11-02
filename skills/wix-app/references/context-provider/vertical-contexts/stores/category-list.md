# Stores context: `@wix/stores/context/category-list`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/category-list`.

### `CategoryListContextProvider`

Supplies the category list and current category to descendant components.

```ts
import { CategoryListContextProvider } from '@wix/stores/context/category-list';
```

- **Parameters:** `__0: CategoryListContextProviderProps`
- **Returns:** `ReactNode`

### `useCategoryListContext`

Reads the visible store categories and the current category.

```ts
import { useCategoryListContext } from '@wix/stores/context/category-list';
```

- **Parameters:** none
- **Returns:** `CategoryListContextValue`

#### Returned types

##### `CategoryListContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `value` | `CategoryListContextValue` |  |
| `children` | `ReactNode` |  |

##### `CategoryListContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `categories` | `Partial<Record<string, CategoryNode>>` | All visible store categories, keyed by category id. |
| `currentCategoryId` | `string \| undefined` | Id of the current category, or `undefined` when there is none. |
