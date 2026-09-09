---
name: "Wix Restaurants Setup"
description: Configures restaurant menus, sections, and items using Menus API. Covers menu structure (Menu → Section → Item), the two-step item modifier / modifier group flow, pricing, availability schedules, and ordering settings.
---
# Wix Restaurants Setup API Reference

This recipe covers setting up and configuring Wix Restaurants using the REST API, including menus, items, and ordering configuration.

## Prerequisites

1. Wix Restaurants app installed on the site
2. API access with restaurant management permissions

## Required APIs

- **Menus API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/create-menu)
- **Menu Items API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/create-item)
- **Menu Sections API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/create-section)
- **Item Modifiers API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifiers/create-modifier)
- **Item Modifier Groups API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifier-groups/create-modifier-group)
- **Item Variants API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-variants/bulk-create-variants)

## Overview

Wix Restaurants uses a hierarchical structure:
- **Menus** (e.g., Breakfast, Lunch, Dinner)
  - **Sections** (e.g., Appetizers, Main Courses, Desserts)
    - **Items** (e.g., Caesar Salad, Grilled Salmon)

## Step 1: Create a Menu

**Endpoint**: `POST https://www.wixapis.com/restaurants/menus-menu/v1/menus`

**Request Body**:
```json
{
  "menu": {
    "name": "Dinner Menu",
    "description": "Our evening dining selections",
    "visible": true
  }
}
```

**Response**:
```json
{
  "menu": {
    "id": "menu-id-123",
    "name": "Dinner Menu",
    "description": "Our evening dining selections",
    "visible": true,
    "createdDate": "2024-01-15T10:00:00.000Z"
  }
}
```

## Step 2: Create Menu Sections

**Endpoint**: `POST https://www.wixapis.com/restaurants/menus-section/v1/sections`

**Request Body**:
```json
{
  "section": {
    "name": "Appetizers",
    "description": "Start your meal with our delicious starters",
    "visible": true,
    "sortOrder": 1
  }
}
```

Repeat per section, incrementing `sortOrder`, or create them all at once with the bulk endpoint
in Step 7.

## Step 3: Create Menu Items

**Endpoint**: `POST https://www.wixapis.com/restaurants/menus-item/v1/items`

**Request Body**:
```json
{
  "item": {
    "name": "Caesar Salad",
    "description": "Fresh romaine lettuce with house-made Caesar dressing, croutons, and parmesan",
    "priceInfo": { "price": "14.99" },
    "visible": true,
    "labels": [],
    "modifierGroups": []
  }
}
```

`modifierGroups` holds objects referencing existing modifier groups —
`[{ "id": "<MODIFIER_GROUP_ID>" }]`. Leave it empty until the groups exist (Step 5).

## Step 4: Add Items to Sections

**Endpoint**: `PATCH https://www.wixapis.com/restaurants/menus-section/v1/sections/{sectionId}`

Each section update requires the latest section `revision`.

```json
{
  "section": {
    "id": "<SECTION_ID>",
    "revision": "<SECTION_REVISION>",
    "itemIds": ["item-id-1", "item-id-2", "item-id-3"]
  }
}
```

## Step 5: Configure Item Options and Modifiers

A modifier group (e.g. "Cooking Temperature", "Toppings") holds a set of individual choices and
the selection rule that governs them. **The choices are separate entities** — a modifier group
does not contain inline options. Creating a group therefore takes two calls, in this order:

1. Create one **item modifier** per choice (Item Modifiers API) and keep each returned `id`.
2. Create the **modifier group** (Item Modifier Groups API), referencing those IDs.

Do both calls; a group created without step 1 comes back with an empty `modifiers` array and no
choices are saved.

### Step 5a: Create each item modifier

**Endpoint**: `POST https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers`

Only `modifier.name` is required.

```json
{
  "modifier": {
    "name": "Extra Cheese",
    "type": "MODIFIER"
  }
}
```

The response returns the new `modifier.id`. Repeat per choice, collecting the IDs.

### Step 5b: Create the modifier group

**Endpoint**: `POST https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups`

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

**Field reference** for `modifierGroup`:

