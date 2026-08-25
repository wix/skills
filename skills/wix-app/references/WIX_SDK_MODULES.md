# Wix SDK Modules — Existing Wix App Data Is Never CMS

**The rule:** If the data a user asks about is owned by an existing Wix business app (Stores, eCommerce, Bookings, Events, CRM, etc.), read and write it through that app's **Wix SDK module**. Do **NOT** create a CMS Data Collection to model it — a new collection would be empty, disconnected from the real data, and the app's dashboards would show nothing (e.g., a "refunds dashboard" built on a custom collection shows an empty state while real refunded orders exist in Wix eCommerce).

Create a Data Collection **only** for data your app itself owns — configuration, rules, app-specific records that no Wix app manages. See [DATA_COLLECTION.md](DATA_COLLECTION.md).

## How to use this file

1. Identify the entity the user mentioned (orders, products, contacts, invoices, reviews…).
2. Find it in the map below → that's the SDK package to install and import.
3. Discover the exact methods with MCP: `SearchWixSDKDocumentation` (maxResults: 5), then `ReadFullDocsMethodSchema` for signatures and permissions. **Never conclude "no SDK exists, I'll create CMS" without at least one MCP search.**
4. If the entity is not in the map and MCP finds no SDK module for it, only then treat it as app-owned data (CMS candidate).

## Domain → SDK module map

### Commerce

| Entities | SDK package | Notes |
| --- | --- | --- |
| Orders, carts, checkout, order transactions & refund records, fulfillments, discount rules, back-in-stock notifications | `@wix/ecom` | Orders live here regardless of vertical (Stores, Bookings, Restaurants all create eCom orders) |
| Products, inventory, product categories/collections (catalog) | `@wix/stores` | ⚠️ V1/V3 catalog check required — see [STORES_VERSIONING.md](STORES_VERSIONING.md) |
| Payments, charges, refunds, disputes, payment methods | `@wix/payments` | Payment-level view; order-level refund records are in `@wix/ecom` order transactions |
| Invoices, payment links, receipts, billable items | `@wix/get-paid` | |
| Gift cards & vouchers | `@wix/gift-vouchers` | |
| Coupons | `@wix/marketing` | `coupons` namespace |
| Pricing plans, plan orders, subscriptions | `@wix/pricing-plans` | |
| Benefit programs, pools, balances | `@wix/benefit-programs` | |
| Marketplace suppliers & submissions | `@wix/suppliers-hub` | |

### Bookings, scheduling & restaurants

| Entities | SDK package | Notes |
| --- | --- | --- |
| Services, bookings, sessions, availability, staff members, resources, time slots, policies | `@wix/bookings` | |
| Calendar events, schedules, participations | `@wix/calendar` | |
| Table reservations | `@wix/table-reservations` | |
| Restaurant menus, sections, items; online orders | `@wix/restaurants` | |

### Content, community & media

| Entities | SDK package | Notes |
| --- | --- | --- |
| Blog posts, drafts, categories, tags | `@wix/blog` | |
| Site events, tickets, RSVPs, guest lists | `@wix/events` | |
| Portfolio projects & collections | `@wix/portfolio` | |
| Online programs (courses), steps, participants | `@wix/online-programs` | |
| Groups | `@wix/groups` | |
| Comments | `@wix/comments` | |
| Reviews (product/service reviews) | `@wix/reviews` | |
| Donation campaigns | `@wix/donations` | |
| Media Manager files & folders | `@wix/media` | |
| Pro Gallery galleries & items | `@wix/pro-gallery` | |
| Forum | — | REST-only; search `SearchWixRESTDocumentation` |

### CRM & people

| Entities | SDK package | Notes |
| --- | --- | --- |
| Contacts, contact labels, extended fields, tasks | `@wix/crm` | |
| Site members, badges, member custom fields | `@wix/members` | |
| Inbox conversations & messages | `@wix/inbox` | |
| Email subscriptions (marketing consent per contact) | `@wix/email-subscriptions` | |
| Email marketing campaigns | `@wix/email-marketing` | |
| Forms, form schemas, form submissions | `@wix/forms` | Form submissions are NOT CMS items |
| Loyalty accounts, points, rewards, tiers | `@wix/loyalty` | |
| Notifications (push/dashboard notifications to users) | `@wix/notifications` | |

### Site & business management

| Entities | SDK package | Notes |
| --- | --- | --- |
| CMS data items & collections (app-owned data only) | `@wix/data` | The only case where CMS is correct — see the rule above |
| Site analytics data | `@wix/analytics-data` | |
| Automations | `@wix/automations` | |
| Marketing tags (Google Analytics, FB Pixel…) | `@wix/marketing-tags` | |
| Referral programs | `@wix/referral` | |
| Multilingual locales & translations | `@wix/multilingual` | |
| SEO tags, patterns, URL redirects | `@wix/seo` | |
| Site search | `@wix/search` | |
| Secrets (API keys storage) | `@wix/secrets` | Never store secrets in CMS |
| Locations, site properties | `@wix/business-tools` | |
| App instances, plans, embedded-script params | `@wix/app-management` | |
| App installation state | `@wix/apps-installer` | |
| AI site chat conversations | `@wix/ai-site-chat` | |

## Red-flag entities (most common CMS mistakes)

If the user says any of these words, the data already lives in a Wix app — reach for the SDK, never CMS:

**orders · refunds · transactions · products · inventory · cart · checkout · bookings · appointments · services · staff · contacts · members · customers · invoices · payments · coupons · subscriptions · plans · events · tickets · RSVPs · reviews · form submissions · blog posts · menus (restaurant) · reservations · loyalty points · gift cards**

## Import pattern

All backend modules follow the same shape in CLI apps (auth is handled by the platform):

```typescript
import { orders } from '@wix/ecom';

const order = await orders.getOrder(orderId);
```

Install the package first (`npm install @wix/ecom`), and request the permission scopes the method's doc page lists when the app is configured in the Dev Center.
