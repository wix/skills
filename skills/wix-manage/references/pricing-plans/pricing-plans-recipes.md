---
name: "Pricing Plans Recipes"
description: "Subscriptions and paid plans — create recurring, one-time and free plans with trials and perks, connect plans to bookings as memberships or packages, and link to the plans dashboard. Use for anything users call plans, subscriptions, memberships, packages, recurring payments, or tiers."
---

# Pricing Plans Recipes

Create the plan first with **Create and Update Pricing Plans** — pricing model, trial period, perks and visibility all live there. Only then connect it to what it grants: **Pricing Plans Bookings Integration** covers benefit programs, which is how a plan becomes a membership or class package that grants booking access. A plan on its own grants nothing until that link exists.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Create and Update Pricing Plans](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/skills/create-and-update-pricing-plans)
**Technical:** Creates subscription and one-time payment plans using Plans API. Covers
pricing models (recurring, one-time, free), trial periods, perks configuration, and plan
visibility.

### [Pricing Plans Bookings Integration](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/skills/pricing-plans-bookings-integration)
**Technical:** Links Pricing Plans to Bookings services using the Benefit Programs API.
Enables package deals and memberships that grant booking access.

### [Pricing Plans Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/skills/pricing-plans-dashboard-navigation)
**Technical:** Builds direct links to Wix Pricing Plans dashboard pages on
manage.wix.com — plans list, create a plan, edit a plan, record a manual order, and
settings. Pairs each main Pricing Plans entity (plan, order) with its read API so you
can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user
asks where something is in the Wix dashboard, wants a direct link to a dashboard page,
or you need a dashboard URL to include with the result of an API operation.
