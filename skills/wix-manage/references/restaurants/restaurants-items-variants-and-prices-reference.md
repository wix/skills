---
name: "Restaurants Items, Variants and Prices Reference"
description: Changes, deletes and looks up existing Wix Restaurants dishes (items) and their prices and sizes. Use to edit a dish's name, description, price, visibility or order settings, give a dish sizes with a price each, or remove a dish. To create dishes as part of a new menu, use Wix Restaurants Setup.
---
# Restaurants Items, Variants and Prices Reference

> Needs the Wix Restaurants Menus app on the site — see the note at the top of [Wix Restaurants Setup](wix-restaurants-setup.md). Menus and sections: [Menus and Sections Reference](restaurants-menus-and-sections-reference.md). Labels and modifiers: [Labels and Modifiers Reference](restaurants-labels-and-modifiers-reference.md).

All calls go to `https://www.wixapis.com`. Permission: Manage Restaurants (`SCOPE.RESTAURANTS.MEGA-SCOPES`). Check the HTTP status and body of every call. Updating: get the entity, change what you need, and send the whole entity back with its current `revision`, arrays in full and no `mask`. Ask the user before deleting anything.

## Item

| Field | Type and limits | Notes |
|---|---|---|
| `id`, `revision`, `createdDate`, `updatedDate` | | Read-only; `revision` required on update. |
| `name` | string, 1–200 chars | |
| `description` | string, ≤1500 chars | |
| `image`, `additionalImages` | Image, ≤15 extra | Image: `id` (Wix Media id), `url`, `width`, `height`, `altText`, `filename`. |
| `priceInfo` **or** `priceVariants` | see Prices | Exactly one of the two; the schema marks it required. |
| `visible` | boolean | Whether visitors see the item in the menu. |
| `featured` | boolean, default `false` | Marks a featured or best-seller dish. |
| `orderSettings` | `{inStock, acceptSpecialRequests}` | Online ordering settings, both booleans, default `true`: whether the item is in stock, and whether customers can add special requests. |
| `labels` | `[{"id": "<LABEL_ID>"}]`, ≤10 | Existing labels only; see [Labels and Modifiers Reference](restaurants-labels-and-modifiers-reference.md). |
| `modifierGroups` | `[{"id": "<GROUP_ID>"}]`, ≤25 | Existing modifier groups only. Send `[]` when there are none. |
| `extendedFields.namespaces` | object | Data owned by other apps. |
| `businessLocationIds` | GUID array | Read-only. The server fills it from the menus that contain the item. |

Items are shared across locations. Adding an existing item to a section of a menu at another location reuses it and adds that location to `businessLocationIds`; it does not copy the item. Changing the item therefore changes it at every location that uses it. If `businessLocationIds` has more than one entry, tell the user the change applies at every location and wait for a yes before updating.

| Operation | Call |
|---|---|
| Create | `POST https://www.wixapis.com/restaurants/menus-item/v1/items`, body `{"item": {...}}` |
| Get | `GET https://www.wixapis.com/restaurants/menus-item/v1/items/{itemId}` |
| List | `GET https://www.wixapis.com/restaurants/menus-item/v1/items` — `itemIds`, `onlyVisible`, `paging.limit` (≤500), `paging.cursor` |
| Query | `POST https://www.wixapis.com/restaurants/menus-item/v1/items/query` |
| Update | `PATCH https://www.wixapis.com/restaurants/menus-item/v1/items/{item.id}`, body `{"item": {"id", "revision", ...}}` |
| Delete | `DELETE https://www.wixapis.com/restaurants/menus-item/v1/items/{itemId}` |
| Bulk create / update / delete | `POST https://www.wixapis.com/restaurants/menus-item/v1/bulk/items/create`, `POST https://www.wixapis.com/restaurants/menus-item/v1/bulk/items/update`, `DELETE https://www.wixapis.com/restaurants/menus-item/v1/bulk/items/delete?ids=<id>&ids=<id>` |

