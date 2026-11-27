---
name: "Restaurants Labels and Modifiers Reference"
description: Changes, deletes and looks up existing Wix Restaurants labels, modifiers and modifier groups. Use to rename or remove a label such as Spicy or Vegan, add or reprice a topping or add-on, change an option group's rules, or attach labels and groups to a dish. To create a new label, modifier or modifier group from scratch, or as part of a new menu, use Wix Restaurants Setup.
---
# Restaurants Labels and Modifiers Reference

> Needs the Wix Restaurants Menus app on the site — see the note at the top of [Wix Restaurants Setup](wix-restaurants-setup.md). Items and prices: [Items, Variants and Prices Reference](restaurants-items-variants-and-prices-reference.md). Menus and sections: [Menus and Sections Reference](restaurants-menus-and-sections-reference.md).

All calls go to `https://www.wixapis.com`. Permission: Manage Restaurants (`SCOPE.RESTAURANTS.MEGA-SCOPES`). Check the HTTP status and body of every call. Updating: get the entity, change what you need, and send the whole entity back with its current `revision`, arrays in full and no `mask`. Ask the user before deleting anything, and remove a label, modifier or group from the items or groups that use it first (find them by querying items with `labels.id` or `modifierGroups.id`, and groups with `modifiers.id`).

## Item labels

A label is a name with an icon, shown on a dish: "Spicy", "Vegan", "Gluten-free". Labels belong to the site and an item refers to them by id (`"labels": [{"id": "<LABEL_ID>"}]`, up to 10 per item).

| Field | Type and limits | Notes |
|---|---|---|
| `id`, `revision`, `createdDate`, `updatedDate` | | Read-only. |
| `name` | string, 1–50 chars | |
| `icon` | Image | `id` (Wix Media id), `url`, `width`, `height`, `altText`, `filename`. |
| `extendedFields.namespaces` | object | |

| Operation | Call |
|---|---|
| Create | `POST https://www.wixapis.com/restaurants/item-labels/v1/labels`, body `{"label": {"name": "Spicy"}}` |
| Get, Update, Delete | `GET https://www.wixapis.com/restaurants/item-labels/v1/labels/{labelId}`, `PATCH https://www.wixapis.com/restaurants/item-labels/v1/labels/{label.id}` (with `revision`), `DELETE https://www.wixapis.com/restaurants/item-labels/v1/labels/{labelId}` |
| List | `GET https://www.wixapis.com/restaurants/item-labels/v1/labels` — up to 500, no paging block |
| Query | `POST https://www.wixapis.com/restaurants/item-labels/v1/labels/query` — filters `id`, `name` (`$eq`, `$ne`, `$in`, `$nin`, `$startsWith`), `icon` (`$exists`), `createdDate`, `updatedDate` |

There are no bulk label calls. To put a label on an item, update the item's `labels` (see [Items, Variants and Prices Reference](restaurants-items-variants-and-prices-reference.md)); to take it off, send the item without that entry.

## Item modifiers

A modifier is one extra choice: "Extra cheese", "Almond milk". It has a name and a stock flag only; **the surcharge is set on the group that contains it**, not on the modifier. A modifier only reaches customers inside a modifier group that an item refers to.

| Field | Type and limits | Notes |
|---|---|---|
| `id`, `revision`, `createdDate`, `updatedDate` | | Read-only. |
| `name` | string, 1–200 chars | Required on create. |
| `inStock` | boolean, default `true` | |
| `extendedFields.namespaces` | object | |
| `businessLocationIds` | GUID array, ≤100 | Read-only. |

