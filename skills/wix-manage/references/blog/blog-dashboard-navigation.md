---
name: "Blog Dashboard Navigation"
description: "Builds direct links to Wix Blog dashboard pages on manage.wix.com — posts list (published and draft tabs), categories, tags, writers, comment moderation, blog analytics, monetization, and settings. Pairs each main Blog entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Blog Dashboard Navigation

Build direct links into the Wix Blog pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

All Wix Blog (app ID `14bcded7-0066-7c35-14d7-466cb3f09103`) pages live under:

```
https://manage.wix.com/dashboard/{metaSiteId}/blog/{route}
```

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Overview | `blog/overview` | Blog summary and quick actions |
| Posts | `blog/posts` | All posts — the page has tabs for published posts and drafts |
| Categories | `blog/categories` | Post categories |
| Edit category | `blog/categories/edit` | A specific category |
| Tags | `blog/tags` | Post tags |
| Writers | `blog/writers` | Writers and editors |
| Edit writer | `blog/writers/edit` | A specific writer |
| Comments | `blog/comments` | Comment moderation |
| Blog analytics | `blog/analytics` | Traffic and engagement analytics |
| Monetization | `blog/monetization` | Ways to earn from the blog |
| Blog settings | `blog/settings` | Blog-level settings |

The bare app root `blog` lands on the posts page. Older writer-management links (`staff-management/writers/...`) redirect to `blog/writers`.

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header. Published posts and drafts are separate endpoints (Blog Posts API vs Draft Posts API) but share the same dashboard page — drafts sit in the Drafts tab of `blog/posts`.

| Entity | Read API | Dashboard link |
|---|---|---|
| Post (published) | `GET /blog/v3/posts` · `POST /blog/v3/posts/query` · `GET /blog/v3/posts/{postId}` | `blog/posts` |
| Draft post | `GET /blog/v3/draft-posts` · `POST /blog/v3/draft-posts/query` · `GET /blog/v3/draft-posts/{draftPostId}` | `blog/posts` (Drafts tab) |
| Category | `GET /blog/v3/categories` · `POST /blog/v3/categories/query` | `blog/categories` |
| Tag | `POST /blog/v3/tags/query` · `GET /blog/v3/tags/{tagId}` | `blog/tags` |
| Comment | Comments API — `POST /comments/v1/comments/query-cursor` | `blog/comments` |
| Writer | Writers are site members — `GET /members/v1/members` (List Members) | `blog/writers` |

Example — after publishing a post, hand back the dashboard link:

```
Published "10 Tips for Better Coffee".
Manage your posts here: https://manage.wix.com/dashboard/{metaSiteId}/blog/posts
```

## Notes

- Unknown deeper paths fall back to the longest matching route, so `blog/posts/...` links land on the posts list rather than 404.
