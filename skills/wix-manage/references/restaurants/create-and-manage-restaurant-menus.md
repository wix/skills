---
name: "Create and Manage Restaurant Menus"
description: Grab the site ID first, then create, update, list, hide, and delete Wix Restaurants menus with the Menus API. Use the correct menu wrapper, section IDs, revisions, and visibility settings, and confirm the finished menu with the user.
---
# Create and Manage Restaurant Menus

Use the Restaurants Menus API to create a menu, attach existing sections, change menu details or visibility, find menus, and delete menus that are no longer needed. A menu stores section IDs; sections and their items are managed as separate entities.

The site must have the Wix Restaurants Menus app installed. Every request is site-scoped and needs authorization, the site ID, and JSON content headers.

## Choose the operation

- **Create** when the user wants a new named menu.
- **Query** when the user describes a menu but does not provide its ID, or when you need the current entity before updating it.
- **Update** to rename a menu, change its description, attach sections, or change visibility. Use the latest `revision` returned by a read or query.
- **Delete** only when the user no longer needs the menu. Deleting the menu does not replace the separate section and item management flows.

You may want to check the existing menus first, or perhaps create the menu immediately if that seems easier. Use SearchWixAPISpec when you are not sure which fields the user meant.

## Create a menu

Reference: [Create Menu](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/create-menu)

`POST https://www.wixapis.com/restaurants/menus-menu/v1/menus`

The request is wrapped in `menu`. If sections already exist, pass their IDs in `sectionIds`; otherwise create the empty menu and attach sections later.

```json
{
  "menu": {
    "name": "Dinner Menu",
    "description": "Served daily from 5 PM",
    "sections": [
      "<STARTERS_SECTION_ID>",
      "<MAINS_SECTION_ID>"
    ],
    "urlQueryParam": "dinner-menu"
  }
}
```

Keep `menu.id` and `menu.revision` from the response. The ID identifies the menu in later calls, and the latest revision is required for updates.

## Find menus

Reference: [Query Menus](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/query-menus)

`POST https://www.wixapis.com/restaurants/menus-menu/v1/menus/query`

Use an empty query to list menus, then match the user's name against the returned `menus`. Do not invent an ID when more than one menu could match.

```json
{
  "query": {
    "paging": {
      "limit": 50
    }
  }
}
```

## Update details, sections, or visibility

Reference: [Update Menu](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/update-menu)

`PATCH https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menu.id}`

Read or query the menu immediately before updating it. Send its `id` and latest `revision` with the fields that should remain on the entity. An old revision prevents the update rather than overwriting a newer change.

```json
{
  "menu": {
    "id": "<MENU_ID>",
    "revision": "<LATEST_REVISION>",
    "name": "Weekend Dinner",
    "description": "Served Friday through Sunday",
    "visible": true,
    "sectionIds": ["<STARTERS_SECTION_ID>", "<MAINS_SECTION_ID>"]
  }
}
```

Use the returned menu as the result; its revision has advanced. To hide a menu without deleting it, update `visible` to `false` while preserving the menu's other values.

## Delete a menu

Reference: [Delete Menu](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/delete-menu)

`DELETE https://www.wixapis.com/restaurants/menus-menu/v1/menus/{menuId}`

Delete the menu as soon as you resolve its ID. The endpoint has no request body and returns an empty object on success. Tell the user which menu was deleted.

## Completion checks

- Report the menu's returned ID, name, visibility, and attached section IDs after a create or update.
- If a query returns no matching menu, say so instead of acting on a guessed ID.
- If the API reports that the Restaurants Menus app is missing, explain that it must be installed before menu operations can succeed.
