---
name: "Blog Recipes"
description: "Blog content management — create and publish posts, drafts, authors, categories and tags, rich-content bodies, cover images, comment moderation, and direct links to Blog dashboard pages. Use for anything users call blog posts, articles, writing, publishing, or blogging."
---

# Blog Recipes

Recipes for the Wix Blog APIs. Posts always need an author `memberId` — if the
site has no members yet, one must be created first; the create recipe covers
this. Post bodies are Ricos rich content, not plain strings or HTML; images go
through the Media Manager before they can be referenced. For rich-content
authoring beyond the basics see
[Rich Content](https://dev.wix.com/docs/api-reference/assets/rich-content/skills/author-ricos-rich-content).

Use **How to Create Blog Posts** for anything that writes: drafting,
publishing, categories and tags, cover images, bulk creation. Use **Blog
Dashboard Navigation** when the user asks where something lives in the
dashboard, or when a result should come back with a "view it in your
dashboard" link.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [How to Create Blog Posts](https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts)
**Technical:** Creates and publishes blog posts using Blog Posts API. Covers resolving
the required author memberId (including creating an author member when the site has
none), Ricos rich content format, image upload via Media Manager, category/tag
assignment, and bulk post creation.

### [Blog Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/blog-dashboard-navigation)
**Technical:** Builds direct links to Wix Blog dashboard pages on manage.wix.com — posts
list (published and draft tabs), categories, tags, writers, comment moderation, blog
analytics, monetization, and settings. Pairs each main Blog entity with its read API so
you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the
user asks where something is in the Wix dashboard, wants a direct link to a dashboard
page, or you need a dashboard URL to include with the result of an API operation.
