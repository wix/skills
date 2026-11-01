# Events context: `@wix/events/context/registration`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/registration`.

### `CheckoutState`

```ts
import { CheckoutState } from '@wix/events/context/registration';
```

- **Parameters:** `__0: { children?: ReactNode; }`
- **Returns:** `Element`

### `RegistrationContent`

```ts
import { RegistrationContent } from '@wix/events/context/registration';
```

- **Parameters:** `__0: PropsWithChildren<{ promise: Promise<{ policies: Policy[]; invoiceData: GetInvoiceResponse \| undefined; orderData: OrderData; formData: { forms: Record<string, Form$1 \| undefined>; fallbackFormId: string \| undefined; }; reservationId: string \| undefined; }>; }>`
- **Returns:** `Element`

### `RegistrationDataProvider`

```ts
import { RegistrationDataProvider } from '@wix/events/context/registration';
```

- **Parameters:** `__0: PropsWithChildren<{ data: { policies: Policy[]; invoiceData: GetInvoiceResponse \| undefined; orderData: OrderData; formData: { forms: Record<string, Form$1 \| undefined>; fallbackFormId: string \| undefined; }; reservationId: string \| undefined; }; }>`
- **Returns:** `Element`

### `RegistrationState`

```ts
import { RegistrationState } from '@wix/events/context/registration';
```

- **Parameters:** `__0: PropsWithChildren<Pick<RegistrationValue, "checkout" \| "rsvp">>`
- **Returns:** `Element`

### `RsvpState`

```ts
import { RsvpState } from '@wix/events/context/registration';
```

- **Parameters:** `__0: { children?: ReactNode; }`
- **Returns:** `Element`

### `useRegistrationContext`

Reads the registration state for the current event: its checkout or RSVP flow, registration data, and modal state.

```ts
import { useRegistrationContext } from '@wix/events/context/registration';
```

- **Parameters:** none
- **Returns:** `RegistrationValue`

#### Returned types

##### `RegistrationValue`

| Property | Type | Description |
| --- | --- | --- |
| `checkout` | `{ coupon: DiscountState<CouponErrorCode>; giftCard: DiscountState<GiftCardErrorCode>; membership: DiscountState<never>; couponVisible: boolean; giftCardVisible: boolean; membershipVisible: boolean; applyCoupon: (code: string) => Promise<void>; removeCoupon: () => Promise<void>; applyGiftCard: (code: string) => Promise<void>; removeGiftCard: () => Promise<void>; applyMembership: (planOrderId: string) => Promise<void>; steps: CheckoutStep[]; currentStep: CheckoutStep; loadingStep: CheckoutStep \| undefined; completedSteps: CheckoutStep[]; error: string \| undefined; order: Order \| undefined; invoice: Invoice \| undefined; expires: Date \| null \| undefined; giftCardPaymentDetails: GiftCardPaymentDetails[] \| undefined; paymentMethod: string \| undefined; buyerDetails: FormValues; buyerDetailsDisabledTargets: string[]; guestDetails: FormValues[]; useBuyerDetails: boolean; policiesAgreed: boolean; submitDelayed: boolean; submitDisabled: boolean; setPaymentMethod: Dispatch<SetStateAction<string \| undefined>>; setBuyerDetails: Dispatch<SetStateAction<FormValues>>; setGuestDetails: (index: number, values: FormValues) => void; setUseBuyerDetails: Dispatch<SetStateAction<boolean>>; setPoliciesAgreed: (agreed: boolean) => void; expressCheckout: (paymentDetailsId: string) => Promise<ClientStatus \| undefined>; submitStep: (step: CheckoutStep) => Promise<void>; editStep: (step: CheckoutStep) => void; completePayment: (status?: CheckoutStatus \| undefined, placedOrder?: Order \| undefined) => Promise<boolean>; } \| undefined` |  |
| `rsvp` | `{ steps: RsvpStep[]; currentStep: RsvpStep; loadingStep: RsvpStep \| undefined; completedSteps: RsvpStep[]; error: string \| undefined; guestDetails: FormValues; guestDetailsDisabledTargets: string[]; policiesAgreed: boolean; submitDelayed: boolean; setGuestDetails: Dispatch<SetStateAction<FormValues>>; setPoliciesAgreed: (agreed: boolean) => void; submitStep: (step: RsvpStep) => Promise<void>; editStep: (step: RsvpStep) => void; } \| undefined` |  |
| `modal` | `ModalContextValue` |  |
| `policies` | `Policy[]` |  |
| `invoiceData` | `GetInvoiceResponse \| undefined` |  |
| `orderData` | `OrderData` |  |
| `formData` | `{ forms: Record<string, Form$1 \| undefined>; fallbackFormId: string \| undefined; }` |  |
| `reservationId` | `string \| undefined` |  |

##### `Policy`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string \| null \| undefined` | Policy ID. |
| `revision` | `string \| null \| undefined` | Revision number, which increments by 1 each time the policy is updated. The existing revision must be used when updating a policy to prevent conflicting changes. You'll get an error if you try to use the previous revision. |
| `_createdDate` | `Date \| null \| undefined` | Date and time when the policy was created. |
| `_updatedDate` | `Date \| null \| undefined` | Date and time of the policy's latest update in. |
| `name` | `string \| undefined` | Policy name that is visible in the dashboard and checkout form. Min: 1 character Max: 40 characters |
| `body` | `string \| undefined` | Policy body, usually containing various terms and conditions. Min: 1 character Max: 50000 characters. **Note**: You can format text using various HTML tags such as `<p>`, `<b>`, `<ul>`, etc. |
| `eventId` | `string \| undefined` | ID of the event to which the policy belongs. |

##### `GetInvoiceResponse`

| Property | Type | Description |
| --- | --- | --- |
| `invoice` | `Invoice \| undefined` | Invoice with applied discount. |
| `discountErrors` | `DiscountErrors \| undefined` | Discount errors, if relevant. |
| `expires` | `Date \| null \| undefined` | Reservation expiration time. |
| `reservationStatus` | `ReservationStatusWithLiterals \| undefined` | Reservation status. Possible values: - `RESERVATION_PENDING`: The reservation is pending confirmation. It will expire after a certain amount of time. - `RESERVATION_CONFIRMED`: The reservation is confirmed and will not expire. - `RESERVATION_CANCELED`: The reservation is canceled because it's not paid. - `RESERVATION_CANCELED_MANUALLY`: The reservation is canceled manually by the buyer. - `RESERVATION_EXPIRED`: The reservation has expired. |
| `reservationOccupied` | `boolean \| undefined` | Whether this reservation is already used in a checkout. |
| `reservations` | `TicketReservation[] \| undefined` | Ticket reservations. |
| `giftCardPaymentDetails` | `GiftCardPaymentDetails[] \| undefined` | Projected gift card payments. |
| `giftCardErrors` | `GiftCardErrors \| undefined` | Gift card errors, if relevant. |

##### `OrderData`

| Property | Type | Description |
| --- | --- | --- |
| `order` | `Order \| undefined` |  |
| `httpErrorStatus` | `number \| undefined` |  |
