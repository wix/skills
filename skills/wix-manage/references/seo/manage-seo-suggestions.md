---
name: "Generate AI SEO Suggestions for a Wix Site"
description: "Generate AI-written SEO text for a Wix site through the public Tag Suggestions and Page Optimization APIs: title tag and meta description options for a page, alt text for the images of a page, store product, or blog post (one image or up to 20 per call), corrected heading levels for a page's headings, and a whole-page rewrite of title, description, headings, and body text aimed at the page's focus keyword, returned as before/after pairs. Use it when the user asks for SEO title or meta description options or ideas, or wants to improve, optimize, audit, or write the SEO text of a page or the homepage: Wix's AI writes the texts. Suggestions are returned for review; applying one is a separate SEO tags write."
---

# Generate AI SEO Suggestions for a Wix Site

The **Tag Suggestions API** writes single texts from content you pass in: title
tags, meta descriptions, image alt text, heading levels. The **Page Optimization
API** reads a page from the Wix site itself and returns a whole-page rewrite as
before/after pairs. Neither changes the site: every result is a suggestion for
the user to review. Both select the site from the caller's authorization context
and take no site ID. Use the site already selected in the environment. If none
is selected, list the available sites. Select the only site automatically; if
several are available, ask the user to choose by name before making
site-specific calls. Never invent a site ID or ask the user to type one.

All endpoints are under `https://www.wixapis.com/seo/suggestions/v1`. Reads of
the site's pages and writes of its tags use the SEO Tags API under
`https://www.wixapis.com/promote/seo/v1`. Every request and response shape a
flow needs is in this recipe, verified against the live API: build the calls
from here, including the two SEO Tags calls (List Item SEO Tags, and the
focus-keyword write). Use these shapes without a schema lookup. To find the
homepage, complete and inspect the STATIC_PAGE List before any site-URL context
request, then follow the homepage rule under the List response below. Do not
replace it with a shortest-path, first-entry, or title-only guess. Other
reference links cover deeper API cases.

| User asks for | Call |
|---|---|
| SEO title or meta description options, ideas, or a better one for a page | Generate Title Suggestions, Generate Description Suggestions |
| Alt text for images of a page, product, or post | Generate Alt Text Suggestions (one) or Bulk Generate Alt Text Suggestions (up to 20) |
| Check or fix a page's heading hierarchy | Generate Heading Structure Suggestions |
| Optimize or rewrite a page for a keyword, "improve this page's SEO" | Trigger Page Optimization, or Trigger Home Page Optimization for the homepage, then poll Get Page Optimization Results. Site pages only: not blog posts, store products, or booking services |

"Optimize", "rewrite", or "improve the SEO of" a page means the page
optimization flow: it reads the page's real text and rewrites title,
description, headings, and body together. The title and description generators
are not a substitute for it; they know nothing about the page's content and
cover two tags only. Use them when the user asks for title or description
options, not when they ask to optimize a page. For a blog post, store product,
or booking service, which page optimization does not support, they are the
closest option: offer title and description suggestions and alt text for its
images instead. Show them as options only: do not set the item's focus
keyword, do not apply any tag, and do not edit or republish the item until the
user picks one.

When the user asks for SEO title or meta description options, the options are
the texts these generators return. Call them even when the request reads like
a writing task ("give me a few titles", "just show me options"): do not write
titles or descriptions yourself, and do not offer the page's current tags as
options.

Each call spends AI generation and returns fresh text; nothing is stored except
page optimization results. Suggestions come back in the site's language, and
there is no parameter to change it.

## Find the page first

Every flow except title and description needs the page's ID, and most need to
know what the page renders today. Read it once with
[List Item SEO Tags](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/list-item-seo-tags):

```
GET https://www.wixapis.com/promote/seo/v1/item-seo-tags/STATIC_PAGE?paging.limit=50
```

Relevant response fields (other tags omitted; IDs are illustrative):

```json
{ "itemSeoTags": [ { "itemId": "c1dmp", "itemType": "STATIC_PAGE",
    "focusKeywords": [ { "term": "jewelry making styles", "isMain": true } ],
    "resolvedTags": [
      { "tag": { "type": "title", "children": "Home | Luna" }, "source": "TAG_SOURCE_DEFAULT_PATTERN" },
      { "tag": { "type": "link", "props": { "rel": "canonical", "href": "https://www.example.com" } }, "source": "TAG_SOURCE_DEFAULT_PATTERN" },
      { "tag": { "type": "meta", "props": { "name": "description", "content": "..." } }, "source": "TAG_SOURCE_ITEM" } ] } ],
  "pagingMetadata": { "hasNext": false, "cursors": {} } }
```

