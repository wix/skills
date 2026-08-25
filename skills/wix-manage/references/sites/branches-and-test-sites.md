---
name: "Branches and Test Sites"
description: Create and manage Wix Branches (a.k.a. test sites) to edit a site without touching the live version. Covers the critical caveat that a branch mirrors draft content, not the published site, and what to do when they've diverged.
---
# Branches and Test Sites

A **branch** (a.k.a. [test site](https://support.wix.com/en/article/about-test-sites)) is an isolated,
editable copy of a site's **draft** content. Use it to let a site owner test changes without touching
the live site.

- **Auth**: site-level (a site API key/token with `wix-site-id`, or a Wix user token).
- **Permission**: `EDITOR.BRANCH_*` (scope `SCOPE.DC-DOCUMENT-MANAGEMENT.MANAGE-BRANCHES`).
- **Endpoints**: `POST /branches/v1/branches` (create) · `GET /branches/v1/branches/{branchId}` (get) ·
  `GET /branches/v1/branches/default` (get default) · `POST /branches/v1/branches/query` (list) ·
  `POST /branches/v1/branches/{branchId}/set-default` · `PATCH /branches/v1/branches/{branch.id}` ·
  `DELETE /branches/v1/branches/{branchId}`.
- This API manages branch **metadata** only (name, tags, default flag). Editing a branch's actual
  content is only possible in the editor — open it with [Get Editor URLs](https://dev.wix.com/docs/api-reference/business-management/site-urls/editor-urls/get-editor-urls)
  plus `&branchId=<id>` appended to the returned `editorUrl`.

## Critical caveat: a branch mirrors draft content, not the live site

`CreateBranch` with `sourceType: SOURCE_BRANCH` clones the source branch's **current draft** —
not its last-published/live snapshot. If that draft has already diverged from what's actually
live (for example, a different branch was published more recently, or content was pushed through
a path that doesn't touch the standard editor draft), the new branch — and the editor, and Site
History — will all show that same stale/wrong design, not the live one.

**Don't assume** that creating a branch, opening the editor, or restoring a Site History entry
will ever produce a copy of the currently-published site. None of them do. Concretely:

```bash
curl -X POST 'https://www.wixapis.com/branches/v1/branches' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{"branch": {"type": "USER", "name": "safe-copy",
       "sourceType": "SOURCE_BRANCH",
       "sourceBranchProperties": {"branchId": "<ORIGINAL_OR_DEFAULT_BRANCH_ID>"}}}'
```

This clones whatever is currently in `<ORIGINAL_OR_DEFAULT_BRANCH_ID>`'s draft — verify that
matches expectations before telling the user their edits are "safe," especially if the site has
more than one branch (`POST /branches/v1/branches/query`).

## There is no API to restore/sync a branch from the live site

If a branch's draft (including the `ORIGINAL_BRANCH`) has drifted from what's live, there is
**no supported API, and no editor UI action**, that pulls the live/published content back into
an editable draft. The only related tool is [Site History](https://support.wix.com/en/article/viewing-and-managing-your-site-history)
(dashboard-only, no REST API), which restores a **past revision of that same branch's document
history** — not "whatever is currently live" if live came from a different branch or a
non-standard publish path. Set expectations accordingly and point the site owner to Wix Support
if they need the live design recovered into an editable state.
