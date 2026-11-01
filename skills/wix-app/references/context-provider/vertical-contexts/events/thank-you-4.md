# Events context: `@wix/events/context/thank-you` (part 4 of 4)

This context's reference is split across 4 files: [thank-you.md](thank-you.md), [thank-you-2.md](thank-you-2.md), [thank-you-3.md](thank-you-3.md), [thank-you-4.md](thank-you-4.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/thank-you`.

##### `Order`

| Property | Type | Description |
| --- | --- | --- |
| `created` | `Date \| null \| undefined` | Date and time the order was created. |
| `eventId` | `string \| undefined` | Event ID to which the order belongs. |
| `orderNumber` | `string \| undefined` | Unique order number. |
| `reservationId` | `string \| undefined` | Reservation ID. |
| `snapshotId` | `string \| undefined` | Payment snapshot ID. Empty for the `FREE` order. |
| `contactId` | `string \| undefined` | Contact ID of buyer, resolved using the email address specified. See the Contacts API for additional information. |
| `memberId` | `string \| undefined` | Buyer member ID, if applicable. |
| `firstName` | `string \| undefined` | Guest first name. |
| `lastName` | `string \| undefined` | Guest last name. |
| `email` | `string \| undefined` | Guest email address. |
| `checkoutForm` | `FormResponse \| undefined` | Checkout form response. When each purchased ticket is assigned to a guest, guest forms are returned for each ticket, and buyer info is returned. |
| `confirmed` | `boolean \| undefined` | Whether the order is confirmed. Triggered once the payment gateway processes the payment and funds reach the merchant's account. |
| `status` | `OrderStatusWithLiterals \| undefined` | Order status. Possible values: - `FREE`: The order is confirmed, no payment is required. - `PENDING`: The order was paid, but the payment gateway suspended the payment. - `PAID`: The order is paid. - `OFFLINE_PENDING`: The order is confirmed but has to be paid in cash and the status is manually updated to `PAID`. - `INITIATED`: The order is awaiting for payment. - `CANCELED`: The order is canceled. - `DECLINED`: The order is payment is declined. |
| `method` | `string \| undefined` | Payment method used for purchase, for example, "payPal", "creditCard", etc. |
| `ticketsQuantity` | `number \| undefined` | Quantity of ordered tickets. |
| `totalPrice` | `Money \| undefined` | Total order price. |
| `ticketsPdf` | `string \| undefined` | Ticket PDF URL. |
| `archived` | `boolean \| undefined` | Whether the order is archived. |
| `anonymized` | `boolean \| undefined` | Whether the order is anonymized by GDPR delete. |
| `fullName` | `string \| undefined` | Guest full name. |
| `invoice` | `Invoice \| undefined` | Order invoice. |
| `fullyCheckedIn` | `boolean \| undefined` | Whether all tickets in an order are checked in. |
| `paymentDetails` | `PaymentDetails \| undefined` | Internal order payment details. |
| `channel` | `ChannelTypeWithLiterals \| undefined` | Checkout channel type. |
| `updated` | `Date \| null \| undefined` | Date and time the order was last updated. |
| `giftCardPaymentDetails` | `GiftCardPaymentDetails[] \| undefined` | Gift card payments, including voided payments. |
| `marketingConsent` | `boolean \| null \| undefined` | Whether marketing consent was given. |
| `tickets` | `TicketingTicket[] \| undefined` |  |
| `checkoutFormSubmission` | `FormSubmission$1 \| undefined` |  |
