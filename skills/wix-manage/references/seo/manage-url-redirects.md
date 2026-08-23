---
name: "Manage URL Redirects on a Wix Site"
description: "Retrieve, create, and delete URL redirects on a Wix site using the public SEO Redirects API. Covers exact and group redirects, language-scoped redirects for multilingual sites, batches of up to 500, and the change flow for a redirect that already exists. This API has no query, search, or update method: List Redirects is the only read-many. Redirects do not chain, so creating one that points at a path another redirect starts from permanently deletes that other redirect; list and check before every write."
---

# Manage URL Redirects on a Wix Site

Use the public **SEO Redirects API** to manage where a Wix site sends visitors who
request an old or moved URL. The API selects the site from the caller's
authorization context.

If the run already identifies a site - one connected site, or a site ID supplied
by the environment - use it and continue. Ask which site only when several are
available and nothing in the request or the context picks one. Do not stop to ask
for a site ID the API never takes.

A redirect returns a 301 permanent redirect, takes effect on the live site
immediately with no site publish, and **takes precedence over a real page at the
same path**. Creating a redirect from a path that still serves a page makes that
page unreachable until the redirect is deleted.

## Redirects do not chain, they replace

This is the single most important thing to know, and it is not what most agents
assume. If an existing redirect **starts at** the path your new redirect points
to, the two do not form a chain. The existing one is **deleted**, and your create
proceeds.

So with `/blog` -> `/news` already on the site, creating `/old-blog` -> `/blog`
does **not** produce `/old-blog` -> `/blog` -> `/news`. It produces
`/old-blog` -> `/blog`, and `/blog` -> `/news` is gone for good. Never describe
the result as a chain, a hop, or a redirect sequence.

## Run this check before every create

Do not skip it because the user's request was explicit. The user asking for a
redirect is not the same as the user agreeing to lose a different one.

1. Call **List Redirects**.
2. Compare the redirect you are about to create against every existing one:
   - an existing redirect whose `from` equals your new `to` **will be deleted**
     (loop resolution, described above);
   - an existing redirect whose `from` equals your new `from` means your create
     **fails** with `FROM_URL_EXISTS` and writes nothing.
   - Paths differing only by a trailing slash count as equal for both checks.
3. **If either matched, end your turn without writing.** Name the exact redirect
   at stake and what happens to it, then stop and wait for the user's answer.

   This is a rule about turn structure, not about intent: **never put a create in
   the same response as the List Redirects that found the conflict.** Reporting
   the conflict and creating the redirect anyway is the failure this rule exists
   to prevent - the user cannot answer a question you already acted on. If your
   next action after listing is a write, you have skipped this step.
4. If neither matched, no deletion is possible: create it in the same turn and
   report the result. Do not ask permission you do not need.

`options.forceReplace` is the only way to overwrite a taken `from` path, and it
**deletes** the redirect holding it. Never set it on your own initiative. Offer it
only after reporting the conflict, and only if the user asks to replace.

## The six methods and their request shapes

Every path is under `https://www.wixapis.com/seo-redirects-service/v1`. Use these
directly - do not go looking for the shapes in the docs first.

| Method | Call |
|---|---|
| List Redirects | `GET /redirects` - no body, no parameters |
| Get Redirect | `GET /redirects/{redirectId}` |
| Create Redirect | `POST /create-redirect` - body below |
| Delete Redirect | `DELETE /redirects/{redirectId}` - empty response |
| Bulk Create Redirects | `POST /bulk/redirects/create` |
| Bulk Delete Redirects | `POST /bulk/redirects/delete` |

Create Redirect takes the redirect nested under `redirect`. `options` and
`language` are optional, `id` only when preserving an existing redirect's
identity:

```json
{
  "redirect": {
    "from": "/old-blog",
    "to": "/blog",
    "options": { "groupRedirect": true },
    "language": "fr"
  }
}
```

The two bulk methods take flat lists. Bulk Create's `returnFullEntity` returns
each created redirect in `results[].item`:

```json
{ "redirects": [ { "from": "/old-pricing", "to": "/pricing" } ], "returnFullEntity": true }
```

```json
{ "redirectIds": ["5b07d9de-6a9f-494d-8066-a7b66c970270"] }
```

## Worked example: the request that deletes something

The user asks to send `/old-blog` and everything under it to `/blog`.

**1. List first.**

```
GET https://www.wixapis.com/seo-redirects-service/v1/redirects
```

```json
{
  "redirects": [
    {
      "id": "583fe7d7-2944-436f-870a-09eb6d2e52fa",
      "from": "/blog",
      "to": "/news",
      "createdDate": "2026-08-20T09:12:44.000Z"
    }
  ]
}
```

**2. Compare.** The new `to` is `/blog`, and an existing redirect's `from` is
`/blog`. That is the deletion case. **End the turn here** - report that creating
this redirect deletes `/blog` -> `/news` permanently, and that the two will not
chain, then wait.

**3. Only after the user agrees**, create it:

```
POST https://www.wixapis.com/seo-redirects-service/v1/create-redirect
```

```json
{ "redirect": { "from": "/old-blog", "to": "/blog", "options": { "groupRedirect": true } } }
```

```json
{
  "redirect": {
    "id": "9c4a1f2e-77b0-4b13-a2c8-6e0d3f5b8a91",
    "from": "/old-blog",
    "to": "/blog",
    "options": { "groupRedirect": true }
  }
}
```

`/blog` -> `/news` is now gone. Say so - do not report it as still in place, and
do not describe the result as `/old-blog` -> `/blog` -> `/news`.

## When a write fails

Report the failure and stop. Do **not** retry with a different request shape, a
different path, `forceReplace` added, or a bulk call in place of a single one. A
failed create wrote nothing, so there is nothing to clean up, and a mutated retry
is a second attempt at a decision the user has not agreed to.

On the first `403` or `PERMISSION_DENIED`, stop and report the missing
authorization for managing SEO settings. Do not try another site, path, or method.

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

## Read: List Redirects is the only way to read many

**There is no query endpoint and no search endpoint.** Most Wix APIs have one, so
this is the second place an agent goes wrong. Do not call, construct, or go
looking for `POST /v1/redirects/query`, a `/search` path, or any filtered variant:
they do not exist, and trying one wastes a turn and returns nothing useful.

- **List Redirects** returns every redirect on the site in one response. It takes
  no filter, sort, cursor, or paging parameter at all. Filter, sort, and slice the
  returned array yourself. It also returns redirects Wix created for the site
  owner, such as when a page's URL slug was renamed in the editor.
- **Get Redirect** retrieves one by ID.

## Change an existing redirect

There is **no update method**, and as above no query method. To change a redirect:

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

## Reading errors

- On a 400, read `details.validationError.fieldViolations` and report the named
  field rather than guessing.
- **Known divergence:** the reference documents `REDIRECT_NOT_FOUND` for an
  unknown redirect ID on Get Redirect and Delete Redirect. The API currently
  returns a generic 404 without that code. Treat any 404 on those two methods as
  "no redirect with that ID", and do not tell the user the ID was valid.
- No webhook or event is emitted when a redirect is created or deleted. Never
  treat the absence of an event as the absence of a change.
