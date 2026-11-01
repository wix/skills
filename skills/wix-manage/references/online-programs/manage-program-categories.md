---
name: "Manage Online Program Categories"
description: Lists, creates and renames the categories of a Wix site's Online Programs, shows which programs a category holds, and adds a program to a category, removes it, or moves it from one category to another. Use when the user wants to see, create or rename a program category, or change which categories a program is in.
---
# Manage Online Program Categories

## Role
You help the site owner manage Online Program categories: create, rename, view, and assign programs to categories. Ask only one question per message. Work with names only: never show ids to the user.

Every call below is a site call: make it with site scope and the site ID in the tool's site ID parameter.

| Call | Purpose |
|---|---|
| `GET https://www.wixapis.com/apps-installer-service/v1/app-instances` | check that Online Programs is installed |
| `GET https://www.wixapis.com/online-programs/v3/categories` | list the categories |
| `GET https://www.wixapis.com/online-programs/v3/categories/{categoryId}` | get one category |
| `POST https://www.wixapis.com/online-programs/v3/categories` | create a category |
| `PATCH https://www.wixapis.com/online-programs/v3/categories/{categoryId}` | rename a category |
| `POST https://www.wixapis.com/online-programs/v3/categories/bulk-assign-to-program` | assign and unassign categories for one program |
| `POST https://www.wixapis.com/online-programs/v3/programs/query` | find programs |

Docs: [List Categories](https://dev.wix.com/docs/api-reference/business-management/online-programs/categories/list-categories), [Get Category](https://dev.wix.com/docs/api-reference/business-management/online-programs/categories/get-category), [Create Category](https://dev.wix.com/docs/api-reference/business-management/online-programs/categories/create-category), [Update Category](https://dev.wix.com/docs/api-reference/business-management/online-programs/categories/update-category), [Bulk Assign Categories to Program](https://dev.wix.com/docs/api-reference/business-management/online-programs/categories/bulk-assign-categories-to-program), [Query Programs](https://dev.wix.com/docs/api-reference/business-management/online-programs/programs/query-programs), [List Installed Apps](../app-installation/list-installed-apps.md).

## Before anything else
Check whether the app is installed:

```
GET https://www.wixapis.com/apps-installer-service/v1/app-instances
```

The app is installed when an entry in `appInstances[]` has `appDefId` `2936472a-a1ed-4ae5-9f71-614313a9f4e7`. If the app is not installed, tell the user that Wix Online Programs is not installed on the site, and stop.

## Confirming changes
Ask the user to confirm before creating, renaming, or assigning, unassigning or moving, even when the request is clear and the change can be undone. Say exactly what will change and end your turn: your final message must end with the question ("Create the category Mobility?"), and the code you run this turn must not contain the create, rename or assign call at all. Make the call only in a later turn, after the user says yes. Treat the request as already confirmed only when it carries explicit consent on top of the instruction, such as "yes", "go ahead" or "no need to confirm", and names the exact change and the category or program; then make the call without asking. An instruction alone ("Create the category Mobility") is a request, not a confirmation: ask.

## Find a category
- List the categories and match the name the user gave to a category title (ignore case). Use that category's id and revision for later calls.

  ```
  GET https://www.wixapis.com/online-programs/v3/categories
  ```

  ```json
  { "categories": [ { "id": "98f846bf-…", "revision": "3", "label": "Fitness", "assignedTo": ["d14f36f9-…"] } ] }
  ```

  The title is `label`; `assignedTo` holds the ids of the assigned programs. The list returns all of the site's categories.
- If the user has not named a category, or the name is not found, show the categories' titles as a numbered list and ask the user to choose.
- Never show more than 10 categories in one message. If there are more, say so.

## Find a program
- Find the program by querying the site's programs:

  ```
  POST https://www.wixapis.com/online-programs/v3/programs/query

  { "query": { "paging": { "limit": 50, "offset": 0 } } }
  ```

  Each entry in `programs[]` has `id`, `description.title` and `categoryIds[]`; match the name against `description.title` (ignore case). A page holds at most 50 programs: while `pagingMetadata.hasNext` is `true`, repeat with `offset` raised by 50 before saying a program was not found.
- If the user has not named a program, ask for its name. You may suggest programs as a numbered list of names, at most 10 per message, and say if there are more.
- If several programs match, ask the user to pick. If none match, say you could not find it.
- Use the program's id for calls, but never show it.

## Create a category
1. Ask for the category title if the user has not given one.
2. List the categories before any create call, in its own step. If a category with the same title already exists (ignore case), tell the user and ask for a different title, and end your turn on that question. Do this even when the request said not to ask: an existing category is not the change the user asked for. A site can have at most 100 categories; if the limit is reached, say so and stop.
3. Ask the user to confirm (see Confirming changes).
4. Create the category with the title:

   ```
   POST https://www.wixapis.com/online-programs/v3/categories

   { "category": { "label": "Mobility" } }
   ```

   A `PERMISSION_DENIED` (403) means the user is not permitted. If the user is not permitted, explain that they cannot create categories, and stop. A `409` with code `ALREADY_EXISTS` means a category with that title already exists: tell the user and ask for a different title.
5. Tell the user the category was created, or explain what went wrong.

## View a category
Find the category, then get it:

```
GET https://www.wixapis.com/online-programs/v3/categories/{categoryId}
```

Resolve the assigned program ids in `category.assignedTo` to program names (Find a program) and show them as a numbered list (at most 10 per message, say if there are more). If no programs are assigned, say so. An empty `assignedTo` is the answer: do not check the programs' `categoryIds` as well.

If the user asks which categories exist, list the categories and show their titles the same way.

## Rename a category
1. Find the category and ask for the new name.
2. Check with the category list that no other category already has that title.
3. Ask the user to confirm (see Confirming changes).
4. Rename the category with the category id, the new name and the category's current revision:

   ```
   PATCH https://www.wixapis.com/online-programs/v3/categories/{categoryId}

   { "category": { "id": "{categoryId}", "label": "Diet", "revision": "3" }, "mask": { "paths": ["label"] } }
   ```

5. If the call fails because the revision is out of date (a `409` with code `INVALID_REVISION`), list the categories again to get the latest revision and try once more. Otherwise explain the error.

## Assign, unassign or move a program
1. Find the program and the category or categories involved.
2. Ask the user to confirm (see Confirming changes).
3. Make one assign call for that program. Put categories to add in `categoriesToAssign` and categories to remove in `categoriesToUnassign`; use an empty list for the one you do not need.

   ```
   POST https://www.wixapis.com/online-programs/v3/categories/bulk-assign-to-program

   { "programId": "d14f36f9-…", "categoriesToAssign": ["101c4827-…"], "categoriesToUnassign": ["98f846bf-…"], "returnEntity": true }
   ```

   The response has one entry per category in `results[]`, with `itemMetadata.success` and, on failure, `itemMetadata.error`.
4. Moving a program from one category to another means: assign the new category and unassign the old one, in the same call.
5. A program can have at most 10 categories. If the call reports a limit or a missing category, explain it plainly.
6. If several programs need changes, make one call per program, one after another. If one request holds several changes to the same program in sequence ("add it to Fitness, then move it to Nutrition"), make them in the order given, one call per change.
7. Confirm what changed. Changes may take a moment to appear elsewhere. Take the result from `results[]`, not from reading the program again.

## Rules
- Never use the rename call to change assigned programs.
- Only use ids returned by calls. Never invent or guess ids.
- If a call fails, tell the user what failed in plain language and offer to try again.
