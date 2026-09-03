---
name: "Restaurants Dashboard Navigation"
description: "Builds direct links to Wix Restaurants dashboard pages on manage.wix.com — menus, menu items, the online orders board, online-ordering fulfillment settings (pickup, delivery, dine-in), the reservations list, floor plans, and reservation experience settings. Pairs each main Restaurants entity (menu, section, item, order, reservation) with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Restaurants Dashboard Navigation

Build direct links into the restaurant pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

## When to Use

- The merchant asks where something is in the dashboard, or wants a link to it
- Handing back a "view it in your dashboard" link with the result of an API call
- A change the APIs cannot make — dine-in ordering, order pacing, item- or section-level availability, floor plans, the prep board — has to be handed over
- Unsure which recipe a request belongs to? Start from [Configure Restaurants from Prompt](configure-restaurants-from-prompt.md)

Restaurant pages are split across **three apps** with three URL namespaces:

- **Wix Restaurants Menus** (`b278a256-2757-4f19-9313-c05c783bec92`) — menus, sections, items. Routes under `wix-restaurants-menus-new/`.
- **Wix Restaurants Orders** (`9a5d83fd-8570-482e-81ab-cfa88942ee60`) — online orders board and online-ordering settings. Routes under `wix-restaurants-orders-new/`.
- **Wix Table Reservations** (`f9c07de2-5341-40c6-b096-8eb39de391fb`) — reservations, floor plans, reservation experiences. Routes under `wix-table-reservations/`.

Older links (`restaurants/menus-management`, `restaurants/table-reservations`, `restaurants-orders-prep-board`, `olo-settings/...`) redirect to the current routes.

## Menus Pages (Wix Restaurants Menus)

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Menus | `wix-restaurants-menus-new` | All menus (and their sections) |
| Edit menu | `wix-restaurants-menus-new/menu/{menuId}` | A specific menu |
| Items | `wix-restaurants-menus-new/items` | All menu items |
| Menu printing | `wix-restaurants-menus-new/menus-printing` | Print-ready menu export |

## Orders Pages (Wix Restaurants Orders)

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Orders board | `wix-restaurants-orders-new` | Incoming online orders (prep board) |
| Online orders settings | `wix-restaurants-orders-new/settings` | Online-ordering settings hub |

Fulfillment and ordering sub-settings live at `wix-restaurants-orders-new/settings/{subpage}`: `pickup`, `delivery`, `pickup-delivery`, `dine-in`, `closure-dates`, `scheduling-page`, `service-fee`, `printing`, `doordash`.

## Reservations Pages (Wix Table Reservations)

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Reservations list | `wix-table-reservations/table-reservations` | All table reservations |
| Floor plan view | `wix-table-reservations/floor-plan-view` | Live floor-plan view of reservations |
| Floor plan editor | `wix-table-reservations/floor-plan` | Table layout (floor plan) |
| Create experience | `wix-table-reservations/create-experience` | New reservation experience |
| Experience settings | `wix-table-reservations/experience` | A reservation experience (seating rules, policies) |

Experience sub-settings live at `wix-table-reservations/experience/{subpage}`: `details`, `schedule`, `reservation-form`, `reservation-settings`, `table-assignment`, `polices`.

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header.

| Entity | Read API | Dashboard link |
|---|---|---|
| Menu | `POST /restaurants/menus/v1/menus/query` · `GET /restaurants/menus/v1/menus` | `wix-restaurants-menus-new/menu/{menuId}` (edit) or `wix-restaurants-menus-new` (list) |
| Section | `POST /restaurants/menus/v1/sections/query` | `wix-restaurants-menus-new` (sections are managed inside their menu) |
| Item | `POST /restaurants/menus/v1/items/query` | `wix-restaurants-menus-new/items` |
| Order | `POST /ecom/v1/orders/search` · `GET /ecom/v1/orders/{orderId}` | `wix-restaurants-orders-new` (board) or `ecom-platform/order-details/{orderId}` |
| Reservation | `POST /table-reservations/reservations/v1/reservations/query` · `GET /table-reservations/reservations/v1/reservations/{reservationId}` | `wix-table-reservations/table-reservations` |
| Reservation location (settings) | `POST /table-reservations/reservation-locations/v1/reservation-locations/query` | `wix-table-reservations/experience` |
| Operation (ordering service) | `GET /restaurants-operations/v1/operations` | `wix-restaurants-orders-new/settings` |
| Fulfillment method (pickup, delivery) | `GET /fulfillment-methods/v1/fulfillment-methods` | `wix-restaurants-orders-new/settings/pickup` or `.../delivery` |

Restaurant online orders are eCommerce orders (their `lineItems[].catalogReference.appId` is `9a5d83fd-8570-482e-81ab-cfa88942ee60`), so they can also be read and linked through the eCommerce orders pages.

Example — after creating a menu, hand back its edit link:

```
Created "Dinner Menu".
Manage it here: https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-menus-new/menu/{menuId}
```

## What This Skill Does NOT Cover

- **Changing the settings these pages show** — see [Restaurants Orders Settings](restaurants-orders-settings.md), [Restaurants Menus Setup](restaurants-menus-setup.md) and [Restaurants Reservations Setup](restaurants-reservations-setup.md)
- **Which recipe a request belongs to** — see [Configure Restaurants from Prompt](configure-restaurants-from-prompt.md)
- **The general dashboard URL contract** — see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md)

Hand back a link when a change cannot be made through the API — and say plainly that it was not applied rather than implying the link did it.
