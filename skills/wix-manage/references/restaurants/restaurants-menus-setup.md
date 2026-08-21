---
name: "Restaurants Menus Setup"
description: "Builds a restaurant's catalog with the Wix Restaurants Menus API: menus, sections, items, price variants, item modifiers and modifier groups, and dietary labels. Covers the structure that decides the call order — nothing is nested in a create call, so entities are created on their own and attached to their parent by ID afterwards — and the two-step modifier flow where each choice is its own entity before the group that references it. Use when a merchant asks to create a menu, add or edit dishes, change prices, add a toppings or cooking-temperature choice, or mark items vegan or gluten-free. Does not cover when customers can order: ordering hours, cutoff times, preparation time, fulfillment methods and per-menu ordering availability are the Restaurants Orders Settings recipe."
---

# Restaurants Menus Setup

Builds a restaurant's catalog with the REST API: menus, sections, items, and their modifiers.

Ordering settings are a separate app and recipe: for hours, cutoff, prep time, fulfillment methods, per-menu availability or closures, use [Restaurants Orders Settings](restaurants-orders-settings.md); route an unclear request from [Configure Restaurants from Prompt](configure-restaurants-from-prompt.md). For a menu the merchant already has as text, a document or a photo, use [Restaurants Menus Import](restaurants-menus-import.md).

## When to Use

- Creating a menu, or adding sections and items to one
- Changing prices, descriptions, or the order items appear in
- Adding a choice customers make on an item — toppings, cooking temperature, size
- Marking items vegetarian, vegan, gluten-free or spicy

## Prerequisites

1. Wix Restaurants Menus installed on the site
2. API access with restaurant management permissions

A menu holds sections, and sections hold items — but **nothing is nested in the create calls**. Each entity is created on its own, then attached to its parent by ID in a follow-up update. Read request and response shapes from each endpoint's docs page.

## Step 1: Create a Menu

Create the menu and keep the returned `id`. Sections are attached in Step 6, not here.

## Step 2: Create Menu Sections

One call per section, incrementing `sortOrder`, or all at once with the bulk endpoint (Step 7). A section is not part of a menu until Step 6.

## Step 3: Create Menu Items

Leave `modifierGroups` empty here. It holds objects referencing existing modifier groups — `[{ "id": "<MODIFIER_GROUP_ID>" }]` — and those groups do not exist until Step 5.

Prices are decimal strings without a currency — the site currency is used. For sizes with their own price, create price variants rather than separate items.

## Step 4: Add Items to Sections

Update the section with its `itemIds`, sending the section's latest `revision`. Items created in Step 3 belong to nothing until this call.

## Step 5: Configure Item Options and Modifiers

A modifier group ("Cooking Temperature", "Toppings") holds a set of choices and the rule governing them. **The choices are separate entities** — a group does not contain inline options — so creating one takes two calls in order: an **item modifier** per choice, then the **modifier group** referencing their IDs. A group created without the first step comes back with an empty `modifiers` array and nothing saved.

### Step 5a: Create each item modifier

`POST /restaurants/item-modifiers/v1/modifiers`, one call per choice; only `modifier.name` is required. Keep each returned `modifier.id`.

```json
{ "modifier": { "name": "Extra Cheese", "type": "MODIFIER" } }
```

### Step 5b: Create the modifier group

The request body's top-level field is **`modifierGroup`**. Sending `modifier` instead is rejected
with `400 modifierGroup must not be empty` (`violatedRule: REQUIRED_FIELD`).

Required: `modifierGroup` and `modifierGroup.name`.

```json
{
  "modifierGroup": {
    "name": "Toppings",
    "modifiers": [
      {
        "id": "<ITEM_MODIFIER_ID_1>",
        "additionalChargeInfo": { "additionalCharge": "2.00" }
      },
      {
        "id": "<ITEM_MODIFIER_ID_2>",
        "additionalChargeInfo": { "additionalCharge": "0.00" }
      }
    ],
    "rule": {
      "required": false,
      "minSelections": 0,
      "maxSelections": 5
    }
  }
}
```

For a mandatory single-choice group (e.g. cooking temperature) use the same shape with
`"rule": { "required": true, "minSelections": 1, "maxSelections": 1 }`.

Four field names are worth knowing before you write the body, because guessing them fails:

| Field | Notes |
|-------|-------|
| `modifiers[].id` | ID of an existing item modifier from Step 5a — not a name. Up to 500. |
| `modifiers[].additionalChargeInfo.additionalCharge` | That choice's surcharge, a decimal string (`"2.00"`). No `currency` field — the site currency is used. |
| `rule.required` | Whether the customer must choose. Named `required`, not `mandatory`. |
| `rule.minSelections` / `rule.maxSelections` | Integers bounding how many choices are allowed. Nested under `rule`, never flattened onto the group. |

