# Events context: `@wix/events/context/thank-you` (part 1 of 4)

This context's reference is split across 4 files: [thank-you.md](thank-you.md), [thank-you-2.md](thank-you-2.md), [thank-you-3.md](thank-you-3.md), [thank-you-4.md](thank-you-4.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/thank-you`.

### `ThankYouDataProvider`

```ts
import { ThankYouDataProvider } from '@wix/events/context/thank-you';
```

- **Parameters:** `__0: PropsWithChildren<{ data: ThankYouContextData; }>`
- **Returns:** `Element`

### `useThankYouContext`

Reads the registration result for the current event: the RSVP status, or the order and its checkout status.

```ts
import { useThankYouContext } from '@wix/events/context/thank-you';
```

- **Parameters:** none
- **Returns:** `ThankYouContextValue`

#### Returned types

##### `ThankYouContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `modal` | `ModalContextValue` |  |
| `rsvpStatus` | `RsvpThankYouStatus \| undefined` |  |
| `checkoutStatus` | `CheckoutStatus \| undefined` |  |
| `token` | `string \| undefined` |  |
| `order` | `Order \| undefined` |  |
| `orderHttpErrorStatus` | `number \| undefined` |  |
