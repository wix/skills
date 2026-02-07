# Common Wix Events for CLI Event Extensions

This reference lists common event types, SDK imports, permissions, and links. For full payload shapes and additional events, see the [JavaScript SDK reference](https://dev.wix.com/docs/sdk).

## CRM Events

| Event | Import | Handler Call | Permission | API Reference |
| --- | --- | --- | --- | --- |
| Contact created | `import { contacts } from "@wix/crm"` | `contacts.onContactCreated(handler)` | Read Contacts | [onContactCreated](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/contact-created?apiView=SDK) |
| Contact updated | `import { contacts } from "@wix/crm"` | `contacts.onContactUpdated(handler)` | Read Contacts | [onContactUpdated](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/contact-updated?apiView=SDK) |
| Contact deleted | `import { contacts } from "@wix/crm"` | `contacts.onContactDeleted(handler)` | Read Contacts | [onContactDeleted](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/contact-deleted?apiView=SDK) |

**Example – contact created:**

```typescript
import { contacts } from "@wix/crm";

contacts.onContactCreated((event) => {
  const contact = event.entity;
  console.log("New contact:", contact.id, contact.info?.email);
});
```

## eCommerce Events

| Event | Import | Handler Call | Permission | API Reference |
| --- | --- | --- | --- | --- |
| Order created | `import { orders } from "@wix/ecom"` | `orders.onOrderCreated(handler)` | Read Orders | [onOrderCreated](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/order-created?apiView=SDK) |
| Order approved | `import { orders } from "@wix/ecom"` | `orders.onOrderApproved(handler)` | Read Orders | [onOrderApproved](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/order-approved?apiView=SDK) |
| Cart created | `import { cart } from "@wix/ecom"` | `cart.onCartCreated(handler)` | Read Orders | [onCartCreated](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/cart/cart-created?apiView=SDK) |
| Cart updated | `import { cart } from "@wix/ecom"` | `cart.onCartUpdated(handler)` | Read Orders | [onCartUpdated](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/cart/cart-updated?apiView=SDK) |

**Example – order approved:**

```typescript
import { orders } from "@wix/ecom";

orders.onOrderApproved(async (event) => {
  const order = event.entity;
  console.log("Order approved:", order.id);
});
```

## Bookings Events

| Event | Import | Handler Call | Permission | API Reference |
| --- | --- | --- | --- | --- |
| Booking confirmed | `import { bookings } from "@wix/bookings"` | `bookings.onBookingConfirmed(handler)` | Read bookings calendar - including participants | [onBookingConfirmed](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/booking-confirmed?apiView=SDK) |
| Booking canceled | `import { bookings } from "@wix/bookings"` | `bookings.onBookingCanceled(handler)` | Read bookings calendar - including participants | [onBookingCanceled](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/booking-canceled?apiView=SDK) |

**Example – booking confirmed:**

```typescript
import { bookings } from "@wix/bookings";

bookings.onBookingConfirmed((event) => {
  const booking = event.entity;
  console.log("Booking confirmed:", booking.id);
});
```

## Blog Events

| Event | Import | Handler Call | Permission | API Reference |
| --- | --- | --- | --- | --- |
| Post created | `import { posts } from "@wix/blog"` | `posts.onPostCreated(handler)` | Read Blog | [onPostCreated](https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/post-created?apiView=SDK) |
| Post updated | `import { posts } from "@wix/blog"` | `posts.onPostUpdated(handler)` | Read Blog | [onPostUpdated](https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/post-updated?apiView=SDK) |

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