| Field | Notes |
|-------|-------|
| `name` | Required. The group's display name. |
| `modifiers[].id` | ID of an existing item modifier from Step 5a — not a name. Up to 500. |
| `modifiers[].additionalChargeInfo.additionalCharge` | That choice's surcharge, a decimal string (`"2.00"`). No `currency` field — the site currency is used. |
| `modifiers[].preSelected` | Optional boolean; selects the choice by default. |
| `rule.required` | Whether the customer must choose. Named `required`, not `mandatory`. |
| `rule.minSelections` / `rule.maxSelections` | Integers bounding how many choices are allowed. |

There is no `options` field and no per-option `price` object.

### Step 5c: Attach the group to an item

A modifier group only reaches customers once an item references it. The item's `modifierGroups`
is an array of **objects carrying an `id`**, not bare ID strings.

**Endpoint**: `PATCH https://www.wixapis.com/restaurants/menus-item/v1/items/{itemId}`

```json
{
  "item": {
    "id": "<ITEM_ID>",
    "revision": "<ITEM_REVISION>",
    "modifierGroups": [{ "id": "<MODIFIER_GROUP_ID>" }]
  }
}
```

To create modifier groups in bulk, use
`POST https://www.wixapis.com/restaurants/menus/v1/bulk/modifier-groups/create` and
`POST https://www.wixapis.com/restaurants/menus/v1/bulk/modifiers/create`; the per-entity body
shape is the same.

## Step 6: Set Menu Structure (Attach Sections to Menu)

Attach section IDs to a menu. This call requires the latest menu `revision`.

**Endpoint**: `PATCH https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menuId}`

```json
{
  "menu": {
    "id": "<MENU_ID>",
    "revision": "<MENU_REVISION>",
    "sectionIds": ["<SECTION_ID_1>", "<SECTION_ID_2>"]
  }
}
```

## Step 7: Bulk Operations for Large Menus

For restaurant setup flows with many sections/items, use bulk endpoints:

- **Bulk Create Sections**: `POST https://www.wixapis.com/restaurants/menus-section/v1/bulk/sections/create`
- **Bulk Create Items**: `POST https://www.wixapis.com/restaurants/menus-item/v1/bulk/items/create`
- **Bulk Create Variants**: `POST https://www.wixapis.com/restaurants/item-variants/v1/bulk/variants/create`

```json
{
  "sections": [
    { "name": "Appetizers", "visible": true },
    { "name": "Main Courses", "visible": true }
  ],
  "returnEntity": true
}
```

## Step 8: Query Menus / Sections / Items

Use query APIs for retrieval and UI display flows.

- **Query Menus**: `POST https://www.wixapis.com/restaurants/menus-menu/v1/menus/query`
- **Query Sections**: `POST https://www.wixapis.com/restaurants/menus-section/v1/sections/query`
- **Query Items**: `POST https://www.wixapis.com/restaurants/menus-item/v1/items/query`

```json
{
  "query": {
    "cursorPaging": {
      "limit": 50
    }
  }
}
```

## Recommended Setup Order

For complex restaurant menus, use this order to avoid dependency issues:

1. Create variants (sizes/options) if needed.
2. Create item modifiers, then group them into modifier groups (Step 5) if the items need
   customization options.
3. Create items (single or bulk).
4. Create sections (single or bulk).
5. Update each section with `itemIds`.
6. Update menu with `sectionIds`.
7. Update items with `modifierGroups` to attach the groups from step 2.

## Item Labels

Common dietary labels:
- `vegetarian`
- `vegan`
- `gluten-free`
- `gluten-free-option`
- `dairy-free`
- `nut-free`
- `spicy`
- `chef-recommendation`

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `MENU_NOT_FOUND` | Invalid menu ID | Verify menu exists |
| `ITEM_NOT_FOUND` | Invalid item ID | Verify item exists |
| `INVALID_PRICE` | Negative price | Use positive amounts |
| `400 modifierGroup must not be empty` | Request body wrapped the group in `modifier` instead of `modifierGroup` | Use `modifierGroup` as the top-level field (Step 5b) |
| Group created but `modifiers` is `[]` | Choices were sent inline (e.g. an `options` array) instead of as item modifier IDs | Create item modifiers first, then reference their IDs in `modifiers[].id` (Step 5a → 5b) |

## Related Documentation

- [Menus API Reference](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/introduction)
- [Menu Items API Reference](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/introduction)
- [Menu Sections API Reference](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/introduction)
- [Restaurant Orders API](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/introduction)
