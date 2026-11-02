# Stores context: `@wix/stores/context/promotion-item`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/promotion-item`.

### `PromotionItemContextProvider`

Supplies the promotion for one product list promotion entry.

```ts
import { PromotionItemContextProvider } from '@wix/stores/context/promotion-item';
```

- **Parameters:** `__0: PromotionItemContextProviderProps`
- **Returns:** `Element`

### `usePromotionItemContext`

Reads the current promotion, or returns null outside a promotion item provider.

```ts
import { usePromotionItemContext } from '@wix/stores/context/promotion-item';
```

- **Parameters:** none
- **Returns:** `PromotionItemContextValue \| null`

#### Returned types

##### `PromotionItemContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `promotionItem` | `PromotionItem \| undefined` |  |
| `children` | `ReactNode` |  |

##### `PromotionItemContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | The id of the promotion |
| `name` | `string \| undefined` | The name of the promotion (should not be used for display) |
| `destinationUrl` | `Link \| undefined` | The destination URL of the promotion |
| `image` | `PromotionImage \| undefined` | The image of the promotion |
| `altText` | `string \| undefined` | The alt text of the promotion |
| `position` | `number` | The position of the promotion |

##### `PromotionImage`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | The id of the promotion |
| `url` | `string` |  |
| `width` | `number \| undefined` |  |
| `height` | `number \| undefined` |  |
