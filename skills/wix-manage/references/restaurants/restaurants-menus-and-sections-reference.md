---
name: "Restaurants Menus and Sections Reference"
description: Changes, deletes, duplicates and looks up existing Wix Restaurants menus and sections, and manages the business locations (addresses) menus belong to. Use to rename, hide or reorder a menu or section, move dishes between sections, remove a menu or section, or add, change or find a location. To create a new menu from scratch, use Wix Restaurants Setup.
---
# Restaurants Menus and Sections Reference

> Needs the Wix Restaurants Menus app on the site — see the note at the top of [Wix Restaurants Setup](wix-restaurants-setup.md), which also holds the end-to-end setup flow. Items, variants and prices: [Items, Variants and Prices Reference](restaurants-items-variants-and-prices-reference.md). Labels and modifiers: [Labels and Modifiers Reference](restaurants-labels-and-modifiers-reference.md).

All calls go to `https://www.wixapis.com`. Permission for every call: Manage Restaurants (`SCOPE.RESTAURANTS.MEGA-SCOPES`). Check the HTTP status and the response body of every call.

## Rules for every update, delete and query

- **Read first, then update.** An update needs the entity's current `revision` (a string). Fetch the entity, change the fields, and send it back with that `revision`. Each update raises the revision by 1, so a stale one is rejected.
- **Send the whole entity.** Get it, change the fields you need, and send everything back, including every array (`sectionIds`, `itemIds`, ...) in full. Never send a partial array or leave one out. Renaming a menu sends `id`, `revision`, the new `name`, and the unchanged `description`, `visible`, `urlQueryParam` and `sectionIds` exactly as fetched.
- **No `mask` on a single update.** The single-update schemas for menus and sections have no `mask` (a docs example for sections sends one, unexplained). Send the full entity. The bulk updates do take `mask: {"paths": ["name"]}`.
- **Confirm before deleting.** Deletes are permanent. Before deleting a section, remove its id from the menu's `sectionIds`. Before deleting a menu, tell the user that its sections and items may remain (the effect is not documented) and offer to delete them separately.
- **Paging is cursor-based.** Query body `{"query": {"filter": {...}, "sort": [{"fieldName": "createdDate", "order": "DESC"}], "cursorPaging": {"limit": 100}}}`, up to 500 per page. For the next page send only `cursorPaging.cursor` (the response `pagingMetadata.cursors.next`), without filter or sort. Filters combine with `$and`, `$or`, `$not`, one operator per field.
- **Bulk calls** take up to 100 entities and `returnEntity: true` to get them back. Each result has `...Metadata` with `success` and an `error`, so check every result.

## Menu

| Field | Type and limits | Notes |
|---|---|---|
| `id` | GUID | Read-only. |
| `revision` | int64 string | Read-only; required on update. |
| `createdDate`, `updatedDate` | date-time | Read-only. |
| `name` | string, 1–500 chars | Shown to visitors. |
| `description` | string, ≤1500 chars | |
| `visible` | boolean | Whether visitors see the menu. |
| `sectionIds` | GUID array, ≤100 | Ordered; the order is the display order. |
| `urlQueryParam` | string, ≤500 chars | URL slug, e.g. `dinner-menu` in `/our-menus/dinner-menu`. |
| `seoData` | object | `tags[]` and `settings` (`keywords[]`, ≤20, each `{term, isMain}`; `preventAutoRedirect`). |
| `extendedFields.namespaces` | object | Data owned by other apps. |
| `businessLocationId` | GUID | The location the menu belongs to. Set on creation only; fixed afterwards. See below. |

| Operation | Call |
|---|---|
| Create | `POST https://www.wixapis.com/restaurants/menus-menu/v1/menus`, body `{"menu": {...}}` |
| Get | `GET https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menuId}` |
| List | `GET https://www.wixapis.com/restaurants/menus-menu/v1/menus` — query params `menuIds`, `onlyVisible`, `paging.limit`, `paging.cursor` |
| Query | `POST https://www.wixapis.com/restaurants/menus-menu/v1/menus/query` |
| Update | `PATCH https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menu.id}`, body `{"menu": {"id", "revision", ...}}` |
| Delete | `DELETE https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menuId}` |
| Bulk create / update | `POST https://www.wixapis.com/restaurants/menus-menu/v1/bulk/menus/create` and `https://www.wixapis.com/restaurants/menus-menu/v1/bulk/menus/update` (no bulk delete exists) |
| Duplicate | `POST https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menuId}/duplicate`, body `{"businessLocationIds": [...], "duplicateSubEntities": false, "menuName": "..."}` — returns `menuIds`; ask the user before sending `true`, since items are shared across locations |

Query filters: `id` (`$in`, `$nin`, `$eq`, `$ne`), `name`, `description`, `urlQueryParam` (`$startsWith`, `$in`, `$nin`, `$eq`, `$ne`), `sectionIds` (`$hasSome`), `visible` (`$eq`, `$ne`), `createdDate`, `updatedDate` (`$gt`…`$lte`, `$eq`, `$ne`). Sort by `createdDate` or `updatedDate`; other sort fields are listed in the schema but not in the filters article.

