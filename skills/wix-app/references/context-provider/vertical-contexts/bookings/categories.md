# Bookings context: `@wix/bookings/context/categories`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/categories`.

### `CategoriesContextProvider`

Loads the business service categories and tracks the selected category in the page URL.

```ts
import { CategoriesContextProvider } from '@wix/bookings/context/categories';
```

- **Parameters:** `__0: CategoriesContextProviderProps`
- **Returns:** `Element`

### `useCategoriesContext`

Reads the categories state; throws when no CategoriesContextProvider is above.

```ts
import { useCategoriesContext } from '@wix/bookings/context/categories';
```

- **Parameters:** none
- **Returns:** `CategoriesContextValue`

#### Returned types

##### `CategoriesContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `initialCategoryId` | `string \| undefined` | Selected on load when the page URL names no category. |
| `categoriesPicker` | `CategoriesPickerFilter \| undefined` | Shows only the picked categories. |
| `refreshSignal` | `number \| undefined` | Bumped by the editor bundle on realtime data-changes; non-zero refetches, bypassing warmup. |
| `children` | `ReactNode` |  |

##### `CategoriesContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `categories` | `V2Category[]` |  |
| `categoryItems` | `CategoryItem[]` |  |
| `selectedCategoryId` | `string \| null` |  |
| `selectedCategoryIndex` | `number` |  |
| `selectedCategory` | `V2Category \| null` |  |
| `selectedCategoryName` | `string \| null` |  |
| `hasMultipleCategories` | `boolean` |  |
| `isLoading` | `boolean` |  |
| `hasError` | `boolean` |  |
| `refetch` | `() => void` |  |
| `selectCategory` | `(categoryId: string \| null) => void` |  |

##### `V2Category`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string \| undefined` | Category ID. |
| `name` | `string \| null \| undefined` | Category name. |
| `sortOrder` | `number \| null \| undefined` | Order of a category within a category list. |

##### `CategoryItem`

| Property | Type | Description |
| --- | --- | --- |
| `categoryId` | `string \| null` |  |
| `categoryName` | `string \| null` |  |
| `isSelected` | `boolean` |  |
