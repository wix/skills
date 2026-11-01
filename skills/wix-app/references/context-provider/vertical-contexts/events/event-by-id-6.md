# Events context: `@wix/events/context/event-by-id` (part 6 of 6)

This context's reference is split across 6 files: [event-by-id.md](event-by-id.md), [event-by-id-2.md](event-by-id-2.md), [event-by-id-3.md](event-by-id-3.md), [event-by-id-4.md](event-by-id-4.md), [event-by-id-5.md](event-by-id-5.md), [event-by-id-6.md](event-by-id-6.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event-by-id`.

##### `GetCheckoutOptionsResponse$1`

| Property | Type | Description |
| --- | --- | --- |
| `paymentMethodConfigured` | `boolean \| undefined` | Whether any payment method is configured and available for payment. |
| `acceptCoupons` | `boolean \| undefined` | Whether coupons are accepted at checkout. |
| `premiumServices` | `boolean \| undefined` | Whether premium services are enabled. Enabled for free if site doesn't sell any paid tickets. Selling tickets for a fee requires a premium feature `"events_sell_tickets"`. |
| `paidTickets` | `boolean \| undefined` | Whether there are any paid tickets available for sale. |
| `acceptGiftCards` | `boolean \| undefined` | Whether gift cards are accepted at checkout. |

##### `ModalContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `activeModal` | `ActiveModal \| undefined` |  |
| `openModal` | `<Type extends ModalType>(type: Type, props: ModalPropsByType[Type] & Partial<ModalDismissProps>) => void` |  |
| `openCustomModal` | `(render: ModalRenderFn) => void` |  |
| `closeModal` | `() => void` |  |

##### `RichContent$1`

| Property | Type | Description |
| --- | --- | --- |
| `nodes` | `Node[] \| undefined` | Node objects representing a rich content document. |
| `metadata` | `Metadata \| undefined` | Object metadata. |
| `documentStyle` | `DocumentStyle \| undefined` | Global styling for header, paragraph, block quote, and code block nodes in the object. |

##### `ParsedMainImage`

| Property | Type | Description |
| --- | --- | --- |
| `uri` | `string` | Wix Media ID of the image. For example, `936ad1_09b33941d2854a5bb7fc93f78d30e85d~mv2.png`. |
| `name` | `string` | Name of the image: the event's name. |
| `width` | `number` | Width of the image, in pixels. When the image's width or height isn't known, `width` is `1200` and `height` is `800`. |
| `height` | `number` | Height of the image, in pixels. When the image's width or height isn't known, `width` is `1200` and `height` is `800`. |
| `alt` | `string` | Alternative text of the image: the event's name. |

##### `Link$1`

| Property | Type | Description |
| --- | --- | --- |
| `href` | `string \| undefined` | The link URL. For partial links (see `pageRole`), this is the router prefix (e.g. `https://www.my-site.com/prefix`) rather than a fully resolved URL. |
| `target` | `LinkTarget \| undefined` | Where this link should open. - `'_self'` — opens in the same page. - `'_blank'` — opens in a new tab. |
| `rel` | `string \| undefined` |  |
| `pageRole` | `string \| undefined` | Page role identifier. Present only on partial links, where only the router prefix is known and the full URL format is owned by the Router/App. Applications can use such links in functions to resolve the complete URL at runtime (e.g. for binding links). Resolved links will not have this field. |
