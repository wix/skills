# Stores context: `@wix/stores/context/product-list` (part 1 of 3)

This context's reference is split across 3 files: [product-list.md](product-list.md), [product-list-2.md](product-list-2.md), [product-list-3.md](product-list-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-list`.

### `ProductListContextProvider`

Supplies a product list context value to descendant components.

```ts
import { ProductListContextProvider } from '@wix/stores/context/product-list';
```

- **Parameters:** `__0: ProductListContextProviderProps`
- **Returns:** `ReactNode`

### `useProductListContext`

Reads the products, filters, sorting, and pagination supplied by a product list implementation.

```ts
import { useProductListContext } from '@wix/stores/context/product-list';
```

- **Parameters:** none
- **Returns:** `ProductListContextValue`

#### Returned types

##### `ProductListContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `value` | `ProductListContextValue \| undefined` |  |
| `children` | `ReactNode` |  |

##### `ProductListContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `filters` | `Filter[]` | Filters available for the current product list, already resolved from the server's aggregations. |
| `currency` | `string \| undefined` | ISO currency code the product list's products are priced in, e.g. `'USD'`. |
| `promotionItems` | `PromotionItem[]` | Promotions configured for the current product list. |
| `filterSelection` | `FilterSelection` | The visitor's current filter selection, decoded from the URL. `{}` when nothing is selected. |
| `selectFilterChoice` | `(customizationId: string, choiceId: string) => void` | Add a choice to a customization filter. Pushes a new URL and re-queries the list. |
| `deselectFilterChoice` | `(customizationId: string, choiceId: string) => void` | Remove a choice from a customization filter. Pushes a new URL and re-queries the list. |
| `setPriceRange` | `(min: number, max: number) => void` | Set the price-filter bounds. Pushes a new URL and re-queries the list. |
| `clearPriceRange` | `() => void` | Remove the price filter entirely. A no-op when no price bound is selected. |
| `clearAllFilters` | `() => void` | Clear every active filter at once. A no-op when the selection is already empty. |
| `sortTypes` | `SortTypes[]` | Every sort option the product list offers, in display order. Labels are the widget's job. |
| `selectedSortType` | `SortTypes` | The active sort. Falls back to the default when the URL carries no `sort` param. |
| `selectSortType` | `(sortOptionType: SortTypes) => void` | Change the sort. A no-op when the type is already selected. |
| `productItems` | `ProductItem[]` | Products loaded so far — every page fetched to date, flattened and accumulated, not just the most recent one. Each entry carries the normalized product and the site's default stores location, and feeds one Product Item Context Provider. |
| `productCount` | `number` | Total number of products matching the current product list and filters, across all pages — use it for "N results", not `productItems.length`. Counted on the first page only; `0` before it lands. |
| `isLoadingProducts` | `boolean` | Whether a product query is in flight. Also `true` for background refetches, during which the previous page's {@link productItems} stay visible rather than blanking out. |
| `hasProductsError` | `boolean` | Whether the most recent product query failed. Queries are not retried. |
| `hasMoreProducts` | `boolean` | Whether another page exists. Gate the "load more" affordance on this. |
| `loadMoreProducts` | `() => Promise<void>` | Fetch the next page and append it to {@link productItems}. Safe to call while a fetch is already running — the in-flight request is not cancelled. Resolves when the request finishes; bind to the native Repeater's async Load More action. |

##### `Filter`

| Property | Type | Description |
| --- | --- | --- |
| `type` | `FilterType` |  |
| `name` | `string` |  |

##### `PromotionItem`

| Property | Type | Description |
| --- | --- | --- |
| `promotion` | `PromotionItemContextValue` | The current entry of the `promotionItems` array. |

##### `FilterSelection`

| Property | Type | Description |
| --- | --- | --- |
| `customizationIdToChoiceIds` | `Record<string, string[]> \| undefined` |  |
| `priceMin` | `number \| undefined` |  |
| `priceMax` | `number \| undefined` |  |