| Operation | Call |
|---|---|
| Create | `POST https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers`, body `{"modifier": {"name": "Extra Cheese"}}` |
| Get, Update, Delete | `GET https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers/{modifierId}`, `PATCH https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers/{modifier.id}` (with `revision`), `DELETE https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers/{modifierId}` |
| List | `GET https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers` — `modifierIds`, `paging.limit`, `paging.cursor`; the paging block is named `metadata` |
| Query | `POST https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers/query` — filters `id`, `name` (`$eq`, `$ne`, `$in`, `$nin`), `createdDate`, `updatedDate`; `inStock` cannot be filtered |
| Bulk | `POST https://www.wixapis.com/restaurants/item-modifiers/v1/bulk/modifiers/create` (up to 100), `POST https://www.wixapis.com/restaurants/item-modifiers/v1/bulk/modifiers/update`, `DELETE https://www.wixapis.com/restaurants/item-modifiers/v1/bulk/modifiers/delete?ids=<id>` (up to 200 ids) |

The docs' create examples send `"type": "MODIFIER"`; the schema has no `type` field, so do not send it.

## Item modifier groups

A group holds a set of modifiers and the rule for choosing them ("Toppings: pick up to 5", "Cooking temperature: pick exactly 1").

| Field | Type and limits | Notes |
|---|---|---|
| `id`, `revision`, `createdDate`, `updatedDate` | | Read-only. |
| `name` | string, 1–100 chars | Required on create. |
| `modifiers[]` | up to 500 | The choices, in display order. |
| `modifiers[].id` | GUID | An existing item modifier. |
| `modifiers[].preSelected` | boolean, default `false` | Chosen by default. |
| `modifiers[].additionalChargeInfo.additionalCharge` | decimal string, ≥0, ≤3 decimals | Surcharge for this choice; `"0"` is free. No currency field. |
| `rule.required` | boolean | Whether the customer must choose. Named `required`; the docs' create examples show `mandatory`, which is wrong. |
| `rule.minSelections` | integer 0–25, default 0 | At most the number of modifiers in the group. |
| `rule.maxSelections` | integer 0–25 | At least `minSelections`. Send a number, not `null`. |
| `extendedFields.namespaces` | object | |
| `businessLocationIds` | GUID array, ≤100 | Read-only. |

| Operation | Call |
|---|---|
| Create | `POST https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups`, body `{"modifierGroup": {...}}` |
| Get, Update, Delete | `GET https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups/{modifierGroupId}`, `PATCH https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups/{modifierGroup.id}` (with `revision`), `DELETE https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups/{modifierGroupId}` |
| List | `GET https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups` — `modifierGroupIds`, `paging.limit`, `paging.cursor`; the paging block is named `metadata` |
| Query | `POST https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups/query` — filters `id`, `name` (`$startsWith`, `$eq`, `$ne`, `$in`, `$nin`), `modifiers.id` (`$in`, `$nin`, `$hasSome`), `modifiers.preSelected`, `rule.required`, `rule.minSelections`, `rule.maxSelections`, `createdDate`, `updatedDate` |
| Bulk | `POST https://www.wixapis.com/restaurants/item-modifier-group/v1/bulk/modifier-groups/create` (up to 100) and `POST https://www.wixapis.com/restaurants/item-modifier-group/v1/bulk/modifiers-groups/update` (note the word order in this path). No bulk delete exists. |

**Common changes**
- **Reprice a choice:** get the group, change that entry's `additionalChargeInfo.additionalCharge`, and send the whole `modifiers` array back with the group's `revision`.
- **Add a choice:** create the modifier, then add `{"id": ..., "additionalChargeInfo": {...}}` to the group's `modifiers` and send the whole array back.
- **Make a group optional or required:** change `rule` only, keeping `minSelections` and `maxSelections` consistent (`required: true` with `minSelections: 1`).
- **Attach a group to a dish:** update the item's `modifierGroups` to `[{"id": "<GROUP_ID>"}, ...]`, the whole list. The group reaches customers only through the items that list it.
- **Remove a group from a dish:** update the item without that entry. Delete the group itself only when no item uses it (query items with `modifierGroups.id`).

The two-call create flow, modifiers first and then the group, is in Step 6 of [Wix Restaurants Setup](wix-restaurants-setup.md).
