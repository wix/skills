---
name: "Pricing Plans Dashboard Navigation"
description: "Builds direct links to Wix Pricing Plans dashboard pages on manage.wix.com — plans list, create a plan, edit a plan, record a manual order, and settings. Pairs each main Pricing Plans entity (plan, order) with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Pricing Plans Dashboard Navigation

Build direct links into the Wix Pricing Plans pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

All Wix Pricing Plans (app ID `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3`) pages live under:

```
https://manage.wix.com/dashboard/{metaSiteId}/pricing-plans/{route}
```

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Plans list | `pricing-plans` | All pricing plans; purchases (orders/subscriptions) are a tab of this page |
| Create plan | `pricing-plans/new` | New plan form |
| Edit plan | `pricing-plans/edit` | A specific plan — reached from the plans list (no documented ID path segment) |
| New manual order | `pricing-plans/new-order` | Record a manual (offline) plan order for a member |
| Settings | `pricing-plans/settings` | Pricing Plans settings |

There is no separate route for the purchases list — it is a tab of the main `pricing-plans` page.

Older `membership...` links (`membership`, `paid-plans`, `membership/setup`, `membership/orders/new`, `membership-settings`) redirect to the current routes.

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header.

| Entity | Read API | Dashboard link |
|---|---|---|
| Plan | `POST /pricing-plans/v3/plans/query` · `GET /pricing-plans/v3/plans/{planId}` | `pricing-plans` (list) or `pricing-plans/edit` (opened from the list) |
| Order (subscription/purchase) | `GET /pricing-plans/v2/orders` · `GET /pricing-plans/v2/orders/{id}` | `pricing-plans` (purchases tab) |
| Settings | Pricing Plans Settings API (Get Pricing Plans Settings) | `pricing-plans/settings` |

Example — after creating a plan, hand back the plans page:

```
Created "Gold Membership".
Manage it here: https://manage.wix.com/dashboard/{metaSiteId}/pricing-plans
```