There is no `options` field and no per-option `price` object.

### Step 5c: Attach the group to an item

A modifier group only reaches customers once an item references it.

Update the item with its `revision` and its `modifierGroups` — an array of **objects carrying an `id`**, not bare ID strings.

## Step 6: Set Menu Structure (Attach Sections to Menu)

Update the menu with its `sectionIds` plus the menu's latest `revision`. Until this call the sections exist but belong to no menu.

## Step 7: Bulk Operations for Large Menus

For menus with many sections or items, one bulk call beats a loop. Pass `returnEntity: true` to get the created entities back with their IDs, which you need for Steps 4 and 6.

## Step 8: Dietary Labels

Labels are **their own entities**, not strings on the item. A site starts with a set of them (vegetarian, vegan, gluten-free, dairy-free, nut-free, spicy, chef's recommendation and others, each with an icon), and an item references them by ID — `labels: [{ "id": "<LABEL_ID>" }]`.

So list the labels first (`GET /restaurants/menus/v1/labels` returns each with `id`, `name` and an `icon`) and match the merchant's wording to what the site already has; create one only when nothing matches. On the item, `"labels": [{ "id": "<LABEL_ID>" }]` — never fold the marker into the name, so "(V)" is a label reference, not "Veggie Stack (V)".

## Endpoints

Under `https://www.wixapis.com` with an `Authorization` header:

| Purpose | Call |
|---|---|
| Menus | `GET`, `POST` `/restaurants/menus/v1/menus`, `POST` `.../query`, `PATCH` `.../{menuId}` |
| Sections | `GET`, `POST` `/restaurants/menus/v1/sections`, `POST` `.../query`, `PATCH` `.../{sectionId}` |
| Items | `GET`, `POST` `/restaurants/menus/v1/items`, `POST` `.../query`, `PATCH` `.../{itemId}` |
| Price variants | `POST /restaurants/menus/v1/variants`, `POST /restaurants/menus/v1/bulk/variants/create` |
| Item modifiers (one per choice) | `POST /restaurants/item-modifiers/v1/modifiers` |
| Modifier groups | `POST /restaurants/menus/v1/modifier-groups`, `PATCH .../{modifierGroupId}` |
| Labels | `GET`, `POST` `/restaurants/menus/v1/labels` |
| Bulk create | `POST /restaurants/menus/v1/bulk/{sections,items,variants,modifiers,modifier-groups}/create` |

Read field shapes from each docs page rather than from this table.

## Error Handling

| Error | Cause | Action |
|---|---|---|
| `400 modifierGroup must not be empty` | Request body wrapped the group in `modifier` instead of `modifierGroup` | Use `modifierGroup` as the top-level field (Step 5b) |
| Group created but `modifiers` is `[]` | Choices were sent inline (e.g. an `options` array) instead of as item modifier IDs | Create item modifiers first, then reference their IDs in `modifiers[].id` (Step 5a → 5b) |
| Sections created but the menu looks empty | Sections were never attached to the menu, or items never to their sections | Attach items to sections, then sections to the menu (Steps 4 and 6) |
| 400 mentioning `revision` | Stale or missing revision | Re-read the entity, resend with the revision you just got |
| `MENU_NOT_FOUND` / `ITEM_NOT_FOUND` | ID from another site, or the entity was deleted | List or query again, pick from those |
| A label name is rejected or duplicated | Labels are entities; the site already has one meaning the same thing | List labels, reference the existing ID (Step 8) |
| 403 | Missing permission | Name it; do not retry |

## What This Skill Does NOT Cover

- **When items can be ordered** — hours, cutoff, prep time, fulfillment methods, per-menu availability: see [Restaurants Orders Settings](restaurants-orders-settings.md)
- **Importing or reworking an existing menu in bulk** — see [Restaurants Menus Import](restaurants-menus-import.md)
- **Reading or fulfilling placed orders** — see [Restaurants Orders Management](restaurants-orders-management.md)
- **Table reservations** — a separate app; see [Restaurants Reservations Setup](restaurants-reservations-setup.md)
- **Item- or section-level availability, and printed menu design** — dashboard only

Field shapes for every entity above are in the [Menus API reference](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/introduction) (menus, sections, items, variants, modifiers, labels) and, for ordering, the [Online Orders API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/introduction).

If you cannot complete a change, say plainly that it was not applied and hand back the dashboard page — the menus pages are listed in [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md). Never report a menu, item or price as saved without a successful call behind it.
