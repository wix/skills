# Stores context: `@wix/stores/context/product-by-id` (part 4 of 6)

This context's reference is split across 6 files: [product-by-id.md](product-by-id.md), [product-by-id-2.md](product-by-id-2.md), [product-by-id-3.md](product-by-id-3.md), [product-by-id-4.md](product-by-id-4.md), [product-by-id-5.md](product-by-id-5.md), [product-by-id-6.md](product-by-id-6.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-by-id`.

##### `Link$1`

| Property | Type | Description |
| --- | --- | --- |
| `href` | `string \| undefined` | The link URL. For partial links (see `pageRole`), this is the router prefix (e.g. `https://www.my-site.com/prefix`) rather than a fully resolved URL. |
| `target` | `LinkTarget \| undefined` | Where this link should open. - `'_self'` — opens in the same page. - `'_blank'` — opens in a new tab. |
| `rel` | `string \| undefined` |  |
| `pageRole` | `string \| undefined` | Page role identifier. Present only on partial links, where only the router prefix is known and the full URL format is owned by the Router/App. Applications can use such links in functions to resolve the complete URL at runtime (e.g. for binding links). Resolved links will not have this field. |

##### `VisualMedia`

| Property | Type | Description |
| --- | --- | --- |
| `src` | `string` | The URL of the media file |
| `slug` | `string \| undefined` | The slug for the media |
| `description` | `string \| undefined` | Description of the media for accessibility purposes |
| `title` | `string \| undefined` | The title of the media |
| `height` | `number \| undefined` | The height of the media in pixels |
| `width` | `number \| undefined` | The width of the media in pixels |
| `action` | `{ link: string \| Link$1; } \| undefined` | An action when the item is clicked |
| `type` | `"image" \| "video"` |  |
| `parameters` | `ImageParameters \| VideoParameters \| undefined` |  |

##### `ProductRibbons`

| Property | Type | Description |
| --- | --- | --- |
| `primary` | `string \| undefined` | Name of the product's main ribbon, such as `Sale`. `undefined` when the product has none. |
| `additional` | `string[] \| undefined` | Names of the product's other ribbons. Empty when the product has none. |

##### `Breadcrumb`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Category ID. |
| `name` | `string` | Category name. |
| `slug` | `string` | Category slug, the part of the category page's URL that identifies the category. |

##### `ProductCategory`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Category ID. To get the category's name or other details, use the [Categories API](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/introduction). |

##### `ProductOption`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Option ID. Pass it to `selectOption()`. |
| `key` | `string` | Option key. |
| `name` | `string \| undefined` | Option name, such as `Color`. |
| `optionRenderType` | `"TEXT_CHOICES" \| "SWATCH_CHOICES"` | Display style of the option's choices. |
| `choices` | `OptionChoice[]` | Choices the visitor can select for the option. |
| `isGroupedOption` | `boolean \| undefined` | Whether each of the option's choices stands for a separate product that the store groups with the others, such as one product per color. Selecting a choice other than the current product's navigates to that product's page. Grouping doesn't apply in a products list. `undefined` when the option isn't grouped. |

##### `UserInputErrorFields`

| Property | Type | Description |
| --- | --- | --- |
| `options` | `Record<string, "missing">` | Options with no selected choice, keyed by option ID. Each value is `'missing'`. Empty when the selected choices resolve to a variant. |
| `modifiers` | `Record<string, "missing">` | Mandatory modifiers that need a value, keyed by modifier ID. Each value is `'missing'`. A free-text modifier needs a non-empty value. Any other modifier needs the ID of one of its choices. |
| `quantity` | `QuantityError \| undefined` | Why the selected quantity isn't valid, or `undefined` when it's valid. |
| `subscriptionPlanId` | `"missing" \| undefined` | Subscription plan error. `'missing'` when the product is sold as a subscription and no valid plan is selected. `undefined` otherwise. |
