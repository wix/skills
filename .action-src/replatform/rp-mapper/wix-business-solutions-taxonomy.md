# Wix Business Solutions Taxonomy For `rp-mapper`

This file is a curated, mapper-oriented taxonomy of Wix business solutions and their primary entities.

Use it during `rp-mapper` to:
- classify each discovered source entity into a likely Wix solution area
- distinguish native Wix targets from data that requires custom collections
- keep mappings explicit and consistent across migration projects

This is intentionally curated, not exhaustive. Prefer stable, first-party solutions and stable entity families that are relevant for migration planning.

## Primary source docs

- [About Wix APIs](https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/about-wix-apis)
- [Integrating with Wix's Business Solutions](https://dev.wix.com/docs/build-apps/get-started/overview/integrating-with-wix-s-business-solutions)
- [Business Solutions | Wix Studio](https://www.wix.com/studio/business-solutions)

## Critical distinction: `eCommerce` vs `Stores`

This distinction must stay explicit in mapper output.

### `Wix eCommerce`

`Wix eCommerce` is the shared commerce platform layer.
It owns the purchase flow and operational commerce entities that are reused across multiple vertical apps.

Typical `eCommerce` entities:
- carts
- checkouts
- orders
- order billing / refunds
- payment and fulfillment state tied to orders

Use `eCommerce` when the source data is about:
- cart contents
- checkout state
- order lifecycle
- fulfillment and payment operations
- cross-vertical commerce operations that are not specific to a single catalog app

### `Wix Stores`

`Wix Stores` is a vertical app built on top of the commerce platform.
It owns the product catalog and store-specific merchandising model.

Typical `Stores` entities:
- products
- categories / collections
- variants
- inventory items
- store inventory locations

Use `Stores` when the source data is about:
- product catalog structure
- product options and merchandising
- stock and inventory allocation
- store-specific catalog metadata

### Other vertical apps

Other business apps also sit above shared platform layers and bring their own domain model:
- `Bookings`: services, staff, resources, schedules, bookings
- `Events`: events, ticket definitions, tickets, RSVPs, guests
- `Restaurants`: menus, sections, items, modifiers, reservation locations, reservations
- `Pricing Plans`: plans and plan orders / subscriptions

If the source platform mixes these layers together, separate them in the mapping plan instead of collapsing them into one Wix target.

## Solution index

| Solution | Role in Wix | Main docs |
| --- | --- | --- |
| `ecommerce` | Shared purchase-flow platform across commerce-enabled apps | [eCommerce overview](https://dev.wix.com/docs/build-apps/get-started/overview/integrating-with-wix-s-business-solutions) |
| `stores` | Product catalog and merchandising app for physical/digital goods | [Wix Stores Catalog API](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/query-collections?apiView=SDK) |
| `bookings` | Service business app for appointments, classes, and courses | [About Wix Bookings](https://dev.wix.com/docs/rest/business-solutions/bookings/about-wix-bookings) |
| `events` | Event management, ticketing, RSVP, and guest lifecycle | [About the Wix Events API](https://dev.wix.com/docs/api-reference/business-solutions/events/introduction?apiView=SDK) |
| `restaurants` | Food business apps for menus, ordering, and reservations | [About the Menus API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/menus/introduction) |
| `pricing-plans` | Memberships, subscriptions, plans, and plan orders | [About Wix Pricing Plans](https://dev.wix.com/docs/rest/business-solutions/pricing-plans/pricing-plans/introduction) |
| `payments` | Payment processing and transaction infrastructure | [About Wix Payments](https://dev.wix.com/docs/api-reference/business-management/payments/wix-payments-provider/about-wix-payments) |
| `crm` | Contacts, labels, and CRM extensions around customer identity | [About the Contacts API](https://dev.wix.com/docs/rest/crm/members-contacts/contacts/introduction) |
| `members` | Site membership, profiles, badges, member custom fields | [About the Members APIs](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/introduction) |
| `blog` | Blog content model for posts, categories, and tags | [About the Blog APIs](https://dev.wix.com/docs/sdk/backend-modules/blog/introduction) |
| `cms` | Custom collections and custom items when native apps are insufficient | [About the Wix Data APIs](https://dev.wix.com/docs/api-reference/business-solutions/cms/introduction) |

---

## `ecommerce`

Main page:
- [Integrating with Wix's Business Solutions](https://dev.wix.com/docs/build-apps/get-started/overview/integrating-with-wix-s-business-solutions)

Short description:
- Shared commerce platform for purchase flow and order operations. It is the canonical target for carts, checkouts, and orders, even when catalog data originates in a vertical app such as Stores or Bookings.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `cart` | First phase of the purchase flow; holds line items, buyer references, discounts, and pricing context before checkout | [About the eCommerce Cart API](https://dev.wix.com/docs/rest/business-solutions/e-commerce/purchase-flow/cart/cart/introduction) |
| `current-cart` | Visitor/member scoped cart used in live purchase flows | [About the eCommerce Current Cart API](https://dev.wix.com/docs/sdk/backend-modules/ecom/current-cart/introduction) |
| `checkout` | Second phase of purchase flow; holds calculated prices, tax, billing, shipping, and discount state before order creation | [About the eCommerce Checkout API](https://dev.wix.com/docs/sdk/backend-modules/ecom/checkout/introduction) |
| `order` | Final commerce record for completed or externally recorded purchases | [About the Orders API](https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/orders/introduction) |
| `order-billing` | Payment capture, void, and refund operations for eCommerce orders | [About the Order Billing API](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/order-billing/introduction) |

Mapper notes:
- If the source platform exposes products and orders in one model, split catalog entities into the vertical app and transaction entities into `ecommerce`.
- If the source has historical orders but no cart or checkout history, map directly to `order` and document missing pre-purchase state.

---

## `stores`

Main page:
- [About the Wix Stores Catalog API](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/query-collections?apiView=SDK)

Short description:
- Vertical commerce app for managing a store catalog, merchandising structure, variants, and inventory. `Stores` sits above the shared `eCommerce` purchase flow.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `product` | Core sellable item with media, pricing, metadata, and variants | [About Products](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/introduction) |
| `category` | Hierarchical merchandising structure for organizing products | [About the Wix Categories API](https://dev.wix.com/docs/api-reference/business-management/categories/introduction) |
| `collection` | Read-only CMS mirror of store collections for querying and display | [Wix Stores Collections](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/wix-app-collections/wix-stores-collections) |
| `inventory-item` | Inventory state for store products and variants | [About the Inventory API](https://dev.wix.com/docs/api-reference/business-solutions/stores/inventory/introduction) |
| `stores-location` | Inventory locations used by the store catalog | [About the Stores Locations API](https://dev.wix.com/docs/sdk/backend-modules/stores/catalog-v3/stores-locations-v3/introduction) |
| `catalog-version` | Identifies whether a site is on Stores Catalog V1 or V3 | [About the Catalog Versioning API](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-versioning/introduction) |

Mapper notes:
- Prefer `stores` for product catalog migration, not `ecommerce`.
- `variant` data is typically modeled under product APIs rather than as a standalone top-level app.
- If the source has faceted product groupings, map them first to `category`; use custom collections only when the source model exceeds Wix's native merchandising structure.

---

## `bookings`

Main page:
- [About Wix Bookings](https://dev.wix.com/docs/rest/business-solutions/bookings/about-wix-bookings)

Short description:
- Vertical app for service businesses. Handles services, provider availability, resources, scheduling, and customer bookings. Payment and order flow can connect into shared commerce layers.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `service` | Bookable offering such as an appointment, class, or course | [About the Services V2 API](https://dev.wix.com/docs/sdk/backend-modules/bookings/services/introduction) |
| `service-category` | Organizes services for display and discovery | [About the Bookings Services APIs](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/introduction) |
| `staff-member` | Person providing services, including service assignments and working hours | [About the Staff Members API](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/introduction) |
| `resource` | Non-staff business asset needed to deliver a service, such as a room or equipment | [About the Resource APIs](https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/introduction) |
| `booking` | Customer booking record and lifecycle state | [About the Bookings APIs](https://dev.wix.com/docs/rest/business-solutions/bookings/bookings/about-the-bookings-apis) |
| `time-slot` | Availability window for bookable services | [Time Slots V2 API](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/introduction) |
| `external-calendar-connection` | Sync bridge between Bookings schedules and external calendars | [About the External Calendars API](https://dev.wix.com/docs/sdk/backend-modules/bookings/external-calendars/setup) |

Mapper notes:
- Service catalogs belong in `bookings`, not `stores`.
- Staff and resources are distinct. Human providers should map to `staff-member`; rooms/equipment should map to `resource`.
- If the source system mixes booking payment data into reservations, split booking lifecycle from commerce/order lifecycle.

---

## `events`

Main page:
- [About the Wix Events API](https://dev.wix.com/docs/api-reference/business-solutions/events/introduction?apiView=SDK)

Short description:
- Vertical app for event management, registration, ticketing, and guest handling.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `event` | Top-level event record with schedule, registration mode, and event metadata | [About the Wix Events API](https://dev.wix.com/docs/api-reference/business-solutions/events/introduction?apiView=SDK) |
| `ticket-definition` | Ticket type template such as General Admission or VIP | [Event Management introduction](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/introduction) |
| `ticket` | Purchased ticket with guest and check-in state | [About the Tickets API](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/tickets/introduction?apiView=SDK) |
| `event-order` | Ticket purchase and registration order lifecycle | [About the Orders API](https://dev.wix.com/docs/sdk/backend-modules/events/orders/on-order-initiated) |
| `rsvp` | RSVP response and attendance state for non-ticketed events | [About RSVP API](https://dev.wix.com/docs/sdk/backend-modules/events/rsvp/introduction) |
| `event-guest` | Unified guest record across ticketed and RSVP events | [About the Event Guests API](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/event-guests/introduction?apiView=SDK) |
| `events-registration` | Registration layer connecting RSVP, ticketing, and guests | [About Events Registration](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/introduction) |

Mapper notes:
- Use `event`, `ticket-definition`, and `ticket` for ticketed-event catalogs.
- Use `rsvp` and `event-guest` for RSVP-only sources.
- If the source system has attendee records without event-level structure, document the lossiness and create an event grouping strategy before import.

---

## `restaurants`

Main pages:
- [About the Menus API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/menus/introduction)
- [Reservations API introduction](https://dev.wix.com/docs/rest/business-solutions/restaurants/wix-restaurants-new/reservations/introduction)

Short description:
- Vertical app family for food businesses. Covers food catalog structure, restaurant reservations, and restaurant-specific operations.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `menu` | Top-level menu such as Breakfast, Lunch, or Dinner | [About Menus](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/menus/menus/introduction) |
| `menu-section` | Section within a menu such as Appetizers or Desserts | [About the Menus API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/menus/introduction) |
| `menu-item` | Individual dish or item sold by the restaurant | [About the Menus API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/menus/introduction) |
| `item-modifier-group` | Group of selectable modifiers such as toppings or sides | [About the Menus API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/menus/introduction) |
| `item-variant` | Size or other priced variant of a menu item | [About the Menus API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/menus/introduction) |
| `reservation-location` | Physical restaurant location and reservation configuration | [Reservations Locations API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/reservation-location-updated) |
| `reservation` | Reservation lifecycle record for a party at a restaurant | [About the Reservations API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/reservations/reservations/introduction) |
| `restaurant-time-slot` | Availability window for reservation booking | [Reservations API introduction](https://dev.wix.com/docs/rest/business-solutions/restaurants/wix-restaurants-new/reservations/introduction) |
| `experience` | Special dining experience such as chef's table or tasting menu | [Experiences API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/wix-restaurants-new/reservations/experiences/introduction) |
| `restaurant-order-legacy` | Legacy restaurant order model from the original Restaurants Orders app | [About Wix Restaurants Orders](https://dev.wix.com/docs/rest/business-solutions/restaurants/wix-restaurants/orders/introduction) |

Mapper notes:
- Restaurants spans multiple subdomains: menus, reservations, and in some cases restaurant ordering.
- Menu catalogs should not be mapped to `stores.product` unless the migration intentionally flattens restaurant content into a generic catalog.
- The old Restaurants Orders and Catalogs docs are still useful for legacy migrations, but prefer the newer Menus and Reservations APIs when possible.

---

## `pricing-plans`

Main page:
- [About Wix Pricing Plans](https://dev.wix.com/docs/rest/business-solutions/pricing-plans/pricing-plans/introduction)

Short description:
- Vertical app for memberships, subscriptions, bundles, and access plans. Often composes with Bookings, Events, Blog, and Members.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `plan` | Membership or subscription offering with pricing model and entitlement structure | [About the Plans V3 API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans?apiView=SDK) |
| `pricing-plan-order` | Purchase/subscription record for a plan | [About the Orders API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/introduction?apiView=SDK) |
| `benefit-program-linkage` | Underlying credit/benefit program connection used by some plans | [About Wix Pricing Plans](https://dev.wix.com/docs/rest/business-solutions/pricing-plans/pricing-plans/introduction) |

Mapper notes:
- Pricing Plans is not the same as generic payment transactions.
- Use `plan` for memberships/bundles/subscriptions and `pricing-plan-order` for subscriptions purchased by members.
- If the source platform tracks remaining credits or entitlements, document whether Wix native benefit-program behavior is sufficient or whether extra CMS/custom logic is required.

---

## `payments`

Main page:
- [About Wix Payments](https://dev.wix.com/docs/api-reference/business-management/payments/wix-payments-provider/about-wix-payments)

Short description:
- Payment-processing infrastructure used by commerce-enabled Wix solutions. It is not a replacement for `ecommerce.order`; it handles transaction processing.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `payment-transaction` | Authorization, capture, recurring charge, refund, void, and dispute lifecycle | [Transactions API](https://dev.wix.com/docs/api-reference/business-management/payments/wix-payments-provider/transactions/introduction) |
| `wix-payments-provider` | Payment provider integration surface for accepting supported payment methods | [About Wix Payments](https://dev.wix.com/docs/api-reference/business-management/payments/wix-payments-provider/about-wix-payments) |

Mapper notes:
- Historical payment records may map to payment transactions, but the business transaction usually still belongs to an order, booking, or plan order.
- Do not map catalog or customer data into `payments`.

---

## `crm`

Main pages:
- [About the Contacts API](https://dev.wix.com/docs/rest/crm/members-contacts/contacts/introduction)
- [About the Members and Contacts APIs](https://dev.wix.com/docs/api-reference/crm/members-contacts/introduction)

Short description:
- Customer identity and segmentation layer centered on contacts and CRM metadata.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `contact` | Core person/business contact record for site interactions | [About the Contacts API](https://dev.wix.com/docs/sdk/backend-modules/crm/contacts/introduction) |
| `contact-label` | Segment/tag for organizing contacts | [About the Labels API](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/introduction) |
| `contact-extended-field` | Additional schema fields stored on contacts | [About the Extended Fields API](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/extended-fields/introduction) |
| `pipeline` | CRM process pipeline for leads/deals/workflow stages | [About the Pipelines API](https://dev.wix.com/docs/api-reference/crm/crm/pipelines-management/pipelines/pipeline-updated) |
| `form-schema` | Structured form definition often used to create leads and capture CRM data | [About the Form Schemas API](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-created) |

Mapper notes:
- Use `crm.contact` for person/company records even if the source platform calls them customers, clients, leads, or subscribers.
- Use labels and extended fields before defaulting to a custom collection for lightweight CRM enrichment.

---

## `members`

Main page:
- [About the Members APIs](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/introduction)

Short description:
- Site membership and community model layered on top of contacts, with profile, privacy, badge, and member-profile extension support.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `member` | Site member account and profile identity | [About the Members API](https://dev.wix.com/docs/sdk/backend-modules/members/members/introduction) |
| `member-about` | Rich profile “About” content | [About the Members About API](https://dev.wix.com/docs/sdk/backend-modules/members/members-about/introduction) |
| `member-badge` | Badge definition assigned to members | [About the Badges API](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/activity/badges/introduction?apiView=SDK) |
| `badge-assignment` | Assignment of a badge to a member | [About the Badge Assignments API](https://dev.wix.com/docs/sdk/backend-modules/members/badge-assignments/introduction) |
| `member-custom-field` | Extra profile schema beyond the default member fields | [About Custom Fields](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/custom-fields/introduction) |

Mapper notes:
- A `member` is not identical to a `contact`, though the two are related.
- If the source platform has authenticated end users with profile data, map account identity to `member` and broader person data to `contact` where appropriate.

---

## `blog`

Main page:
- [About the Blog APIs](https://dev.wix.com/docs/sdk/backend-modules/blog/introduction)

Short description:
- Blog content model for editorial content and content categorization.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `blog-post` | Published or draft article content | [About the Blog APIs](https://dev.wix.com/docs/sdk/backend-modules/blog/introduction) |
| `blog-category` | Topical grouping for posts | [Categories API](https://dev.wix.com/docs/velo/apis/wix-blog-backend/categories/introduction) |
| `blog-tag` | Lightweight filterable tagging for posts | [About the Tags API](https://dev.wix.com/docs/sdk/backend-modules/blog/tags/introduction) |

Mapper notes:
- Use native blog entities when the source content is editorial publishing content.
- If the source has custom structured content that exceeds blog post semantics, consider `cms` instead.

---

## `cms`

Main pages:
- [About the Wix Data APIs](https://dev.wix.com/docs/api-reference/business-solutions/cms/introduction)
- [About Collection Management](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/introduction?apiView=SDK)

Short description:
- Generic data layer for custom collections and items. This is the default fallback when no native business app entity is sufficient.

Primary entities:

| Entity | What it does | Docs |
| --- | --- | --- |
| `data-collection` | Custom schema / table-like collection in the Wix CMS | [About the Data Collections API](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-collections/introduction) |
| `data-item` | Row/document stored in a custom collection | [About the Data Items API](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/introduction) |
| `wix-app-collection` | Read-only CMS mirror of data owned by Wix business apps | [About Wix App Collections](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/wix-app-collections/introduction) |

Mapper notes:
- Use `cms` only when the source concept does not fit a stable native Wix business entity, or when the business requires custom structured data beyond the native app model.
- When falling back to `cms`, explicitly explain why native `stores`, `bookings`, `events`, `pricing-plans`, `crm`, or `members` entities are insufficient.

## Classification heuristics for `rp-mapper`

Use these heuristics before inventing custom targets:

1. If the source entity represents a sellable good with variants, inventory, or merchandising structure, start in `stores`.
2. If it represents a purchasable service with providers, schedules, or availability, start in `bookings`.
3. If it represents a live/virtual gathering with attendees, tickets, or RSVPs, start in `events`.
4. If it represents menu/catalog content for a food business or restaurant reservations, start in `restaurants`.
5. If it represents subscriptions, memberships, bundles, or entitlements, start in `pricing-plans`.
6. If it represents carts, checkouts, or orders across verticals, start in `ecommerce`.
7. If it represents customer identity or segmentation, start in `crm` and `members`.
8. If it represents editorial publishing, start in `blog`.
9. If none of the above fits cleanly, use `cms` and document the gap.

## Maintenance notes

- Prefer first-party Wix docs under `dev.wix.com` for updates.
- Update this file when Wix introduces a new stable business solution or materially changes entity boundaries.
- Preserve the explicit `eCommerce` vs `Stores` distinction. That boundary is important for migration planning and import code generation.
