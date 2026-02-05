# Common Wix Events for CLI Event Extensions

This reference lists common event types, SDK imports, permissions, and links. For full payload shapes and additional events, see the [JavaScript SDK reference](https://dev.wix.com/docs/sdk).

## CRM Events

| Event | Import | Handler Call | Permission | SDK Link |
| --- | --- | --- | --- | --- |
| Contact created | `import { contacts } from "@wix/crm"` | `contacts.onContactCreated(handler)` | Read Contacts | [onContactCreated](https://dev.wix.com/docs/sdk/backend-modules/crm/contacts/on-contact-created) |
| Contact updated | `import { contacts } from "@wix/crm"` | `contacts.onContactUpdated(handler)` | Read Contacts | [onContactUpdated](https://dev.wix.com/docs/sdk/backend-modules/crm/contacts/on-contact-updated) |
| Contact deleted | `import { contacts } from "@wix/crm"` | `contacts.onContactDeleted(handler)` | Read Contacts | [onContactDeleted](https://dev.wix.com/docs/sdk/backend-modules/crm/contacts/on-contact-deleted) |

**Example – contact created:**

```typescript
import { contacts } from "@wix/crm";

contacts.onContactCreated((event) => {
  const contact = event.entity;
  console.log("New contact:", contact.id, contact.info?.email);
});
```

## eCommerce Events

| Event | Import | Handler Call | Permission | SDK Link |
| --- | --- | --- | --- | --- |
| Order created | `import { orders } from "@wix/ecom"` | `orders.onOrderCreated(handler)` | Read Orders | [onOrderCreated](https://dev.wix.com/docs/sdk/backend-modules/ecom/orders/on-order-created) |
| Order approved | `import { orders } from "@wix/ecom"` | `orders.onOrderApproved(handler)` | Read Orders | [onOrderApproved](https://dev.wix.com/docs/sdk/backend-modules/ecom/orders/on-order-approved) |
| Cart created | `import { cart } from "@wix/ecom"` | `cart.onCartCreated(handler)` | Read Orders | [onCartCreated](https://dev.wix.com/docs/sdk/backend-modules/ecom/cart/on-cart-created) |

**Example – order approved:**

```typescript
import { orders } from "@wix/ecom";

orders.onOrderApproved(async (event) => {
  const order = event.entity;
  console.log("Order approved:", order.id);
});
```

## Bookings Events

| Event | Import | Handler Call | Permission | SDK Link |
| --- | --- | --- | --- | --- |
| Booking confirmed | `import { bookings } from "@wix/bookings"` | `bookings.onBookingConfirmed(handler)` | Read bookings calendar - including participants | [onBookingConfirmed](https://dev.wix.com/docs/sdk/backend-modules/bookings/bookings/on-booking-confirmed) |
| Booking canceled | `import { bookings } from "@wix/bookings"` | `bookings.onBookingCanceled(handler)` | Read bookings calendar - including participants | [onBookingCanceled](https://dev.wix.com/docs/sdk/backend-modules/bookings/bookings/on-booking-canceled) |

**Example – booking confirmed:**

```typescript
import { bookings } from "@wix/bookings";

bookings.onBookingConfirmed((event) => {
  const booking = event.entity;
  console.log("Booking confirmed:", booking.id);
});
```

## Blog Events

| Event | Import | Handler Call | Permission | SDK Link |
| --- | --- | --- | --- | --- |
| Post created | `import { posts } from "@wix/blog"` | `posts.onPostCreated(handler)` | Read Blog | [onPostCreated](https://dev.wix.com/docs/sdk/backend-modules/blog/posts/on-post-created) |
| Post updated | `import { posts } from "@wix/blog"` | `posts.onPostUpdated(handler)` | Read Blog | [onPostUpdated](https://dev.wix.com/docs/sdk/backend-modules/blog/posts/on-post-updated) |

**Example – post created:**

```typescript
import { posts } from "@wix/blog";

posts.onPostCreated((event) => {
  const post = event.entity;
  console.log("Post created:", post.id, post.title);
});
```

## Payload Shape

Event handlers receive an object (often called `event` or envelope) that includes:

- **entity** – The main resource (contact, order, booking, post, etc.).
- **metadata** – Context such as site ID, instance ID, timestamp.

Exact types are in the SDK; use TypeScript and your IDE for autocomplete and type safety.
