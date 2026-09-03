---
name: "Restaurants Recipes"
description: "Restaurant setup — menus, sections, items, modifiers, prices and availability schedules, plus ordering settings and links to the restaurants dashboard. Use for anything users call restaurant, menu, dishes, food items, modifiers, online ordering, reservations, or table booking."
---

# Restaurants Recipes

Menus are hierarchical — Menu, then Section, then Item — and modifiers take a two-step flow (modifier groups, then modifiers), which is where most attempts go wrong; **Wix Restaurants Setup** covers the whole structure including pricing and availability schedules. Use **Restaurants Dashboard Navigation** for menu pages, the online-orders board, fulfilment settings, reservations and floor plans.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Wix Restaurants Setup](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/skills/wix-restaurants-setup)
**Technical:** Configures restaurant menus, sections, and items using Menus API. Covers
menu structure (Menu → Section → Item), the two-step item modifier / modifier group
flow, pricing, availability schedules, and ordering settings.

### [Restaurants Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/skills/restaurants-dashboard-navigation)
**Technical:** Builds direct links to Wix Restaurants dashboard pages on manage.wix.com
— menus, menu items, the online orders board, online-ordering fulfillment settings
(pickup, delivery, dine-in), the reservations list, floor plans, and reservation
experience settings. Pairs each main Restaurants entity (menu, section, item, order,
reservation) with its read API so you can fetch an entity and hand back a 'view it in
your dashboard' link. Use when the user asks where something is in the Wix dashboard,
wants a direct link to a dashboard page, or you need a dashboard URL to include with the
result of an API operation.