Query filters (schema): `id`, `image.id`, `name`, `description` (`$eq`, `$ne`, `$in`, `$startsWith`, …), `visible`, `featured`, `orderSettings.inStock`, `orderSettings.acceptSpecialRequests` (`$eq`, `$ne`, `$in`), `createdDate`, `updatedDate`, `businessLocationIds` (`$hasSome`, `$hasAll`), `labels.id`, `modifierGroups.id`, `priceVariants.variants.variantId` (`$hasSome`, `$eq`, `$in`), `priceVariants.variants.price`. The filters article spells the label field `labels.Id`, so do not probe a label filter: page through the items and filter `labels[].id` in your own code. The single price `priceInfo.price` has no documented filter, so filter prices in your own code too. Deleting an item does not document what happens to sections that list it, so remove its id from those sections first (query sections with `itemIds` `$hasSome`).

## Prices

`price` is a decimal **string** with up to 3 decimals, zero or more: `"14.99"`, `"7.5"`, `"0"`. There is no currency field; the docs do not state the currency, so quote it as the site's price. An item has one price in one of two forms:

- **One price for the whole dish:** `"priceInfo": {"price": "14.99"}`.
- **A price per size or option** (Small, Medium, Large): `"priceVariants": {"variants": [{"variantId": "<VARIANT_ID>", "priceInfo": {"price": "9.00"}}, {"variantId": "<VARIANT_ID_2>", "priceInfo": {"price": "12.50"}}]}`, up to 500 entries. There is no separate base price, so every size needs its own entry.

Send one form only. To change a price, update the item with the new value in whichever form it already uses. To switch an item from one price to sizes, send `priceVariants` and drop `priceInfo`. A price held on the item is the only price; variants carry none themselves.

## Item variants

A variant is a reusable name such as "Small" or "Large". It has no price; the price is set on each item that uses it.

| Field | Type and limits | Notes |
|---|---|---|
| `id`, `revision`, `createdDate`, `updatedDate` | | Read-only. |
| `name` | string, 1–200 chars | Required on create. |
| `extendedFields.namespaces` | object | |
| `businessLocationIds` | GUID array | Read-only. |

| Operation | Call |
|---|---|
| Create | `POST https://www.wixapis.com/restaurants/item-variants/v1/variants`, body `{"variant": {"name": "Large"}}` |
| Get, Update, Delete | `GET https://www.wixapis.com/restaurants/item-variants/v1/variants/{variantId}`, `PATCH https://www.wixapis.com/restaurants/item-variants/v1/variants/{variant.id}` (with `revision`), `DELETE https://www.wixapis.com/restaurants/item-variants/v1/variants/{variantId}` |
| List | `GET https://www.wixapis.com/restaurants/item-variants/v1/variants` — `variantIds`, `paging.limit`, `paging.cursor`; the paging block is named `metadata`, not `pagingMetadata` |
| Query | `POST https://www.wixapis.com/restaurants/item-variants/v1/variants/query` — filters `id`, `name` (`$in`, `$nin`, `$eq`, `$ne`), `createdDate`, `updatedDate` |
| Bulk | `POST https://www.wixapis.com/restaurants/item-variants/v1/bulk/variants/create`, `POST https://www.wixapis.com/restaurants/item-variants/v1/bulk/variants/update`, `DELETE https://www.wixapis.com/restaurants/item-variants/v1/bulk/variants/delete?ids=<id>` (up to 200 ids) |

Deleting a variant is permanent and the docs do not say what happens to items that price it; first update those items' `priceVariants` (query items with `priceVariants.variants.variantId`).

**Add sizes to an item:**
1. Get the item (`GET https://www.wixapis.com/restaurants/menus-item/v1/items/{itemId}`) and keep the whole response.
2. Query variants by `name` (`POST https://www.wixapis.com/restaurants/item-variants/v1/variants/query`) for the sizes the user named; create the missing ones (`POST https://www.wixapis.com/restaurants/item-variants/v1/bulk/variants/create`, body `{"variants": [{"name": "Small"}, {"name": "Large"}], "returnEntity": true}`).
3. `PATCH https://www.wixapis.com/restaurants/menus-item/v1/items/{itemId}` with the item exactly as fetched (`id`, `revision`, `name`, `description`, `visible`, `labels`, `modifierGroups`, ...), except `priceInfo` is dropped and `priceVariants` is set: `{"variants": [{"variantId": "<SMALL_ID>", "priceInfo": {"price": "9.00"}}, {"variantId": "<LARGE_ID>", "priceInfo": {"price": "12.50"}}]}`.
4. In your final answer, list every size with its price and say explicitly that the old single price (quote its value, for example "14.99") was removed, so the item now has no single price.
