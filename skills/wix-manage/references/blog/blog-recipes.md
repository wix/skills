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
[Rich Content](../rich-content/author-ricos-rich-content.md).

Use **How to Create Blog Posts** for anything that writes: drafting,
publishing, categories and tags, cover images, bulk creation. Use **Blog
Dashboard Navigation** when the user asks where something lives in the
dashboard, or when a result should come back with a "view it in your
dashboard" link.

## Recipes

### [How to Create Blog Posts](how-to-create-blog-posts.md)
Use when creating, publishing or bulk-loading posts — including resolving the
author member, Ricos bodies, image upload, and category/tag assignment.

### [Blog Dashboard Navigation](blog-dashboard-navigation.md)
Use when the user wants a dashboard link — posts list, drafts, categories,
tags, writers, comment moderation, analytics, monetization or settings — or to
pair an API result with the page where the user can see it.
