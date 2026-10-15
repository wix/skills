---
name: "Manage Studio Custom Templates"
description: Manages a Wix Studio partner's own custom templates — reusable starting points the partner builds from their existing sites. Covers saving a site as a template, listing and finding templates, how many client sites were created from one, creating a new client site from a template, renaming, deleting, publishing, and how to sell or share a template. Not for Wix's public template gallery.
---
# Manage Studio Custom Templates

A partner's custom template is a reusable starting point built from one of their sites. Creating a template **duplicates** the source site; the duplicate becomes the template's own backing site. Every client site created from the template is another full duplicate of that backing site.

- **Auth**: account-level (a Wix user token, or an account-level API key). Scope `SCOPE.STUDIO.MANAGE-CUSTOM-TEMPLATES`.
- **No site context.** Send no `wix-site-id` header. Templates are scoped to the caller's account.
- **Base URL**: `https://www.wixapis.com/wixstudio/templates/v1/templates`
- **Reference**: [Templates API](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/template-v1/introduction)

This skill is for the partner's **own** templates. To create a site from a Wix gallery template, use the Create Site from Template skill instead.

## Endpoints

| Operation | Method | URL |
| --- | --- | --- |
| Copy Site As Template | POST | `https://www.wixapis.com/wixstudio/templates/v1/templates/copy-site` |
| Create Site From Template | POST | `https://www.wixapis.com/wixstudio/templates/v1/templates/{templateId}/create-site` |
| Get Template | GET | `https://www.wixapis.com/wixstudio/templates/v1/templates/{templateId}` |
| Query Templates | POST | `https://www.wixapis.com/wixstudio/templates/v1/templates/query` |
| Count Templates | POST | `https://www.wixapis.com/wixstudio/templates/v1/templates/count` |
| Update Template | PATCH | `https://www.wixapis.com/wixstudio/templates/v1/templates/{template.id}` |
| Publish Template | POST | `https://www.wixapis.com/wixstudio/templates/v1/templates/{templateId}/publish` |
| Delete Template | DELETE | `https://www.wixapis.com/wixstudio/templates/v1/templates/{templateId}` |

## The Template object

- `id`, `name` (4–20 characters), `revision` (required on Update).
- `sites.count` / `sites.metaSiteIds` — client sites created from this template **in this account**.
- `templateType` — `STUDIO` (private to the account) or `PUBLIC` (published). Read-only; always `STUDIO` on creation.
- `hidden` — hidden from template galleries and pickers. Read-only through this API.
- `platform` — `STUDIO` (Wix Studio) or `WIX` (Wix Editor). Derived from the source site; can't be set.
- `createdBy`, `lastEditedBy` — user GUIDs, not names. The API doesn't resolve them; the Studio workspace UI shows the names.
- `lastEditedDate` — when the backing site's design last changed. `updatedDate` — when metadata (e.g. name) last changed.

## List and find templates

```bash
curl -X POST 'https://www.wixapis.com/wixstudio/templates/v1/templates/query' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  --data-binary '{ "query": { "sort": [{ "fieldName": "createdDate", "order": "DESC" }], "cursorPaging": { "limit": 50 } } }'
```

- Filterable and sortable fields are only `id`, `name`, `createdBy`, `lastEditedBy`, `createdDate`, `updatedDate`, `lastEditedDate`. **`templateType` and `sites.count` can't be filtered or sorted in Query** — fetch the list and filter or sort it yourself (for example, "most used" = sort by `sites.count` client-side).
- `name` supports `$eq` and `$startsWith`. When the user names a template loosely, query the list and match on name yourself. One match: use it. Several: ask which one.
- Max `limit` is 100. Follow `pagingMetadata.cursors.next` while `hasNext` is true.
- To count templates, Count accepts a filter: `{ "filter": { "templateType": "STUDIO" } }` returns `{ "count": "..." }`.

## How many client sites came from a template

Call Get Template and report `sites.count`. For a named list, resolve each ID in `sites.metaSiteIds` to a site name with [Query Sites](../sites/query-sites.md).

