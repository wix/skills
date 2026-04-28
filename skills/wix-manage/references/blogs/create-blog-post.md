---
name: "Recipe: How to create Blog post"
description: "Creates and publishes a single blog post with rich content using Wix Blog Draft Posts API. Covers fetching an author member ID, building a minimal Ricos rich content body, publishing on creation, and verifying the post by slug."
---

# How to create Blog post

Create and publish a blog post (e.g., a "Hello World" first post) on a Wix site using the Wix Blog REST API. This recipe covers the minimum required flow: get an author member ID, create a draft post with Ricos rich content, and publish it in the same call.

## Prerequisites

- **Wix Blog must be installed** on the site (app ID `14bcded7-0066-7c35-14d7-466cb3f09103`). If it isn't, install it first using the [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps) recipe.
- The site must have at least one site member or collaborator that can be used as the post author. When calling the Blog API as a 3rd-party app, `draftPost.memberId` is required — the API will reject requests with "Missing post owner information" if it is omitted.

## Required APIs

- [List Members](https://dev.wix.com/docs/rest/crm/members-contacts/members/member-management/members/list-members) — `GET /members/v1/members`
- [Create Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/create-draft-post) — `POST /blog/v3/draft-posts`
- [Get Post By Slug](https://dev.wix.com/docs/api-reference/business-solutions/blog/posts/get-post-by-slug) — `GET /blog/v3/posts/slugs/{slug}`

## Steps

### Step 1: Get an author member ID

Query site members and pick one to be the post author. The `id` field on the returned member is what you'll send as `draftPost.memberId`.

**Request**

```
GET https://www.wixapis.com/members/v1/members?fieldsets=PUBLIC&paging.limit=1
```

**Response**

```json
{
  "members": [
    {
      "id": "0d56f596-34ca-40c3-81fd-5046045a87a0",
      "status": "UNKNOWN",
      "contactId": "510ffb5b-a02e-4da7-9b34-81ba09041897",
      "profile": {
        "nickname": "Yotam Suloman",
        "slug": "yotamsu",
        "photo": {
          "id": "",
          "url": "https://lh3.googleusercontent.com/a/ACg8ocJr4jpLGiX20Y13_4sQGDj3OiGexdRDwP2CS_WNZC4Tdyfv79s%3Ds96-c",
          "height": 0,
          "width": 0
        }
      },
      "privacyStatus": "UNKNOWN",
      "activityStatus": "UNKNOWN",
      "createdDate": "2025-02-11T09:24:10Z",
      "updatedDate": "2025-02-11T09:24:09.986Z"
    }
  ],
  "metadata": { "count": 1, "offset": 0, "total": 2, "tooManyToCount": false }
}
```

Take `members[0].id` (e.g., `0d56f596-34ca-40c3-81fd-5046045a87a0`) for use in Step 2.

> If `members` is empty, the site has no members yet — create one first or use the site owner's member ID.

### Step 2: Create and publish the blog post

Send a single `POST /blog/v3/draft-posts` request with `publish: true` so the post is created and published in one call. The body content is a Ricos document — for "Hello World" use a single `PARAGRAPH` node containing one `TEXT` node.

**Request**

```
POST https://www.wixapis.com/blog/v3/draft-posts
Content-Type: application/json
```

```json
{
  "draftPost": {
    "title": "Hello World",
    "memberId": "0d56f596-34ca-40c3-81fd-5046045a87a0",
    "richContent": {
      "nodes": [
        {
          "type": "PARAGRAPH",
          "nodes": [
            {
              "type": "TEXT",
              "textData": {
                "text": "Hello World",
                "decorations": []
              }
            }
          ],
          "paragraphData": {}
        }
      ]
    }
  },
  "publish": true,
  "fieldsets": ["URL"]
}
```

**Response**

```json
{
  "draftPost": {
    "id": "1d6321db-ccb8-4ce7-bd12-82d5f7bf0337",
    "title": "Hello World",
    "memberId": "0d56f596-34ca-40c3-81fd-5046045a87a0",
    "status": "PUBLISHED",
    "contentId": "69f0b681e1a06255b503f729",
    "editingSessionId": "98f0ae28-a74f-40ff-903e-5d57da71ba12",
    "minutesToRead": 1,
    "language": "en",
    "changeOrigin": "PUBLISH",
    "hasUnpublishedChanges": false,
    "editedDate": "2026-04-28T13:30:40.948Z",
    "firstPublishedDate": "2026-04-28T13:30:41.030Z",
    "createdDate": "2026-04-28T13:30:40.948Z",
    "slugs": ["hello-world"],
    "seoSlug": "hello-world",
    "url": { "base": "", "path": "/post/hello-world" },
    "media": { "displayed": true, "custom": false },
    "commentingEnabled": true,
    "categoryIds": [],
    "tagIds": [],
    "hashtags": [],
    "relatedPostIds": [],
    "pricingPlanIds": [],
    "translations": [],
    "seoData": { "tags": [] }
  }
}
```

Confirm `status` is `PUBLISHED` and capture `draftPost.id` and `draftPost.slugs[0]` for verification.

### Step 3: Verify the published post by slug

Fetch the live post by its slug to confirm it is publicly available.

**Request**

```
GET https://www.wixapis.com/blog/v3/posts/slugs/hello-world
```

**Response**

```json
{
  "post": {
    "id": "1d6321db-ccb8-4ce7-bd12-82d5f7bf0337",
    "title": "Hello World",
    "excerpt": "Hello World",
    "slug": "hello-world",
    "firstPublishedDate": "2026-04-28T13:30:41.030Z",
    "lastPublishedDate": "2026-04-28T13:30:41.030Z",
    "memberId": "0d56f596-34ca-40c3-81fd-5046045a87a0",
    "contentId": "69f0b681e1a06255b503f729",
    "minutesToRead": 1,
    "language": "en",
    "preview": false,
    "featured": false,
    "pinned": false,
    "commentingEnabled": true,
    "hasUnpublishedChanges": false,
    "media": { "displayed": true, "custom": false },
    "categoryIds": [],
    "tagIds": [],
    "hashtags": [],
    "relatedPostIds": [],
    "pricingPlanIds": [],
    "translations": [],
    "internalCategoryIds": [],
    "internalRelatedPostIds": [],
    "customExcerpt": false
  }
}
```

A `200` response with a `post` object whose `id` matches the draft post `id` from Step 2 confirms the post is live at `/post/hello-world`.

## Notes

- **Rich content:** `draftPost.richContent` follows the Ricos document format. For richer posts (headings, images, lists, etc.), see [Ricos documentation](https://dev.wix.com/docs/rest/assets/rich-content/ricos-documents/introduction) and the [How to Create Blog Posts](https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts) recipe for embedded image workflows via Media Manager.
- **Publish vs. draft:** Omit `publish` (or set it to `false`) to create the post as an unpublished draft. With `publish: true`, the post is immediately live and `firstPublishedDate` is set.
- **`fieldsets: ["URL"]`** asks the response to include the `url` object so you can build a link to the post.

## Error Handling

- **`Missing post owner information`** when calling `POST /blog/v3/draft-posts` — `draftPost.memberId` was not provided. Run Step 1 to fetch a member ID and include it in the request body. This is required for 3rd-party app calls.
- **Empty `members` array in Step 1** — the site has no members or collaborators yet. Create a member first (or use the site owner's member ID) before creating the post.
- **`404` on `GET /blog/v3/posts/slugs/{slug}`** — the post is not published or the slug is wrong. Verify Step 2 returned `status: "PUBLISHED"` and use the exact value from `draftPost.slugs[0]` / `seoSlug`.
- **Wix Blog not installed** — calls to `/blog/v3/*` will fail with an authorization/not-found error. Install app `14bcded7-0066-7c35-14d7-466cb3f09103` first (see Prerequisites).