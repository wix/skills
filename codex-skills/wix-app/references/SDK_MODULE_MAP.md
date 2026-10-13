# Entity → SDK Module Map

Data owned by an existing Wix business app is read and written through that app's SDK module — NEVER modeled as a new CMS Data Collection (see the [SDK-First Rule](../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms) in `SKILL.md`). A custom collection for such data starts empty and stays disconnected from the real records (e.g., a "refunds dashboard" built on CMS shows an empty state while refunded orders exist in Wix eCommerce).

**Entity → SDK module map** (find the entity the user mentioned, use that package):

| Entity | SDK package |
| --- | --- |
| orders / carts / checkout / refund records / fulfillments | `@wix/ecom` — orders live here regardless of vertical |
| products / inventory / catalog | `@wix/stores` — ⚠️ V1/V3 check, see [STORES_VERSIONING.md](STORES_VERSIONING.md) |
| payments / refunds / disputes | `@wix/payments` |
| invoices / payment links / receipts | `@wix/get-paid` |
| gift cards | `@wix/gift-vouchers` |
| coupons | `@wix/marketing` |
| pricing plans / subscriptions | `@wix/pricing-plans` |
| bookings / services / staff / time slots | `@wix/bookings` |
| calendar events / schedules | `@wix/calendar` |
| table reservations | `@wix/table-reservations` (namespace `reservations`) — not `@wix/restaurants` |
| restaurant menus / online orders | `@wix/restaurants` |
| blog posts | `@wix/blog` |
| site events / tickets / RSVPs | `@wix/events` |
| reviews | `@wix/reviews` |
| comments | `@wix/comments` |
| groups | `@wix/groups` |
| online programs | `@wix/online-programs` |
| donations | `@wix/donations` |
| portfolio | `@wix/portfolio` |
| media files | `@wix/media` |
| contacts / labels / tasks | `@wix/crm` |
| members | `@wix/members` |
| inbox conversations | `@wix/inbox` |
| forms / form submissions | `@wix/forms` |
| loyalty points / rewards | `@wix/loyalty` |
| email marketing | `@wix/email-marketing` |
| notifications | `@wix/notifications` |
| analytics | `@wix/analytics-data` |
| automations | `@wix/automations` |
| SEO tags / redirects | `@wix/seo` |
| site search | `@wix/search` |
| secrets | `@wix/secrets` |
| locations / site properties | `@wix/business-tools` |
| app instances | `@wix/app-management` |

Types from these packages are accessed as `<namespace>.<TypeName>` — see [SDK types](../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms).

If the entity isn't listed or you're unsure, run `SearchWixSDKDocumentation` for it — **never conclude CMS with zero MCP calls**. CMS is only for data your app itself introduces (configuration, rules, app-specific records) that no Wix app manages.
