---
name: "Manage a Wix Site's SEO Tags"
description: Read and update SEO titles and tags at the right level, and publish static-page SEO changes. "Change my site's SEO title" names no page, so its default is one question and no write, also under instructions to work autonomously or pick defaults: ask whether the user means the homepage, a specific page, or a page-type pattern, with no API call; site-level tags accept meta tags only, never titles. Discover item IDs and pattern variables, preserve existing tags, and report resolved tags with their sources.
---

# Manage a Wix Site's SEO Tags

**First check the target.** A title request that names no homepage, page, or
page-type convention, such as "change my site's SEO title", gets one question
and no API call: no List, no Get, no write. It does not mean the homepage;
never assume it does, even when no one can answer. Instructions to work
autonomously or to choose reasonable defaults lead to the same result: with no
named target, the default is no write, because any page you pick overwrites a
live title the user did not choose. Asking is the complete, correct result for
that request; reply with exactly: "No SEO settings changed.
Which do you mean: the homepage, another specific page, or a title convention
for a page type (for example all product pages)?" See
[Choose the level](#choose-the-level).

Use the public **SEO APIs** to read and write a Wix site's titles,
descriptions, social tags, canonicals, structured data, and indexing
directives. SEO requests need a site ID, which the API reads from the caller's
authorization context, not the request body. Use the site already selected for
this conversation on **every request**, including item discovery; do not
re-select it or ask for its ID mid-flow. If the target is clear but no site is
selected, list the available sites with
[Query Sites](../sites/query-sites.md). Select the only site automatically; if
several are available, ask the user to choose by name and wait. Never invent a site ID or put one in an SEO request body.

Writing tags requires the **Manage SEO Settings** permission; reading tags or
listing pattern variables does not prove write access.

## The one rule that must never be skipped

**Every write replaces the target's tags in full: read before changing them.**
Sending only the requested tag deletes every other tag on that item, pattern,
or site. Before any Set, Get that exact target, merge the change into the
returned tags, and send the complete set — even when the change looks small, a
list call already returned something, or the target looks empty.

Preserve Get's `tags`, not copies of `resolvedTags`. Leave inherited social
tags (which may derive from the changed title) inherited unless the user
requests separate overrides. Do not add a Get/Set after the accepted write to
freeze or restore derived values; report them from the Set response.

## Choose the level

A title write requires a target: the homepage, a named page or item, or a
page-type title convention. "Change my site's SEO title" names none. Wix has
no site-wide SEO title, and the phrase does not mean the homepage title:
**leave settings unchanged**, with no discovery, schema or docs lookup, or
write. A one-page site, a discovered homepage, or a stated assumption is not
the user's choice; never default to the homepage.

In an interactive conversation, ask once: the homepage, another specific page,
or a title convention for a page type (for example all product pages)? Wait
for the answer. With no answer available, finish with the same reply as at
the top of this recipe: "No SEO settings changed. Which do you mean: the
homepage, another specific page, or a title convention for a page type (for
example all product pages)?"

Wix combines tags from several sources; a more specific source wins. Match the
request to the level that owns the change:

| User intent | Level | API |
|---|---|---|
| "Change my site's default social image", site verification tags, site-wide indexing | Site | **Site SEO Tags** |
| "All my product/blog/event pages should be titled like X" — a convention for every item of a page type | Pattern | **SEO Patterns** |
| "Change the title of this page/product/post" — one specific item | Item | **Item SEO Tags** |

**Site SEO Tags accepts meta tags only** (including site-level social image
and robots settings). Never send `title`, `link`, or `script` tags to
`PATCH https://www.wixapis.com/promote/seo/v1/site-seo-tags`; use Item SEO Tags for a page's title or
SEO Patterns for a page-type convention. See the
[Site SEO Tags object](https://dev.wix.com/docs/api-reference/business-management/seo/site-seo-tags-v1/site-seo-tags-object).

For a homepage request, discover its ID (never assume one such as `home`),
Get its `STATIC_PAGE` Item SEO Tags, and merge the title into the complete set
under the static-page publication rules below. Do not substitute `og:title`
for the SEO title.

Writing one title onto many items duplicates a pattern and is harder to undo. If the request fits more than one level, ask one short question
before writing. A request to change a specific tag at a clear level is already
confirmation to write.

For edge cases, reference article URLs follow this pattern:

`https://dev.wix.com/docs/api-reference/business-management/seo/{api}/` + method slug

| Level | API slug | Methods (slug) |
|---|---|---|
| Site | `site-seo-tags-v1` | Get Site SEO Tags (`get-site-seo-tags`), Set Site SEO Tags (`set-site-seo-tags`) |
| Pattern | `seo-pattern-v1` | Get SEO Pattern (`get-seo-pattern`), List SEO Patterns (`list-seo-patterns`), List SEO Pattern Variables (`list-seo-pattern-variables`), Create SEO Pattern (`create-seo-pattern`), Set SEO Pattern (`set-seo-pattern`), Reset SEO Pattern To Default (`reset-seo-pattern-to-default`) |
| Item | `item-seo-tags-v1` | Get Item SEO Tags (`get-item-seo-tags`), List Item SEO Tags (`list-item-seo-tags`), Set Item SEO Tags (`set-item-seo-tags`), Bulk Set Item SEO Tags (`bulk-set-item-seo-tags`), Reset Item SEO Tags To Default (`reset-item-seo-tags-to-default`) |

## Identify the homepage

Complete and inspect the `STATIC_PAGE` List before looking up a missing site
URL, unless that List is already retained; never request both together, in
parallel, or in the same tool call. An unpublished site's empty `viewUrl` blocks
neither this read nor a draft update: inspect its default canonicals first.

If the site URL is not already known and exactly one default canonical is a
[classic Editor free-site root](https://support.wix.com/en/article/about-your-site-url-prefix),
use it as the site URL without a lookup: require HTTPS, a hostname ending in
`.wixsite.com`, exactly one nonempty path segment, and no port, credentials,
query, or fragment. Reject malformed URLs. This rule does not generalize to
other editors. Otherwise follow [Missing site URL](#missing-site-url). Then
apply the match below.

In the retained `itemSeoTags` List array, inspect only `resolvedTags[]` entries
with `source: TAG_SOURCE_DEFAULT_PATTERN`, `tag.type: link`, and
`tag.props.rel: canonical`. Match `tag.props.href` to the selected site's public
URL, ignoring one trailing slash. Require exactly one matching item with a
nonempty `itemId`. Never match by title, a custom canonical, or position in the unfiltered
response. Missing, conflicting, or multiple matches require clarification with
the page identities; do not repeat List to recover fields already received.
List has no `isHomePage`, `pageName`, or top-level `title` field.
Return from the discovery call itself every listed `itemId` with its default
canonical `href`, not only the match, so the selection can be checked.

In a later API-execution call for this request, carry the retained records
and pick the entry in code by its canonical URL/source, as in the code below,
not by writing its ID as a literal. Selecting the sole entry after validating one match is valid. Never
substitute a pattern write for a single-page request.
See [List Item SEO Tags](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/list-item-seo-tags).

## The write sequence

After discovery: one Get, one Set, then a report (not an API call). For page
changes, keep in the tool output of the calls themselves this run's discovered
page IDs with their default canonical URLs/sources (including nonselected
pages), the selected entry, Get's complete `tags`, and the complete Set request
together with the Set response or error, on success and on failure. A failed
Set throws, so catch it and return the same evidence; never repeat reads or
writes to recover it:

```javascript
const itemBase = "https://www.wixapis.com/promote/seo/v1/item-seo-tags";
const newTitle = "<requested title>";
const publish = false; // true only when the user asked to publish this page
const homepageUrl = "<site URL from Identify the homepage, or the one free-site root>";
const pages = [/* every retained List record: { itemId, canonical, source } */];
const trim = u => u.replace(/\/$/, "");
const target = pages.filter(p => p.source === "TAG_SOURCE_DEFAULT_PATTERN" && trim(p.canonical) === trim(homepageUrl));
if (target.length !== 1) return { pages, target, error: "no single homepage match" };
const get = await wix.request({ scope: "site", method: "GET", url: `${itemBase}/STATIC_PAGE/${target[0].itemId}` });
const getTags = get.data.itemSeoTags.tags ?? [];
const tags = [...getTags.filter(t => t.type !== "title"), { type: "title", children: newTitle }];
const setRequest = { itemSeoTags: { tags }, fieldMask: "tags", publish };
try {
  const set = await wix.request({ scope: "site", method: "PATCH", url: `${itemBase}/STATIC_PAGE/${target[0].itemId}`, body: setRequest });
  return { pages, target, getTags, setRequest, setResponse: set.data };
} catch (e) {
  return { pages, target, getTags, setRequest, setError: e?.response?.data ?? e?.message ?? String(e) };
}
```

Run Get and Set in this one call; do not repeat either.

This is the run's evidence, not the reply: the reply to the user follows [Present results](#present-results), plus the fields a failure
section below requires.

1. **Get** the target's current tags or pattern (see the rule above).
2. **Set** the complete merged set; the field mask names only the changed
   fields.
3. Report from the **Set response** (updated tags and `resolvedTags`). Do not
   issue a verification read; read again only when the user asks about a
   target not read in this session.

**Publishing a static page saves its draft first.** Send one Set with
`publish: true` and the complete merged tags; the server saves it to the
draft, then submits it to the existing public revision. Send no separate draft
Set. Without `publish: true`, Set saves only the draft. The writes are not
atomic: if saving fails, publication is not attempted; if publication fails,
the draft stays saved. See
[Set Item SEO Tags](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/set-item-seo-tags).
Always-live item types, such as store products, need no publish step. Script
tags, including JSON-LD, follow the same publication rules.

Get and List read the draft, not the published revision. Report a successful
publish Set as a saved draft and accepted targeted publish. For requested live-page verification, fetch the rendered
HTML and inspect its head.

To make an item inherit again, call **Reset Item SEO Tags To Default** (or
**Reset SEO Pattern To Default**) — never set an empty list to mean "reset".

On publication failure, do not retry or publish the whole site; follow
[Saved draft when publication fails](#saved-draft-when-publication-fails).

## Worked example: publish a static page's title

`<page-id>` is the `itemId` carried from discovery.

```http
GET https://www.wixapis.com/promote/seo/v1/item-seo-tags/STATIC_PAGE/<page-id>
```

Relevant response:

```json
{"itemSeoTags":{"tags":[{"type":"title","children":"Previous title"},{"type":"meta","props":{"name":"description","content":"Existing page description"}}]}}
```

Replace the title, keep the existing description, and save and publish in one
request:

```http
PATCH https://www.wixapis.com/promote/seo/v1/item-seo-tags/STATIC_PAGE/<page-id>
Content-Type: application/json

{"itemSeoTags":{"tags":[{"type":"title","children":"New homepage title"},{"type":"meta","props":{"name":"description","content":"Existing page description"}}]},"fieldMask":"tags","publish":true}
```

On success, the response returns the accepted `itemSeoTags.tags` and
`resolvedTags`; the title's source is `TAG_SOURCE_HOST_PAGE`. Interpret errors
using [the write sequence](#the-write-sequence).

## REST request and response shapes

Build requests from these shapes without a schema or reference-article lookup.

### Set Item SEO Tags — `PATCH https://www.wixapis.com/promote/seo/v1/item-seo-tags/{itemType}/{itemId}`

```json
{
  "itemSeoTags": {
    "tags": [
      { "type": "title", "children": "Page title here" },
      { "type": "meta", "props": { "name": "description", "content": "Description here" } }
    ]
  },
  "fieldMask": "tags"
}
```

### Get Item SEO Tags — `GET https://www.wixapis.com/promote/seo/v1/item-seo-tags/{itemType}/{itemId}`

No request body. Returns `itemSeoTags` with `tags`, `resolvedTags`,
`hasOverride`, `publishStatus`, and `hostPageId`. For `STATIC_PAGE`,
`publishStatus` is `PUBLISH_STATUS_UNSPECIFIED`; it says nothing about live
state.

### List Item SEO Tags — `GET https://www.wixapis.com/promote/seo/v1/item-seo-tags/{itemType}?paging.limit=100`

No request body. Returns `itemSeoTags[]` and `pagingMetadata` with cursors
(not `itemSeoTagsList`). Each entry is an Item SEO Tags object, not a wrapper:
read `entry.itemId`, `entry.tags`, and `entry.resolvedTags`, not
`entry.itemSeoTags`. Use `itemId` as the path ID, not the composite `id` or
`hostPageId`.

For static-page discovery, call this with `STATIC_PAGE`. Example response:

```json
{
  "itemSeoTags": [
    {
      "itemType": "STATIC_PAGE",
      "itemId": "<page-id>",
      "tags": [],
      "resolvedTags": [
        { "tag": { "type": "title", "children": "Home | Studio Shop" },
          "source": "TAG_SOURCE_DEFAULT_PATTERN" },
        { "tag": { "type": "link", "props": { "rel": "canonical", "href": "<selected-site-url>" } },
          "source": "TAG_SOURCE_DEFAULT_PATTERN" }
      ]
    }
  ],
  "pagingMetadata": { "hasNext": false }
}
```

For a homepage request, use [Identify the homepage](#identify-the-homepage).
For another named page, match its resolved title or canonical URL. Continue
pagination while `pagingMetadata.hasNext` is true, passing
`pagingMetadata.cursors.next` as `paging.cursor`.

### Bulk Set Item SEO Tags — `POST https://www.wixapis.com/promote/seo/v1/bulk/item-seo-tags/set`

Use Bulk Set for multiple items, one item type per call, instead of looping
single-item Sets. Batch at most 100 entries, or 20 for `BLOG_POST`; a larger
batch fails the whole call with `BULK_CHUNK_SIZE_EXCEEDED`, so split by the
limit that error reports.

Write the Bulk Set URL in full as above. It sits beside the single-item
`.../v1/item-seo-tags` path, not under it, so do not build it from `itemBase`.

Get each target first and merge its changes into its own complete `tags`
array; never reuse one item's tags for another. Each entry has its own
`fieldMask`. Top-level `publish` applies to every entry; for static pages it
saves each draft first, as in [the write sequence](#the-write-sequence), with
no separate draft Set. Return each entry's complete Get `tags`, the complete
Bulk Set request, and each returned result's `itemMetadata` (`originalIndex`,
`id`, `success`, `error`) unchanged, on success and on failure.

Retain every tag your Get returns; do not copy this two-tag array over a
richer item:

```json
{
  "itemType": "STATIC_PAGE",
  "publish": true,
  "entries": [
    {
      "itemId": "<discovered-page-id>",
      "itemSeoTags": {
        "tags": [
          { "type": "title", "children": "New page title" },
          { "type": "meta", "props": { "name": "description", "content": "<description-from-this-item-Get>" } }
        ]
      },
      "fieldMask": "tags"
    }
  ]
}
```

Interpret returned rows and whole-call errors with
[Bulk result handling](#bulk-result-handling), not the HTTP status or
aggregate count.

### Set Site SEO Tags — `PATCH https://www.wixapis.com/promote/seo/v1/site-seo-tags`

```json
{
  "siteSeoTags": {
    "tags": [
      { "type": "meta", "props": { "name": "google-site-verification", "content": "token" } }
    ]
  },
  "fieldMask": "tags"
}
```

### Set SEO Pattern — `PATCH https://www.wixapis.com/promote/seo/v1/seo-patterns/{pageType}`

```json
{
  "seoPattern": {
    "pattern": {
      "tags": [
        { "type": "title", "children": "{{item.name}} | {{site.name}}" }
      ]
    }
  },
  "fieldMask": "pattern"
}
```

### Common rules across all shapes

A tag uses `{type, props, children}`: `title` and `script` carry their text in
`children`; `meta` and `link` carry theirs in `props` (`name`/`content` for a
meta tag, `rel`/`href` for a link).

The optional `custom` boolean sits beside `type`, as Get returns it:
`{"type": "meta", "props": {"name": "robots", "content": "noindex"}, "custom": false}`.
It selects the site's **Advanced/Custom Tags** list, not a manual override of
a standard SEO tag. Leave it unset or false for `title` and `script`;
`custom: true` on either is rejected as an invalid tag
([public Bulk Set tag schema](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/bulk-set-item-seo-tags)).
A validation response may wrap its tag findings in `INVALID_TAGS`; preserve
the error's code and findings. For an import explicitly submitted unchanged,
report rejected rows; do not repair their flags or retry them.

`fieldMask` over REST is a comma-separated **string** (`"fieldMask": "tags"`);
the SDK takes an **array** (`fieldMask: ["tags"]`). Sending an array to REST
returns `INVALID_FIELD_MASK`. `publish` is a boolean.

`resolvedTags` in any Get or Set response is an array of
`{tag, source, inheritedTag}`. `source` is one of `TAG_SOURCE_SITE`,
`TAG_SOURCE_DEFAULT_PATTERN`, `TAG_SOURCE_USER_PATTERN`, `TAG_SOURCE_HOST_PAGE`,
`TAG_SOURCE_ITEM`, or `TAG_SOURCE_UNSPECIFIED`. `inheritedTag` appears only when
this source replaced a lower source's value.

For a `STATIC_PAGE`, this API writes the `TAG_SOURCE_HOST_PAGE` layer. See the
[Set Item SEO Tags response example](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/set-item-seo-tags).

## Discover, never invent

- An item is addressed by an **item type and item ID together**, not by URL.
  Common item types: `STATIC_PAGE`, `STORES_PRODUCT`, `STORES_CATEGORY`,
  `BLOG_POST`, `BLOG_CATEGORY`, `BOOKINGS_SERVICE`, `EVENTS_PAGE`,
  `PORTFOLIO_PROJECTS`, `PORTFOLIO_COLLECTIONS`, `RESTAURANTS_MENU_PAGE`.
- To find a product's ID from its name, use Search Products v3:
  `POST https://www.wixapis.com/stores/v3/products/search`, then use that ID
  as the `itemId` with item type `STORES_PRODUCT`. Do not
  scan List Item SEO Tags to match by name — use the vertical API.
- Never fabricate an item ID. If neither its vertical API nor List Item SEO
  Tags finds the item, ask the user.
- An item type exists only when its business solution is installed. The `UNSUPPORTED_ITEM_TYPE` error message lists the supported
  types; do not hardcode types beyond the common values above.
- Before writing a pattern, call **List SEO Pattern Variables** for the page
  type and build the pattern only from returned variables.
- Address dynamic Wix Data page patterns by `pageId`, not collection name.

## Worked example: set a product's SEO title and description

The user asks: *"Set the SEO title of my product 'Handmade Mug' to 'Handmade
Ceramic Mug | Studio Shop' and its description to 'A stoneware mug.'"*

**Step 1 — find the product ID.** Search Products v3 by name:

```
POST https://www.wixapis.com/stores/v3/products/search
{ "search": { "search": { "expression": "Handmade Mug" } } }
```

```json
{ "products": [{ "id": "a1b2c3d4-...", "name": "Handmade Mug", ... }] }
```

Take `products[0].id`; the item type is `STORES_PRODUCT`. Products v1 and
Query Products with a `name` filter both return 400 for this flow.

**Step 2 — read the current tags.**

```
GET https://www.wixapis.com/promote/seo/v1/item-seo-tags/STORES_PRODUCT/{productId}
```

```json
{
  "itemSeoTags": {
    "tags": [],
    "hasOverride": false,
    "resolvedTags": [
      { "tag": { "type": "title", "children": "Handmade Mug | My Site" },
        "source": "TAG_SOURCE_DEFAULT_PATTERN" }
    ]
  }
}
```

`tags` is empty: the item has no overrides yet. `resolvedTags` shows what the
page renders with and each tag's source.

**Step 3 — merge and write.** Merge the title and description into step 2's
full `tags` array and send the complete set:

```json
PATCH https://www.wixapis.com/promote/seo/v1/item-seo-tags/STORES_PRODUCT/{productId}
{
  "itemSeoTags": {
    "tags": [
      { "type": "title", "children": "Handmade Ceramic Mug | Studio Shop" },
      { "type": "meta", "props": { "name": "description", "content": "A stoneware mug." } }
    ]
  },
  "fieldMask": "tags"
}
```

**Step 4 — report from the response.** Report each resolved tag with its
source.

Writes support only the site's primary language: leave `language` unset.
With no revision checking, the last write wins (dashboard edits included), so
read immediately before writing.

## Present results

- Report what a page will render with from the `resolvedTags` returned by the
  last Get or Set — not a fresh call — and name each tag's source (site,
  default pattern, user pattern, host page, or the item itself).
  `hasOverride: false` does not mean built-in defaults — the item may inherit
  from a customized pattern or the site.
- `resolvedTags` excludes tags that site code or apps add at render time:
  present it as what Wix manages, not a literal copy of the page head.

## Missing site URL

When the free-site root rule above does not apply and the site URL is unknown,
use the first applicable row:

| Available information | Action |
|---|---|
| Existing authorization to read selected-site context | Call the JSON endpoint of [Read Account or Site Context](../sites/read-site-context.md), `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context`, with `{"siteId": "<site-id>"}` for an account token, or `{}` for a site-scoped token (which must be the selected site's). The markdown endpoint returns prose without `sites[]`. Read `sites[].url` only for that exact `id`. |
| Existing account authorization with `SITE_LIST.READ`, and no confirmation that the site was never published | Follow [Query Sites](../sites/query-sites.md) with `{"query": {"filter": {"id": {"$in": ["<site-id>"]}}}}`; `$eq` and a bare ID are rejected as `malformed_filter`. Read `sites[].viewUrl` only for that exact `id`. |
| No supported read or no returned URL | Ask for the homepage URL or a page from the retained List; stop without writing. |

An empty `viewUrl` or `PUBLISH_STATUS_UNSPECIFIED` alone does not confirm
that the site was never published.

Match a context read's URL against the same retained List records. Do not list
or select other sites, obtain broader permissions, or try another API after
permission denial.

## Recovery rules

- **`DRAFT_SAVED_NOT_PUBLISHED`:** follow
  [Saved draft when publication fails](#saved-draft-when-publication-fails) and stop.
- **SEO permission denied:** stop after the first SEO `403` or
  `PERMISSION_DENIED`; do not retry with another item, level, request shape, or
  site. Explain that the current Wix identity lacks **Manage SEO Settings** and
  must be reconnected or authorized. A successful read does not mean the write
  ran.
- **`UNSUPPORTED_ITEM_TYPE`:** redirect the request using the supported types
  its message lists; do not retry blindly.
- **`ITEM_NOT_FOUND`:** re-discover the item ID; do not guess a new one.
- **Unsupported site-level tag / `FIELD_NOT_ALLOWED`:** a rejected `title`,
  `link`, or `script` is a wrong-level error, not a nesting or field-mask error,
  and saved no changes. Do not retry it at site level or drop the requested
  tag. Clarify the target if needed, then Get, merge, and write at the item or
  pattern level, never reusing the site's tags as the complete set.
- **Invalid tags:** tags are validated before saving, so nothing changed; fix
  the tag and resend the same complete set.
- **`400` on a request you built from this recipe:** compare it with the
  "REST request and response shapes" section and the wrong-level rule above,
  fix the mismatch (wrong nesting, a missing wrapper key, or an array
  `fieldMask`), and resend. Never resend the same shape or try variations
  hoping one is accepted.
- **Setting tags for `EVENTS_PAGE` items:** not supported yet (reading is);
  say so instead of retrying.

## Publication outcome details

### Bulk result handling

Handle a whole-call error before inspecting results. The
[public bulk contract](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/bulk-set-item-seo-tags)
separates acknowledged draft saves from publication outcomes:

- Retain application-error data (`draftSaved`, `savedItemIds`,
  `publicationStatus`) and report the named saved drafts even when the call
  fails.
- An unexpected system error may instead report saved IDs and
  `publicationStatus: UNKNOWN` in its message; keep those and any confirmed
  published IDs, and report the rest of the public outcome as unconfirmed.
- From an incomplete response, report only the outcomes it confirms; do not
  infer that omitted entries saved, published, or failed.

Match each result to its submitted entry by `itemMetadata.originalIndex`,
never by array position. Require a valid index and, when returned, a matching
`itemMetadata.id`. Read status from `itemMetadata.success` and errors from
`itemMetadata.error`, not top-level `result.success` or `result.error`: true
with no error confirms the row; false with an error reports that error.
Missing or inconsistent metadata leaves the outcome unconfirmed; aggregate
counts do not show which rows succeeded.

A failed publication with `itemMetadata.error.data.draftSaved: true` kept its
saved draft; it is not a pre-save rejection. Report each item's success,
rejection code/description, or uncertainty, separating saved-but-unpublished
entries from confirmed publication. A pre-save validation failure affects only
its entry; retry it only after fixing its cause within the user's request.
Never repair an explicitly unchanged import, retry the whole batch or a saved
entry, invoke whole-site publication, or report partial failure as complete
success.

### Saved draft when publication fails

A never-published site has no public revision to target: its `publish: true`
Set saves the draft, then returns `DRAFT_SAVED_NOT_PUBLISHED` with
`draftSaved: true`, `publicationStatus: "FAILED"`, and `savedItemIds` in
application error data. That means **draft saved, publication blocked** — not
item missing, not nothing changed. Decode it as in
[Retain outcome evidence](#retain-outcome-evidence). For a confirmed
acknowledgement matching the target, the final reply must say that the draft
title is saved but not live, and that whole-site publication needs a separate
user decision. Keep these fields in tool output; repeating them in the reply is
optional context, not a required format:

- Error code: `<actual code>`, for example `DRAFT_SAVED_NOT_PUBLISHED`
- Saved item IDs: `<actual savedItemIds>`, the full IDs
- Draft saved: `<actual draftSaved>`
- Publication status: `<actual publicationStatus>`
- Evidence: the target Get's complete `tags` and the complete publish Set
  request, so every preserved tag is visible

Example reply, with the optional fields included:

> The new title is saved as a draft but not live: the site has never been
> published. Error code: `DRAFT_SAVED_NOT_PUBLISHED`. Saved item IDs:
> `<target-item-id>`. Draft saved: `true`. Publication status: `FAILED`.
> Evidence: Get returned `<complete tags array>`; the publish Set sent
> `<complete request body>`. Publishing the whole site is a separate decision.

Without an acknowledgement, report uncertainty instead; a raw error string
alone is not the report. Then stop all
further API/tool calls for this request: no retry, verification Get, API
search, or Publish Site call.

"Publish this SEO title" authorizes a targeted update of an existing published
page, not the site's first publication with every other draft page — also
during autonomous execution, when confirmation is unavailable.

### Retain outcome evidence

For **any Set error**, retain its raw message and HTTP body; serializing an
error object can drop the body. Read the body wherever your tool or client
returns it: the tool result text, or the response-body field of an error or
exception object. If that field holds only the envelope's contents (an
`applicationError` object), read it as `details`. Decode a JSON string, or JSON
after a plain-text prefix, before reading `details.applicationError`; a field
named `data` is not necessarily the decoded HTTP body.

A never-published site's saved-draft error body is:

```json
{"details":{"applicationError":{"code":"DRAFT_SAVED_NOT_PUBLISHED","data":{"draftSaved":true,"publicationStatus":"FAILED","savedItemIds":["<target-item-id>"]}}}}
```

Confirm a saved draft only from `draftSaved: true` and `savedItemIds`
containing the target, never from the request or a generic error, and keep
the decoded fields in tool output. If decoding or acknowledgement fails,
retain the raw error and report an unconfirmed outcome.

For other failures, report the returned acknowledgement, rejection, or
uncertainty. Failure does not prove nothing changed; do not retry a rejected
or uncertain publication. For bulk, apply [Bulk result handling](#bulk-result-handling).

Build the SEO calls from this recipe's request shapes and error handling,
without a method-reference or schema lookup. The homepage procedure permits
one linked, already-authorized site-URL read (context or Query Sites, per
[Missing site URL](#missing-site-url)) when the retained List cannot establish
the public URL. If that read cannot resolve it, ask.
