# Stores context: `@wix/stores/context/category-info`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/category-info`.

### `CategoryInfoContextProvider`

Supplies category details from an explicit value or a configured category ID.

```ts
import { CategoryInfoContextProvider } from '@wix/stores/context/category-info';
```

- **Parameters:** `__0: CategoryInfoContextProviderProps`
- **Returns:** `ReactNode`

### `useCategoryInfoContext`

Reads the category details supplied by a surrounding category info provider.

```ts
import { useCategoryInfoContext } from '@wix/stores/context/category-info';
```

- **Parameters:** none
- **Returns:** `CategoryInfoContextValue`

#### Returned types

##### `CategoryInfoContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `value` | `CategoryInfoContextValue \| undefined` |  |
| `categoryId` | `string \| undefined` |  |
| `children` | `ReactNode` |  |

##### `CategoryInfoContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Category id. Pass this to product queries to scope them to the current category. |
| `name` | `string` | Category's display name. |
| `slug` | `string` | Category's URL slug |
| `link` | `Link \| undefined` | Link to the category's page |
| `description` | `string \| undefined` | Plain-text category description. `undefined` when the category has no description. Prefer {@link richContentDescription} for display — this one is the unformatted fallback, useful for meta tags and single-line summaries. |
| `richContentDescription` | `RicosDocument \| undefined` | Category's description as a Ricos rich-text document. |
| `image` | `Image \| undefined` | Category image, with `uri`/`width`/`height` parsed off the Wix media URL. `undefined` when unset. |
| `breadcrumbs` | `CategoryBreadcrumb[]` | Ancestor trail from the top-level category down to the parent of the current category, each with its category ID and a ready-to-use `href`. The current category is not included — consumers append it themselves. Empty for a top-level category. |

##### `Link`

| Property | Type | Description |
| --- | --- | --- |
| `href` | `string \| undefined` | The link URL. For partial links (see `pageRole`), this is the router prefix (e.g. `https://www.my-site.com/prefix`) rather than a fully resolved URL. |
| `target` | `LinkTarget \| undefined` | Where this link should open. - `'_self'` — opens in the same page. - `'_blank'` — opens in a new tab. |
| `rel` | `string \| undefined` |  |
| `pageRole` | `string \| undefined` | Page role identifier. Present only on partial links, where only the router prefix is known and the full URL format is owned by the Router/App. Applications can use such links in functions to resolve the complete URL at runtime (e.g. for binding links). Resolved links will not have this field. |

##### `RicosDocument`

| Property | Type | Description |
| --- | --- | --- |
| `nodes` | `RicosDocumentNode[]` | Array of nodes representing content elements, such as `ParagraphNode` or `HeadingNode`. |
| `metadata` | `Metadata \| undefined` |  |
| `documentStyle` | `DocumentStyle \| undefined` |  |

##### `Image`

| Property | Type | Description |
| --- | --- | --- |
| `uri` | `string \| undefined` | The image URI. |
| `url` | `string` |  |
| `name` | `string \| undefined` | Category's display name. |
| `height` | `number \| undefined` |  |
| `width` | `number \| undefined` |  |
| `animated` | `boolean \| undefined` |  |
| `crop` | `Crop \| undefined` |  |
| `quality` | `number \| undefined` |  |
| `alt` | `string \| undefined` |  |

##### `CategoryBreadcrumb`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Category id. Pass this to product queries to scope them to the current category. |
| `name` | `string` | Category's display name. |
| `slug` | `string` | Category's URL slug |
| `href` | `string` |  |