**Location rules.** On a site with locations, a menu created without `businessLocationId` gets the default location; on a site without locations it gets `"none"` and receives the first location added later. To move a menu to another location, create a new menu there or Duplicate Menu with the target `businessLocationIds`.

## Section

A section groups items inside a menu. Keep each section in one menu only; the docs warn that sharing a section across menus can break site features.

| Field | Type and limits | Notes |
|---|---|---|
| `id`, `revision`, `createdDate`, `updatedDate` | | Read-only; `revision` required on update. |
| `name` | string, 1–500 chars | |
| `description` | string, ≤1500 chars | |
| `image`, `additionalImages` | Image, ≤100 extra | Image: `id` (Wix Media id), `url`, `width`, `height`, `altText`, `filename`. Which of `id` and `url` is required is not documented. |
| `itemIds` | GUID array, ≤300 | Ordered display order of the items. |
| `visible` | boolean | |
| `businessLocationId` | GUID | Read-only; the server copies it from the menu. |

There is no `sortOrder` field: order comes from the order of `sectionIds` on the menu and of `itemIds` on the section.

| Operation | Call |
|---|---|
| Create, Get, Query, Update, Delete | `POST https://www.wixapis.com/restaurants/menus-section/v1/sections`, `GET https://www.wixapis.com/restaurants/menus-section/v1/sections/{sectionId}`, `POST https://www.wixapis.com/restaurants/menus-section/v1/sections/query`, `PATCH https://www.wixapis.com/restaurants/menus-section/v1/sections/{section.id}`, `DELETE https://www.wixapis.com/restaurants/menus-section/v1/sections/{sectionId}` |
| List | `GET https://www.wixapis.com/restaurants/menus-section/v1/sections` — `sectionIds`, `onlyVisible`, `paging.limit`, `paging.cursor` |
| Bulk | `POST https://www.wixapis.com/restaurants/menus-section/v1/bulk/sections/create`, `POST https://www.wixapis.com/restaurants/menus-section/v1/bulk/sections/update`, `DELETE https://www.wixapis.com/restaurants/menus-section/v1/bulk/sections/delete?ids=<id>&ids=<id>` |

Query filters: `id`, `name`, `description` (`$in`, `$nin`, `$startsWith`, `$eq`, `$ne`), `itemIds` (`$exists`, `$hasSome`), `image` (`$exists`), `createdDate`, `updatedDate`. There is no `visible` filter, and the docs do not agree on whether any field can be sorted, so sort in your own code. Bulk delete declares `ids` as a query parameter even though one docs example sends a body; use the query form.

## Locations and addresses

A business location is an address entity from the Locations API (`business-management/locations`). Menus point at one by id.

| Operation | Call |
|---|---|
| Query | `POST https://www.wixapis.com/locations/v1/locations/query` — body `{"query": {"filter": {"archived": false}, "paging": {"limit": 100}}}`; offset paging (`limit`, `offset`) |
| Get | `GET https://www.wixapis.com/locations/v1/locations/{id}` |
| Create | `POST https://www.wixapis.com/locations/v1/locations` — required `location.name`, `location.address`, `location.timeZone` |
| Update | `PUT https://www.wixapis.com/locations/v1/locations/{location.id}` — a full replace: send the whole location with its current `revision` |
| Archive | `POST https://www.wixapis.com/locations/v1/locations/{id}/archive` — permanent; cannot be undone; the default location cannot be archived |
| Set default | `POST https://www.wixapis.com/locations/v1/locations/{id}/set-default` |

There is no delete. Create and update need `LOCATIONS.MANAGE`; reads need `LOCATIONS.READ`.

Address object: `country` (2-letter ISO 3166-1 code, e.g. `ES`), `subdivision` (ISO 3166-2), `city`, `postalCode` (≤20), `streetAddress` (`number`, `name`, `apt`), `formattedAddress`, `hint` (≤500), `geocode` (`latitude` −90 to 90, `longitude` −180 to 180). The docs require no individual address field. Location fields: `name` (≤150), `description` (≤500), `default` and `archived` (read-only), `timeZone` (e.g. `Europe/Madrid`), `email`, `phone`, `fax`, `locationTypes` (≤10 of `UNKNOWN`, `BRANCH`, `OFFICES`, `RECEPTION`, `HEADQUARTERS`, `INVENTORY`), `businessSchedule` (`periods[]` with `openDay`, `openTime`, `closeDay`, `closeTime`; `specialHourPeriod[]`).

`address.country` cannot be used in a query filter. Fetch the non-archived locations and match the user's wording in your own code, by this rule: exactly one match, use it; several, ask which; none, list the locations and ask (the full flow is Step 0 of [Wix Restaurants Setup](wix-restaurants-setup.md)). Creating, changing or archiving a location changes the whole business, so ask the user first.
