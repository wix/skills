---
name: "Manage URL Redirects on a Wix Site"
description: Retrieve, create, and delete URL redirects on a Wix site using the public SEO Redirects API. Covers exact and group redirects, language-scoped redirects for multilingual sites, batches of up to 500, and the change flow for a redirect that already exists. Creating a redirect can permanently delete another one, so always confirm before writing.
---

# Manage URL Redirects on a Wix Site

Use the public **SEO Redirects API** to manage where a Wix site sends visitors who
request an old or moved URL. The API selects the site from the caller's
authorization context; never ask for or send a site ID.

A redirect returns a 301 permanent redirect, takes effect on the live site
immediately with no site publish, and **takes precedence over a real page at the
same path**. Creating a redirect from a path that still serves a page makes that
page unreachable until the redirect is deleted.

## Before writing anything

Two behaviors make writes destructive in ways the user will not expect. Confirm
the specific paths with the user before any create, and say which of these
applies:

- **Loops.** If the new redirect points at a path that an existing redirect
  starts from, that existing redirect is **deleted** and the create proceeds. No
  separate confirmation is asked, and the deletion cannot be undone.
- **A taken `from` path.** Create Redirect fails with `FROM_URL_EXISTS` and
  writes nothing. `options.forceReplace` makes it **delete** the redirect holding
  that path instead. Never set `forceReplace` on your own initiative: offer it
  only after reporting the conflict, and only if the user asks to replace.

Before a create that might hit either case, call **List Redirects** and check the
site's existing redirects. If something will be deleted, name it and ask.

## Choose exact or group

| User intent | Setting |
|---|---|
| "Redirect this one URL" | omit `options`, or `options.groupRedirect: false` |
| "Redirect this section", "everything under /blog" | `options.groupRedirect: true` |

A group redirect carries the rest of the URL over to the target: from
`/forum/questions/` to `/forum/faqs/` sends `/forum/questions/my-post` to
`/forum/faqs/my-post`. An exact and a group redirect that share a `from` path are
two different redirects.

For a multilingual site, set `language` to apply the redirect to one language
only; omit it to apply to every language. A language-scoped path is stored
**without** the language prefix, so `/fr/about` with `language: "fr"` comes back
as `/about`. Deleting a language-scoped redirect stops it working but it can
still appear in List Redirects.

`from` cannot be the site root, and two paths differing only by a trailing slash
count as the same path.

## Read

- **List Redirects** returns every redirect on the site in one response. It takes
  no filter, sort, or paging, so filter the result yourself. It also returns
  redirects Wix created for the site owner, such as when a page's URL slug was
  renamed in the editor.
- **Get Redirect** retrieves one by ID.

## Change an existing redirect

There is **no update method and no query method**. To change a redirect:

1. Call **Get Redirect** and keep the whole response.
2. Call **Delete Redirect** with the same ID.
3. Call **Create Redirect** with every field you retrieved, with your change applied.

Carry the whole redirect across, not only what changed. Create Redirect fills an
omitted field with its default rather than the previous value, so dropping
`options` turns a group redirect into an exact one and dropping `language` turns a
language-scoped redirect into a global one. Keep `id` to preserve the redirect's
identity, or omit it for a new one.

Confirm with the user before step 2: between the delete and the create the
redirect is not in effect, and if the create fails the old redirect is gone.

## Batches

**Bulk Create Redirects** and **Bulk Delete Redirects** take 1 to 500 items and
report each one separately **inside a successful response**:

- Read every outcome from `results[].itemMetadata`, matched to your request by
  `originalIndex`. A failed item carries `error.code`, such as `FROM_URL_EXISTS`
  or `REDIRECT_NOT_FOUND`.
- `bulkActionMetadata.undetailedFailures` counts items whose outcome is
  **unknown**: they carry no error and may or may not have been written. Call
  List Redirects to find out. Never report them as successes.
- A malformed request, such as an empty list, is rejected as a whole with a 400
  and returns no per-item results.

Two more sharp edges to report truthfully:

- A successful **Bulk Delete** item means the deletion was found and sent, not
  confirmed. Call List Redirects if the user needs confirmation.
- Bulk Create is **not atomic**. If an item's conflicting or loop-causing
  redirect is deleted and the write then fails, the deleted redirect is gone and
  nothing replaces it. Repeating the same request recreates it.

Creating a redirect identical to one already on the site changes nothing and
succeeds: Create Redirect echoes the request back without an `id` or
`createdDate`, and Bulk Create reports success with no `id`. Do not present that
as a newly created redirect.

## Stop conditions

- **On the first `403` or `PERMISSION_DENIED`, stop.** Report the missing
  authorization for managing SEO settings. Do not retry with another site, path,
  request shape, or method.
- On a 400, read `details.validationError.fieldViolations` and report the named
  field rather than guessing.
- **Known divergence:** the reference documents `REDIRECT_NOT_FOUND` for an
  unknown redirect ID on Get Redirect and Delete Redirect. The API currently
  returns a generic 404 without that code. Treat any 404 on those two methods as
  "no redirect with that ID", and do not tell the user the ID was valid.
- No webhook or event is emitted when a redirect is created or deleted. Never
  treat the absence of an event as the absence of a change.
