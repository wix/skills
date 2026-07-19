---
name: "Fix Blog SEO: Distinct Title Tag from H1"
description: Sets a distinct SEO <title> tag on blog posts and categories without changing the visible H1, using seoData.tags on UpdateDraftPost and UpdateCategory. Fixes "H1 duplicates title tag" findings from SEO audit tools (e.g. Semrush, Ahrefs).
---
# Fix Blog SEO: Distinct Title Tag from H1

SEO audit tools commonly flag blog posts and category pages for "H1 duplicates title tag" — the page's visible H1 heading and its SEO `<title>` tag are identical, which hurts search ranking. The fix is to set a distinct SEO title via `seoData.tags`, leaving the visible H1 (the post/category `title`/`label`) untouched.

This applies to both:
- **Blog posts**: via [Update Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/update-draft-post)
- **Blog categories**: via [Update Category](https://dev.wix.com/docs/api-reference/business-solutions/blog/category/update-category)

## Prerequisites

- Wix Blog app installed on the site (see [List Installed Apps](../app-installation/list-installed-apps.md) to verify)
- The post/category `id` you want to fix

## Step 1: Update a draft post's SEO title

Call `UpdateDraftPost` with `draftPost.seoData.tags` containing a `title` tag. Do **not** change `draftPost.title` — that's the H1.

```bash
curl -X PATCH "https://www.wixapis.com/blog/v3/draft-posts/{draftPostId}" \
  -H "Authorization: <AUTH>" \
  -H "Content-Type: application/json" \
  -d '{
    "draftPost": {
      "id": "{draftPostId}",
      "seoData": {
        "tags": [
          { "type": "title", "children": "A distinct, keyword-rich SEO title" }
        ]
      }
    }
  }'
```

> **Known API quirk:** The `UpdateDraftPost` response omits `seoData`, `seoSlug`, and returns a placeholder `slugs: [""]` — even though the update **did** persist correctly. This happens on every update, not just SEO changes. Don't treat the response as authoritative for these fields; call [Get Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/get-draft-post) immediately after to confirm the write, especially before reporting success to a user.

If the post is already published, this recipe still applies — `UpdateDraftPost` edits the draft layer of a published post; the live page picks up the new SEO title without a separate publish step for `seoData` changes alone. If in doubt, follow with `action: "UPDATE_PUBLICATION"`.

## Step 2: Update a category's SEO title

Same pattern, on `UpdateCategory`:

```bash
curl -X PATCH "https://www.wixapis.com/blog/v3/categories/{categoryId}" \
  -H "Authorization: <AUTH>" \
  -H "Content-Type: application/json" \
  -d '{
    "category": {
      "id": "{categoryId}",
      "seoData": {
        "tags": [
          { "type": "title", "children": "A distinct, keyword-rich SEO title" }
        ]
      }
    }
  }'
```

> **Fieldset gotcha:** Unlike draft posts, a category's `seoData` is gated behind the `SEO` response fieldset — `GetCategory`/`ListCategories` won't return it unless you pass `fieldsets: ["SEO"]` (REST: `?fieldsets=SEO`). This is expected behavior, not a bug — don't confuse a missing `seoData` in a plain `GET` response with the update having failed.

## Step 3: Bulk-fixing many pages (typical after an SEO audit)

SEO audits usually flag many pages at once. Loop over the flagged post/category IDs and call the corresponding update method for each — there is no bulk endpoint for `seoData` alone, but [Bulk Update Draft Posts](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/bulk-update-draft-posts) accepts up to 20 posts per call and supports the same `seoData.tags` shape per item.

## Common mistakes

- **Changing `title`/`label` instead of `seoData.tags`** — that changes the H1, not the SEO title, and doesn't fix the audit finding.
- **Assuming the `UpdateDraftPost` response reflects the final state** — see the quirk above; re-fetch to confirm.
- **Forgetting `fieldsets: ["SEO"]` when reading back a category's SEO title** — it will look unset even when it isn't.