- `itemId` is the page ID (`pageId` in every call below). For a named non-home
  page, match its resolved title or canonical URL; if ambiguous, ask which page.
- The page path is the path of the canonical `link` `href`: `/cart-page` for
  `https://www.example.com/cart-page`.
- For the homepage, never use a title, custom canonical, or List position. In
  one function, in this order:
  1. Run the List and wait for it. Do not read the site URL in parallel with it.
  2. If exactly one default-pattern canonical is a classic Editor free-site
     root (HTTPS, a hostname ending in `.wixsite.com`, exactly one nonempty path
     segment, no port, credentials, query, or fragment), that item is the
     homepage: make no other read. This is the only rule that works on a
     never-published site, whose context read and Query Sites return no URL.
  3. Otherwise get the site URL from the first applicable row of the
     [Missing site URL](manage-seo-tags.md#missing-site-url) table in Manage SEO
     Tags, and use the one item whose default-pattern canonical matches it
     (ignoring one trailing slash). If no URL comes back, or none or several
     items match, ask the user.
  Homepage optimization always uses `pagePath: "/"`, including free-site URLs
  with a site-address path.
- `focusKeywords` with `isMain: true` is the focus keyword page optimization uses.
- The current title and description are the `title` tag and the `meta` tag named
  `description` in `resolvedTags`; pass them as context, never present them as
  suggestions.
- If `pagingMetadata.hasNext` is `true`, pass `pagingMetadata.cursors.next` as
  `paging.cursor` on the next request until it is `false`.

The SEO Tags API names a site page `STATIC_PAGE`; the suggestion APIs name the
same page `STATIC_PAGE_V2`. Other item types are spelled the same in both:
`STORES_PRODUCT`, `BLOG_POST`, `BOOKINGS_SERVICE`. Any other string returns
`INVALID_ARGUMENT` with "expected itemType to be a seo supported item type".

## Title and description suggestions

Both take the content in the request, so they work for any page, including one
the site does not have yet, and neither needs the page's ID: for the homepage,
call them directly without listing pages first when the user named a keyword.
With no keyword, one List Item SEO Tags read gets the page's `isMain` focus
keyword. Always send `pageType`. When
the user means the homepage ("homepage", "home page", "main page", the page at
`/`), send `HOMEPAGE`; `WEBSITE_PAGE` or an omitted `pageType` is wrong for it.
`WEBSITE_PAGE` (the default) is for any other site page; use `PRODUCT_PAGE`,
`PRODUCT_CATEGORY_PAGE`, `BLOG_POST`,
`BLOG_CATEGORY_PAGE`, `SERVICE_BOOKING_PAGE`, `EVENT_PAGE`,
`RESTAURANT_MENU_PAGE`, `PORTFOLIO_PROJECT_PAGE`, or `OTHER_APP_PAGE` as fits.
`primaryKeyword` is the keyword the user wants the page to rank for; when the
user named none, use the page's `isMain` focus keyword if it has one.

[Generate Title Suggestions](https://dev.wix.com/docs/api-reference/business-management/seo/tag-suggestions-v1/generate-title-suggestions),
`pageName` required:

```
POST https://www.wixapis.com/seo/suggestions/v1/tag-suggestions/title
```

```json
{ "pageType": "HOMEPAGE", "pageName": "Home", "primaryKeyword": "boutique hotel santorini" }
```

```json
{ "tagSuggestions": { "suggestions": [ "Experience Boutique Hotel Santorini Luxury and Charm | Luna", "Discover Boutique Hotel Santorini: Unique Stays & Stunning Views | Luna" ] } }
```

[Generate Description Suggestions](https://dev.wix.com/docs/api-reference/business-management/seo/tag-suggestions-v1/generate-description-suggestions),
`pageName` and `topic` required; `primaryKeyword`, `toneOfVoice`,
`businessType`, `businessLocation`, and `pageContent` (the page's text, up to
100,000 characters) are optional hints that may or may not appear in the text:

```
POST https://www.wixapis.com/seo/suggestions/v1/tag-suggestions/description
```

```json
{ "pageType": "HOMEPAGE", "pageName": "Home", "topic": "Boutique hotel in Santorini",
  "primaryKeyword": "boutique hotel santorini", "toneOfVoice": "warm" }
```

The response has the same `tagSuggestions.suggestions` shape. Both return best
match first, up to 10, often fewer: texts outside the target length or missing
the keyword are filtered out. Titles aim for 45 to 65 characters, descriptions
for 130 to 165. Send page content only in the free-text fields, never personal
data: they are sent to the AI model and written to service logs.

Call each generator once per request and present every returned text verbatim,
in the order returned, as the options to choose from. The only repeat calls are
the one retry that [Limits and errors](#limits-and-errors) allows after rate
limiting or `GENERATION_FAILED`. If fewer came back than the user wanted, even
none, say how many came back; do not call again with changed input, never add
texts of your own to make up the number, and never edit a returned text, not
even its punctuation, before showing it.

Applying a text is a separate write that needs the user's approval. Read the
page's current tags with
`GET https://www.wixapis.com/promote/seo/v1/item-seo-tags/STATIC_PAGE/{pageId}`,
merge the new `{ "type": "title", "children": "..." }` or
`{ "type": "meta", "props": { "name": "description", "content": "..." } }` into
the full `tags` array it returns, and send the whole array back with
`PATCH https://www.wixapis.com/promote/seo/v1/item-seo-tags/STATIC_PAGE/{pageId}`
and body `{ "itemSeoTags": { "tags": [ ... ] }, "fieldMask": "tags" }`. The
write replaces the page's tags in full, so a body holding only the new tag
deletes every other tag the page had. Static pages save to the draft unless the
body also has `"publish": true`. Full rules:
[Set Item SEO Tags](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/set-item-seo-tags).

## Alt text suggestions

Alt text is generated only for images that belong to a Wix item, identified by
the item's ID and type; the item's stored SEO data gives the AI its context.
The image URL must be on a Wix media domain (`static.wixstatic.com` or another
`wixstatic.com` / `wixmp.com` host). Any other host fails the whole call with
`INVALID_ARGUMENT` on `image.url`: "Alt text can only be generated for
Wix-hosted images". Do not retry with the same URL.

For a store product, get the ID and image URLs from Query Products
(`POST https://www.wixapis.com/stores/v3/products/query` with
`{ "query": { "cursorPaging": { "limit": 20 } }, "fields": ["MEDIA_ITEMS_INFO"] }`):
each product's `id` is the `parentItemId`, and `media.itemsInfo.items[].image.url`
are its image URLs. For a site page, `parentItemId` is the page's `itemId` from
List Item SEO Tags (listed there under `STATIC_PAGE`), and the alt-text call's
`itemType` is `STATIC_PAGE_V2`.

[Generate Alt Text Suggestions](https://dev.wix.com/docs/api-reference/business-management/seo/tag-suggestions-v1/generate-alt-text-suggestions),
one image; `id` is your own label, echoed back:

```
POST https://www.wixapis.com/seo/suggestions/v1/tag-suggestions/alt-text
```

```json
{ "itemType": "STORES_PRODUCT",
  "image": { "id": "main", "url": "https://static.wixstatic.com/media/22e53e_5a34c410f18f4760b451208652e8cf27~mv2.jpg",
             "parentItemId": "7ef5f127-5e5d-4ebb-9957-d122ce56daec" } }
```

```json
{ "altTextSuggestions": { "imageId": "main", "url": "https://static.wixstatic.com/media/22e53e_5a34c410f18f4760b451208652e8cf27~mv2.jpg",
    "suggestions": [ "Ceramic flower vase with dried roses on a stone surface" ] } }
```

[Bulk Generate Alt Text Suggestions](https://dev.wix.com/docs/api-reference/business-management/seo/tag-suggestions-v1/bulk-generate-alt-text-suggestions),
up to 20 images of the same `itemType` per call; split larger sets:

```
POST https://www.wixapis.com/seo/suggestions/v1/tag-suggestions/alt-text-bulk
```

```json
{ "itemType": "STORES_PRODUCT", "images": [
    { "id": "main", "url": "https://static.wixstatic.com/media/22e53e_5a34c410f18f4760b451208652e8cf27~mv2.jpg", "parentItemId": "7ef5f127-5e5d-4ebb-9957-d122ce56daec" },
    { "id": "second", "url": "https://static.wixstatic.com/media/22e53e_0a3fe4969636459b8fde2bde4bbe109d~mv2.jpg", "parentItemId": "7ef5f127-5e5d-4ebb-9957-d122ce56daec" } ] }
```

```json
{ "results": [ { "imageId": "main", "success": true, "suggestions": [ "Dried roses in a matte ceramic flower vase on a stone ledge." ] },
               { "imageId": "second", "success": true, "suggestions": [ "Minimalist matte beige ceramic flower vase" ] } ],
  "successCount": 2, "failureCount": 0 }
```

`results` follow request order. An entry with `success: false` has no
suggestions: retry that image alone with the single-image call, once. Up to 5
suggestions per image, often one. Report `failureCount` as returned. Applying
alt text happens in the product's or page's own settings, not through these APIs.

## Heading structure suggestions

[Generate Heading Structure Suggestions](https://dev.wix.com/docs/api-reference/business-management/seo/tag-suggestions-v1/generate-heading-structure-suggestions)
takes the page's headings in page order, each with its raw HTML and your own
`id`; `sectionId` groups headings that belong to one section. It must be called
with a Wix user identity (a signed-in site owner or an app acting for one);
with an API key the call fails, by design, because the page title is read
through the site's accessibility analysis, which runs as the user.

```
POST https://www.wixapis.com/seo/suggestions/v1/tag-suggestions/heading-structure
```

```json
{ "pageId": "c1dmp", "itemType": "STATIC_PAGE_V2",
  "headings": [ { "id": "hero", "htmlString": "<h1>Luna Boutique Hotel</h1>", "sectionId": "hero" },
                { "id": "rooms", "htmlString": "<h3>Our rooms</h3>", "sectionId": "rooms" },
                { "id": "rooms-suite", "htmlString": "<h4>Caldera suite</h4>", "sectionId": "rooms" },
                { "id": "contact", "htmlString": "<h1>Contact us</h1>", "sectionId": "contact" } ] }
```

```json
{ "suggestions": [ { "headingId": "rooms", "currentTag": "H3", "proposedTag": "H2" },
                   { "headingId": "rooms-suite", "currentTag": "H4", "proposedTag": "H3" },
                   { "headingId": "contact", "currentTag": "H1", "proposedTag": "H2" } ] }
```

Only headings that should change are returned; an empty `suggestions` array
means the structure is already correct. `proposedTag` `P` means the text should
not be a heading. Up to 200 headings per call. The heading text comes from the
user or from the page content you already have; this recipe has no method that
fetches a page's headings.

## Page optimization: trigger, then poll

Page optimization works only on site pages (`STATIC_PAGE` in List Item SEO
Tags), including the homepage. The API returns an error for any other item,
such as a blog post, store product, or booking service. When the user asks to
optimize one of those, do not set its focus keyword and do not trigger a job:
both would fail. Lead with what you can do for it: offer title and description
suggestions (`pageType` `BLOG_POST`, `PRODUCT_PAGE`, or `SERVICE_BOOKING_PAGE`)
and alt text for its images. These are offers: apply no tag and do not edit
the item's own text until the user picks one. Then add one short, friendly
line saying that the full rewrite of headings and body text is available for
the site's pages, and offer to run it on one of them. Do not mention errors or
item types.

Page optimization reads the page from the site's latest saved revision, so
unpublished edits count and the site need not be published. It needs two
things, checked in this order:

1. **A Wix-rendered site.** Headless projects fail with `FAILED_PRECONDITION`,
   code `SITE_NOT_SUPPORTED`. Stop and tell the user: nothing else in this
   section can work on that site.
2. **A focus keyword on the page**, site pages only: never set one on a blog
   post, store product, or booking service (`focusKeywords` entry with
   `isMain: true` from List Item SEO Tags). Without one the trigger fails with
   `FAILED_PRECONDITION`, code `FOCUS_KEYWORD_NOT_SET`. If the user named the
   keyword they want the page to rank for, set it, then trigger; if they did
   not, ask for it. The focus keyword is the input the job needs, not one of the
   suggested changes: a user who says "optimize my page for X but don't apply
   anything yet" still expects X to be set as the focus keyword, and only the
   returned before/after texts to be held back. Setting it is a write to the
   page's SEO settings:

   ```
   PATCH https://www.wixapis.com/promote/seo/v1/item-seo-tags/STATIC_PAGE/{pageId}
   ```

   ```json
   { "itemSeoTags": { "focusKeywords": [ { "term": "handmade ceramic mugs", "isMain": true } ] }, "fieldMask": "focusKeywords" }
   ```

   The field mask limits the write to `focusKeywords`, so the page's tags are
   untouched and no read is needed before this write: List Item SEO Tags already
   returned the page's current `focusKeywords`, and the SEO Tags API's
   read-before-write rule exists for the `tags` array, which this call does not
   send. The response echoes the page with its new `focusKeywords`.

Then start one job. Use
[Trigger Home Page Optimization](https://dev.wix.com/docs/api-reference/business-management/seo/page-optimization-v1/trigger-home-page-optimization)
for the homepage (its text represents the whole site, so it gets its own
guidance) and
[Trigger Page Optimization](https://dev.wix.com/docs/api-reference/business-management/seo/page-optimization-v1/trigger-page-optimization)
for any other site page. Both need a Wix user identity, like heading structure;
both take the page ID and its path:

```
POST https://www.wixapis.com/seo/suggestions/v1/page-optimization/trigger-home
```

```json
{ "pageId": "c1dmp", "pagePath": "/" }
```

```json
{ "predictionId": "2247d724-1440-483d-bf66-f7edf8582a34" }
```

Keep `predictionId`. Triggering the same page again while its job runs returns
the same `predictionId`, so a duplicate call is harmless, but do not send one on
purpose: each trigger is counted against the daily cap below. Then poll
[Get Page Optimization Results](https://dev.wix.com/docs/api-reference/business-management/seo/page-optimization-v1/get-page-optimization-results)
every few seconds until `status` leaves `IN_PROGRESS`; generation usually
finishes within two minutes:

```
GET https://www.wixapis.com/seo/suggestions/v1/page-optimization/results?predictionId=2247d724-1440-483d-bf66-f7edf8582a34
```

```json
{ "status": "IN_PROGRESS" }
```

```json
{ "pageOptimization": {
    "metaTitle": { "before": "Home | Luna", "after": "Jewelry Making Styles by Luna in New York City | Online" },
    "metaDescription": { "before": "", "after": "Explore jewelry making styles from Luna in New York City – shop our online store today." },
    "h1": { "before": "Luna & Loop", "after": "Artisanal Jewelry Making Styles by Luna & Loop" },
    "h2OrH3": { "before": "Luna & Loop Jewelry", "after": "Luna & Loop Jewelry Making Styles" },
    "content": [] },
  "status": "COMPLETED" }
```

- `COMPLETED`: present each pair as the current text and the proposed text. An
  empty `before` means the page has no text in that slot yet (here, no meta
  description). `content` lists body-text rewrites and can be empty.
- `FAILED`: the job failed; trigger once more, and if it fails again report it.
- `NOT_FOUND`: no job matches. The `predictionId` expires two hours after the
  trigger, and a later trigger for the same page replaces the earlier job.
  `GET .../page-optimization/results?pageId=c1dmp` returns the page's latest
  completed set at any time, so use it when the user comes back later.
- Applying a pair is the user's decision. Title and description go through Set
  Item SEO Tags as described above; headings and body text are edited in the
  page itself, which these APIs cannot do.

## Limits and errors

- Per-second limits: 5 requests per second per user for tag suggestions, 2 for
  page optimization. A call rejected for rate limiting can be retried once after
  a short pause.
- Per-user daily caps on `www.wixapis.com`: 200 title, 200 description, 500
  alt-text, 100 bulk alt-text, and 50 page-optimization triggers per day. A `429`
  means the cap for that method is spent: stop calling it and tell the user it
  resets the next day. Do not switch to another method to get the same text.
- `403` or `PERMISSION_DENIED`: stop after the first one and report that the
  current identity lacks the SEO permission (reads and generators need view
  access to SEO settings, triggers and tag writes need manage access). Do not
  try another site, path, method, or request shape: the same identity gets the
  same answer.
- Heading structure or a trigger failing with an internal error or `403` under
  an API key is the identity rule above, not an outage: say a Wix user identity
  is required and stop.
- `FAILED_PRECONDITION`: read `details.applicationError.code`.
  `FOCUS_KEYWORD_NOT_SET` and `SITE_NOT_SUPPORTED` are covered above;
  `CONTENT_TOO_SHORT` means the page has too little text to optimize, so the user
  must add content first; `SUGGESTIONS_ALREADY_IN_PROGRESS` means a job with a
  different focus keyword is still running, so poll that page by `pageId` and
  trigger again when it completes. `PAGE_NOT_SUPPORTED` means the ID is not a site
  page, such as a blog post. Do not report it as an error: offer title and
  description suggestions for that item instead, then say that the full
  rewrite is available for the site's pages. None of these succeeds on retry.
- `GENERATION_FAILED` (`500`): the AI pipeline failed for this call; retry once,
  then report.
- `INVALID_ARGUMENT` (`400`): fix the field named in `fieldViolations` and send
  once more; never cycle through guessed shapes.