Only sites created **in this workspace** are counted. Sites created by other accounts from the marketplace or from a downloaded `.wix` file aren't available through the API — tell the user those figures are in the Studio workspace UI.

## Save a site as a template

1. Get the template name (4–20 characters) and the source site. Resolve a site name to its site ID with [Query Sites](../sites/query-sites.md).
2. Call Copy Site As Template:

   ```bash
   curl -X POST 'https://www.wixapis.com/wixstudio/templates/v1/templates/copy-site' \
     -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
     --data-binary '{ "templateName": "Portfolio Starter", "siteMetaSiteIdToCopy": "<SOURCE_SITE_ID>", "templateType": "STUDIO" }'
   ```

3. Tell the user the template was created (`template.id`) and that it has its own backing site. Editing that backing site changes the template for future sites; it doesn't change the original site or sites already created from the template.

## Create a new client site from a template

1. Resolve the template ID (list templates if the user is unsure which one).
2. Call Create Site From Template. No body.

   ```bash
   curl -X POST 'https://www.wixapis.com/wixstudio/templates/v1/templates/<TEMPLATE_ID>/create-site' \
     -H 'Authorization: <AUTH>'
   ```

3. Read `createdSiteMetaSiteId` — the new site's ID. The site is added to the template's `sites` list automatically. It's a snapshot: later template changes don't reach sites already created.

## Rename a template

Only `name` can be updated. Get the template for its current `revision`, then:

```bash
curl -X PATCH 'https://www.wixapis.com/wixstudio/templates/v1/templates/<TEMPLATE_ID>' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  --data-binary '{ "template": { "id": "<TEMPLATE_ID>", "name": "Agency Portfolio", "revision": "<CURRENT_REVISION>" } }'
```

On a stale-revision error, re-fetch and retry; don't ask the user to resolve it.

## Delete a template

Deleting a template **also permanently deletes its backing site**. Sites already created from it are independent and stay. Name the template and get explicit confirmation, then:

```bash
curl -X DELETE 'https://www.wixapis.com/wixstudio/templates/v1/templates/<TEMPLATE_ID>' \
  -H 'Authorization: <AUTH>'
```

## Sell or share a template

There is no listing management in the Studio workspace and none in this API. Offer the two paths:

- **Sell or distribute broadly** — submit the template to the Wix template marketplace: https://www.wix.com/studio/partner-program/submit-templates. Submission is a manual process outside this API.
- **Share with a specific person** — download a shareable `.wix` file from the Studio workspace (hover over the template → Download shareable file) and send it; the recipient imports it into their account.

**Publish Template** turns the template `PUBLIC` by creating a public snapshot of its site that other accounts can clone. Being public is a prerequisite for a marketplace listing, but publishing doesn't list or advertise the template anywhere. Republishing replaces the snapshot with the current site. There's no unpublish endpoint. Publish only when the user explicitly asks to, after confirming.

```bash
curl -X POST 'https://www.wixapis.com/wixstudio/templates/v1/templates/<TEMPLATE_ID>/publish' \
  -H 'Authorization: <AUTH>'
```

## Actions with no API

Edit, Preview, Duplicate, Download shareable file, and hiding a template are Studio workspace UI actions. Direct the user to **Your Templates** in the Studio workspace, hover over the template, and pick the action from its menu. The backing site also appears in the user's Sites list with a Template badge and can be opened from there to edit.

## Confirm before changing data

Ask the user before: deleting a template, publishing it, and creating a site from it. Saving a site as a template or renaming one that the user explicitly asked for doesn't need a separate confirmation.

## Errors

- 403 / `PERMISSION_DENIED` — either the account lacks `SCOPE.STUDIO.MANAGE-CUSTOM-TEMPLATES` (custom templates are a Wix Studio partner feature), or, on Copy Site As Template, the source site can't be turned into a template — for example, it isn't a Wix Studio site. Tell the user which applies and stop; don't retry or probe other endpoints. Suggest support if they believe they should have access.
- Template not found — wrong ID or already deleted. Re-query by name.
