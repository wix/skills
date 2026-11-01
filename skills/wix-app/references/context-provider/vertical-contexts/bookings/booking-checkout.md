# Bookings context: `@wix/bookings/context/booking-checkout`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/booking-checkout`.

### `BookingCheckoutContextProvider`

Decodes the booking selection from the page URL and lets descendants book it or add it to the cart.

```ts
import { BookingCheckoutContextProvider } from '@wix/bookings/context/booking-checkout';
```

- **Parameters:** `__0: BookingCheckoutContextProviderProps`
- **Returns:** `Element`

### `canBookSelection`

```ts
import { canBookSelection } from '@wix/bookings/context/booking-checkout';
```

- **Parameters:** `selection: BookingPreferences \| null`
- **Returns:** `boolean`

### `useBookingCheckoutContext`

Reads the booking checkout state; returns null instead of throwing when `optional` is true and no provider is above.

```ts
import { useBookingCheckoutContext } from '@wix/bookings/context/booking-checkout';
```

- **Parameters:** `optional: true`
- **Returns:** `BookingCheckoutState \| null`

#### Returned types

##### `BookingCheckoutContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` |  |

##### `BookingPreferences`

| Property | Type | Description |
| --- | --- | --- |
| `mode` | `BookingMode` |  |
| `timezone` | `string \| null \| undefined` |  |
| `services` | `ServicePreference[]` |  |
| `wantsPromoCode` | `boolean \| undefined` | The visitor ticked "I have a coupon" in the Booking Summary, so checkout must not be skipped. Absent means unticked; writers omit `false`. |

##### `BookingCheckoutState`

| Property | Type | Description |
| --- | --- | --- |
| `selection` | `BookingPreferences \| null` | Null when the page has no usable `b=`. |
| `canBook` | `boolean` | Every entry passes canBookSelection and a booking form is registered. |
| `planAndBookFlow` | `PlanAndBookFlow` | The button the visitor sees and where createBooking sends them, from the selected rows. |
| `selectedPaymentOptions` | `(PaymentOption$1 \| null)[] \| null` | Null without resolved payment choices for the current selection. |
| `isLoadingPaymentOptions` | `boolean` |  |
| `registerPaymentOptions` | `(options: (PaymentOption$1 \| null)[] \| null, isPlanAndBookBlocked: boolean) => () => void` | Publish prices independently of form validation; null means payment options are loading. |
| `hasCartConflict` | `boolean` | From the registered form. |
| `registerForm` | `(form: BookingFormHandle \| null) => void` | The form registers on mount and passes null on unmount. |
| `formFacts` | `FormFacts \| null` | Published by the form; null until it is usable. |
| `publishFormFacts` | `(facts: FormFacts \| null) => void` | The form publishes its facts for the widgets beside it (Booking Summary); null on unmount. |
| `isFormEmptyState` | `boolean` | The form shows legacy's empty state in place of itself, so Book and Add to Cart hide, as legacy's did with it. |
| `publishFormEmptyState` | `(isEmptyState: boolean) => void` | The form publishes it while its empty state shows; false on unmount. |
| `createBooking` | `() => Promise<CreateBookingOutcome>` | Validates, creates the booking(s) and cart, then places the order or goes to checkout. One run at a time. |
| `isCreating` | `boolean` | Stays true on success while the checkout or thank-you page loads. |
| `createError` | `CheckoutError \| null` | The last failure; cleared by the next Book or Add to Cart, a changed selection or participant count. |
| `addToCart` | `(destination?: AddToCartDestination \| undefined) => Promise<AddToCartOutcome>` | Validates the form, creates the booking(s), adds them to the visitor's current cart and goes to `destination` (the cart page by default). Shares the guard with createBooking. |
| `isAddingToCart` | `boolean` | True from the click until a failure or a `stay`; stays true on success while the next page loads. |
| `addToCartError` | `CheckoutError \| null` | As createError, for Add to Cart. |
| `participants` | `number` | Participants for a single service without variants; 1 by default. Booked as totalParticipants. |
| `setParticipants` | `(count: number) => void` | Takes an integer of at least 1 (anything else books 1). Uncapped: as legacy, a max that drops later leaves it. |
| `lastResult` | `BookingCheckoutResult \| null` | For QA in the console. |

##### `PlanAndBookFlow`

| Property | Type | Description |
| --- | --- | --- |
| `cta` | `PlanAndBookCta` |  |
| `route` | `PlanAndBookRoute` |  |

##### `FormFacts`

| Property | Type | Description |
| --- | --- | --- |
| `payments` | `{ serviceId: string \| null; paymentOption: BookingPaymentOption; hasPrice: boolean; }[]` | How the visitor pays each booked service. |
| `hasBookingsInCart` | `boolean` | Bookings lines only, as in OOI's `isServiceInCart`. |
| `participantsPrice` | `PreviewedParticipantsPrice \| undefined` | Rule-based pricing only: the previewed price of the picked count and slot. |

##### `CheckoutError`

| Property | Type | Description |
| --- | --- | --- |
| `code` | `string` | applicationError.code, or UNKNOWN_CHECKOUT_ERROR without one. |
| `violation` | `string \| undefined` | The first violation's text, which eCom sends with VIOLATIONS_WITH_ERROR_SEVERITY. |

##### `BookingCheckoutResult`

| Property | Type | Description |
| --- | --- | --- |
| `bookingIds` | `string[]` |  |
| `cartId` | `string` |  |
