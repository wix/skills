---
name: "Wix Restaurants Setup"
description: Creates new Wix Restaurants menus, sections, dishes, labels, modifiers and modifier groups, assigning each menu to a business location. Use when the user wants to add a menu, a section, dishes, or an option group that does not exist yet. To change or delete existing menus, dishes, prices, labels or modifiers, use the Restaurants reference recipes instead.
---
# Wix Restaurants Setup API Reference

> These calls need the Wix Restaurants Menus app on the site (`appDefId` `b278a256-2757-4f19-9313-c05c783bec92`; online ordering is Wix Restaurants Orders `9a5d83fd-8570-482e-81ab-cfa88942ee60`, reservations Wix Table Reservations `f9c07de2-5341-40c6-b096-8eb39de391fb`); a `428`, a `400` naming the app, or an empty result on a site that should have content means it is not there. [List Installed Apps](../app-installation/list-installed-apps.md) shows what the site has; [Install Wix Apps](../app-installation/install-wix-apps.md) adds one by that id.

All calls need the Manage Restaurants permission. Structure: **Menu** (belongs to one business location) → **Section** → **Item** (a dish; it carries labels and modifier groups, and can appear at several locations).

## Rules for the agent

- **Fetch, never ask.** Locations, menus, sections, items and labels are all readable through the APIs. Read them yourself; do not ask the user to paste addresses or names. Ask only to choose between several fetched candidates, or when nothing matches.
- **Read before you write.** Query existing menus (`POST https://www.wixapis.com/restaurants/menus-menu/v1/menus/query`, body `{"query": {"cursorPaging": {"limit": 100}}}`) so you do not duplicate a menu that already exists at that location.
- **Resolve the location before creating a menu.** It can be set only at creation and cannot be changed later.
- **Confirm only what the user did not state.** A request that names the menu, the location and the dishes is the confirmation: go ahead. Ask first when you chose between several candidates, when a menu with that name already exists, or when the request is ambiguous. A label the user asked you to apply (for example "mark as Vegan") may be created without a further question.
- **Updates send the whole entity.** To change an existing entity, get it, change the fields you need, and send the whole entity back with its current `revision`, every array in full. The PATCH examples below show only the changed fields for brevity.
- **Finish with a link** to the new menu: see [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md).

## Step 0: Resolve the business location

A request such as "for my Spanish address", "for the London branch" names a location indirectly.

`POST https://www.wixapis.com/locations/v1/locations/query` with `{"query": {"filter": {"archived": false}, "paging": {"limit": 100}}}`.

Each location has `id`, `name`, `default` and an `address` (`country` as a 2-letter ISO code, so Spain is `ES`; `city`, `postalCode`, `streetAddress`, `formattedAddress`). `address.country` cannot be filtered, so match in your own code:

| Matches | Do this |
|---|---|
| Exactly one | Use its `id`. |
| Several | Ask which, listing each `name` and `formattedAddress`. |
| None | List the site's locations and ask. |
| User named no place | One location: use it and say so. Several: ask which, naming the default first. |
| Site has no locations | Create the menu without a location and say it attaches to the first location added. |

## Step 1: Create the menu

`POST https://www.wixapis.com/restaurants/menus-menu/v1/menus`

```json
{ "menu": { "name": "Dinner Menu", "description": "Our evening dining selections", "visible": true, "businessLocationId": "<LOCATION_ID>" } }
```

Always send `businessLocationId` when Step 0 found a match. Left out, the menu silently gets the site's default location (or `"none"` on a site with no locations). The Create Menu schema marks the field read-only while the About Business Locations article says it can be set on creation, so compare the returned `menu.businessLocationId` with what you sent, and if they differ tell the user where the menu landed instead of reporting success. To move a menu later, create a new one, or copy it with `POST https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menuId}/duplicate` (body `{"businessLocationIds": ["<LOCATION_ID>"], "duplicateSubEntities": false, "menuName": "<NAME>"}`; ask the user before setting `duplicateSubEntities` to `true`, since items are shared across locations).

## Step 2: Create items (dishes)

`POST https://www.wixapis.com/restaurants/menus-item/v1/items`

```json
{ "item": { "name": "Caesar Salad", "description": "Romaine, croutons, parmesan", "priceInfo": { "price": "14.99" }, "visible": true, "labels": [{ "id": "<LABEL_ID>" }], "modifierGroups": [] } }
```

An item has one price form: `priceInfo` (one price) or `priceVariants` (a price per size). `price` is a decimal string. `labels` and `modifierGroups` are lists of `{ "id": ... }` objects for entities that already exist (up to 10 labels), so create those first (Steps 5 and 6), or leave the lists empty and patch the item afterwards. Many items: `POST https://www.wixapis.com/restaurants/menus-item/v1/bulk/items/create` with `{"items": [...]}` (up to 100).

