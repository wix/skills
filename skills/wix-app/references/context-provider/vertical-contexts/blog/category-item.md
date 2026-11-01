# Blog context: `@wix/blog/context/category-item`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/category-item`.

### `CategoryItemContextProvider`

Supplies one post category, injected per repeater cell, to its children.

```ts
import { CategoryItemContextProvider } from '@wix/blog/context/category-item';
```

- **Parameters:** `__0: CategoryItemContextProviderProps`
- **Returns:** `ReactNode`

### `useCategoryItemContext`

Nullable rather than throwing: the hook runs for every element inside the repeater cell, including on the editor stage before the cell is populated.

```ts
import { useCategoryItemContext } from '@wix/blog/context/category-item';
```

- **Parameters:** none
- **Returns:** `PostCategoryItem \| null`

#### Returned types

##### `CategoryItemContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `categoryData` | `PostCategoryItem \| undefined` | The current item of the `postCategories` array, injected by the platform per repeater cell (the Post context manifest's `contextImplementor.propKey`). Absent on the editor's unbound template cell — children then render over a null context, matching the Post Item provider; this provider has no standalone fetch path. |
| `children` | `ReactNode` |  |

##### `PostCategoryItem`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string` | The category's ID. |
| `label` | `string` | The category's name, as plain text. |
| `itemCategoryLabel` | `RichText` | The category's name, as rich text: `text` is the plain text, and `html` is an HTML paragraph. |
| `itemCategoryLink` | `Link \| undefined` | Link to the blog page that lists the category's posts, with its URL in `href`. `undefined` when the site has no such page. |
| `categoryItem` | `{ label: string; slug: string; }` | The category's name and slug. |

##### `RichText`

| Property | Type | Description |
| --- | --- | --- |
| `text` | `string` | The original rich text content. |
| `html` | `string` |  |
| `linkList` | `Link[]` |  |

##### `Link`

| Property | Type | Description |
| --- | --- | --- |
| `href` | `string \| undefined` | The link URL. For partial links (see `pageRole`), this is the router prefix (e.g. `https://www.my-site.com/prefix`) rather than a fully resolved URL. |
| `target` | `LinkTarget \| undefined` | Where this link should open. - `'_self'` — opens in the same page. - `'_blank'` — opens in a new tab. |
| `rel` | `string \| undefined` |  |
| `pageRole` | `string \| undefined` | Page role identifier. Present only on partial links, where only the router prefix is known and the full URL format is owned by the Router/App. Applications can use such links in functions to resolve the complete URL at runtime (e.g. for binding links). Resolved links will not have this field. |