## Step 3: Create sections and put the items in them

`POST https://www.wixapis.com/restaurants/menus-section/v1/sections` with `{"section": {"name": "Appetizers", "visible": true, "itemIds": ["<ITEM_ID_1>", "<ITEM_ID_2>"]}}`. 

To add dishes to a section that already exists, create the items, then get the section, append the new ids to its full `itemIds` and send it back with its `revision` (rules in [Menus and Sections](restaurants-menus-and-sections-reference.md)).

There is no sort-order field. Position comes from the order of `itemIds` in a section and of `sectionIds` in a menu. A section takes its business location from the menu that lists it, so attach it in Step 4.

## Step 4: Attach the sections to the menu

`PATCH https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menuId}`, with the menu's current `revision` and the whole list:

```json
{ "menu": { "id": "<MENU_ID>", "revision": "<MENU_REVISION>", "sectionIds": ["<SECTION_ID_1>", "<SECTION_ID_2>"] } }
```

Abbreviated: send the full menu as fetched, with this field changed.

## Step 5: Labels ("Spicy", "Vegan", "Gluten-free")

A label is a site entity with its own `id`; an item cannot carry a bare name. Match the user's wording yourself against `GET https://www.wixapis.com/restaurants/item-labels/v1/labels` (up to 500) or `POST https://www.wixapis.com/restaurants/item-labels/v1/labels/query` with `{"query": {"filter": {"name": {"$startsWith": "Spic"}}}}`. If none fits, create it: `POST https://www.wixapis.com/restaurants/item-labels/v1/labels` with `{"label": {"name": "Spicy"}}`, and use the returned `label.id`.

To find the dishes that carry a label, page through Query Items (`POST https://www.wixapis.com/restaurants/menus-item/v1/items/query`) and keep those whose `labels[].id` includes the label `id`. Do not try a label filter; its field name is unreliable.

## Step 6: Modifiers and modifier groups

A group ("Toppings", "Cooking temperature") holds modifier entities plus a selection rule. Two calls, in order:

1. `POST https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers` with `{"modifier": {"name": "Extra Cheese"}}`. Keep each returned `id`. Do not send `type`.
2. `POST https://www.wixapis.com/restaurants/item-modifier-group/v1/modifier-groups` with the top-level field `modifierGroup`; sending `modifier` fails with `400 modifierGroup must not be empty`.

```json
{ "modifierGroup": { "name": "Toppings",
  "modifiers": [ { "id": "<MODIFIER_ID_1>", "additionalChargeInfo": { "additionalCharge": "2.00" } }, { "id": "<MODIFIER_ID_2>", "additionalChargeInfo": { "additionalCharge": "0" } } ],
  "rule": { "required": false, "minSelections": 0, "maxSelections": 5 } } }
```

The surcharge sits on the group entry, not on the modifier, and there is no currency field. The rule key is `required` (not `mandatory`); for a mandatory single choice use `required: true, minSelections: 1, maxSelections: 1`. It reaches customers only once an item lists it: `PATCH https://www.wixapis.com/restaurants/menus-item/v1/items/{itemId}` with `{"item": {"id": "<ITEM_ID>", "revision": "<ITEM_REVISION>", "modifierGroups": [{"id": "<GROUP_ID>"}]}}` (abbreviated: send the full item as fetched)..

## Order of work

Resolve the location and labels; create the menu; create modifiers, then groups; create items with their labels and groups; create sections with `itemIds`; update the menu's `sectionIds`; give the user the dashboard link.

## Example: "Create a new menu for my Spanish address with the spicy dishes"

1. Fetch locations; the one with `address.country` `ES` is the target (several: ask which).
2. Find the "Spicy" label `id`, then the items that carry it. None: tell the user and stop, do not create an empty menu.
3. Query menus. A menu with the intended name at that location: ask whether to reuse it.
4. Proceed: the request named the location and the dishes. Create the menu with `businessLocationId` and check the returned value, then a section with `itemIds` set to those dishes, then update the menu's `sectionIds`.
5. Hand back the dashboard link.

## Errors

| Symptom | Cause and fix |
|---|---|
| Menu at the wrong location | `businessLocationId` was not sent and cannot be updated. Create the menu again, or duplicate it. |
| `400 modifierGroup must not be empty` | The group was wrapped in `modifier`. Use `modifierGroup`. |

## Change or delete what already exists

See [Menus and Sections](restaurants-menus-and-sections-reference.md) (also locations and addresses), [Items, Variants and Prices](restaurants-items-variants-and-prices-reference.md), [Labels and Modifiers](restaurants-labels-and-modifiers-reference.md).
