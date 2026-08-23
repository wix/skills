---
name: "Manage a Wix Site's SEO Tags"
description: Read and update the SEO tags of a Wix site at the right level — site-wide tags, page-type patterns, or one item's tags. Discover item IDs and pattern variables instead of inventing them, read before every full-replace write, and report resolved tags with the source each one came from.
---

# Manage a Wix Site's SEO Tags

Use the public **SEO APIs** to read and write the titles, descriptions, social
share tags, canonical links, structured data, and indexing directives of the
authenticated Wix site. The API selects the site from the caller's
authorization context; never ask for or send a site ID.

Writing tags requires the **Manage SEO Settings** permission. Reading tags or
listing pattern variables does not prove that the caller can write.

## The one rule that must never be skipped

**Every write replaces the target's tags in full, so a Get always immediately
precedes a Set.** There is no partial update: sending only the tag the user
asked about deletes every other tag that item, pattern, or site had. So before
any Set, call the matching Get for that exact target, merge the requested change
into the tags it returns, and send the complete set back.

Never write from the user's request alone, and never skip the Get because the
change looks small, because a list call already returned something, or because
the target looks empty. The Set response returns the updated tags and
`resolvedTags`, so report the outcome from that response instead of issuing
another read.

## Choose the level

Wix combines tags from several sources, where a more specific source wins.
Match the user's request to the level that owns the change:

| User intent | Level | API |
|---|---|---|
| "Change my site's default social image", site verification tags, site-wide indexing | Site | **Site SEO Tags** |
| "All my product/blog/event pages should be titled like X" — a convention for every item of a page type | Pattern | **SEO Patterns** |
| "Change the title of this page/product/post" — one specific item | Item | **Item SEO Tags** |

Work at the level that matches the change. Writing the same title onto many
items is the same outcome as one pattern and much harder to undo. If the user's
words fit more than one level, ask one short question before writing. An
explicit request to change a specific tag at a clear level is already
confirmation to make that write.

All three APIs live under the **SEO** category of the Wix REST API reference.
Read the method you need directly from its reference article — do not search
for it. The reference article URLs follow a fixed pattern:

`https://dev.wix.com/docs/api-reference/business-management/seo/{api}/` + method slug

| Level | API slug | Methods (slug) |
|---|---|---|
| Site | `site-seo-tags-v1` | Get Site SEO Tags (`get-site-seo-tags`), Set Site SEO Tags (`set-site-seo-tags`) |
| Pattern | `seo-pattern-v1` | Get SEO Pattern (`get-seo-pattern`), List SEO Patterns (`list-seo-patterns`), List SEO Pattern Variables (`list-seo-pattern-variables`), Create SEO Pattern (`create-seo-pattern`), Set SEO Pattern (`set-seo-pattern`), Reset SEO Pattern To Default (`reset-seo-pattern-to-default`) |
| Item | `item-seo-tags-v1` | Get Item SEO Tags (`get-item-seo-tags`), List Item SEO Tags (`list-item-seo-tags`), Set Item SEO Tags (`set-item-seo-tags`), Bulk Set Item SEO Tags (`bulk-set-item-seo-tags`), Reset Item SEO Tags To Default (`reset-item-seo-tags-to-default`) |

For example, to read Set Item SEO Tags:
`https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/set-item-seo-tags`

`Set` takes a `fieldMask` naming the properties to change (`tags`,
`focusKeywords` for an item; `pattern` for a pattern). Its shape differs by
client and the reference does not spell this out: over REST it is a
comma-separated **string** (`"fieldMask": "tags"`), while the SDK takes an
**array** of strings (`fieldMask: ["tags"]`). Sending an array to REST fails
with `INVALID_FIELD_MASK`. `publish` is a boolean. A tag is
`{type, props, children}`: `title` and `script` carry their text in `children`;
`meta` and `link` carry theirs in `props` (`name`/`content` for a meta tag,
`rel`/`href` for a link). The response returns the updated `tags` plus
`resolvedTags`.

## Discover, never invent

- An item is addressed by an **item type and item ID together**, not by URL.
  Call **List Item SEO Tags** for an item type to discover the IDs on the site,
  or take the item's ID from the public API of its own vertical (for example, a
  product or blog post ID). Never fabricate an item ID.
- Item types exist on a site only when the business solution providing them is
  installed. The authoritative list of supported item types is in the
  `UNSUPPORTED_ITEM_TYPE` error message; do not hardcode one.
- Before writing a pattern, call **List SEO Pattern Variables** for the page
  type and build the pattern only from returned variables. Never invent a
  variable name.
- Dynamic Wix Data pages are addressed by `pageId`; addressing a pattern by
  collection name is not supported.

## The write sequence

Exactly three calls, in this order, with no extra probing:

1. **Get** the current tags or pattern for the target. Required — see the rule
   above.
2. **Set** the complete merged set, naming only the changed fields in the field
   mask.
3. Report from the **Set response**, which returns the updated tags and
   `resolvedTags`. Do not issue a verification read: the write response is the
   confirmation. Read again only to check a static page's published revision
   after `publish: true`, or when the user asks about a target you have not read
   in this session.

To remove an item's own tags so it inherits again, call **Reset Item SEO Tags To
Default** (or **Reset SEO Pattern To Default**) — never set an empty list to
mean "reset".

Tags can currently be written only for the site's primary language: leave
`language` unset on every write. There is no revision checking — the last write
wins and dashboard edits write to the same data, so read immediately before
writing.

**Static pages** keep a draft and a published revision: a write updates the
draft unless `publish` is `true`, and `publish: true` updates only the
published revision. Say clearly which revision the change reached. Item types
that are always live, such as store products, need no publish step.

## Bulk writes

To set tags on many items, call **Bulk Set Item SEO Tags** once, not Set in a
loop. Expected per-item failures (invalid tags, item not found) fail only that
entry and are reported on that entry's `itemMetadata.error`; map results back
to the request with `originalIndex` and retry only the failed entries. Report
partial failures truthfully — never present a partially failed bulk write as a
success.

## Present results

- When reporting what a page will render with, use the `resolvedTags` already
  returned by the last Get or Set — not a fresh call — and name the source of
  each tag (site, default pattern, user pattern, host page, or the item
  itself). Naming the source of each reported tag is required, not optional.
  `hasOverride: false` does not mean built-in defaults — the item may inherit
  from a customized pattern or the site.
- `resolvedTags` excludes tags added by site code or apps at render time, so
  present it as what Wix manages, not a literal copy of the rendered page head.

`resolvedTags` is an array of `{tag, source, inheritedTag}` — the tag itself is
nested under `tag`, not spread onto the entry:

```json
"resolvedTags": [
  { "tag": { "type": "title", "children": "Winter collection | Ceramics studio" },
    "source": "TAG_SOURCE_ITEM",
    "inheritedTag": { "type": "title", "children": "Ceramics studio" } }
]
```

`source` is one of `TAG_SOURCE_SITE`, `TAG_SOURCE_DEFAULT_PATTERN`,
`TAG_SOURCE_USER_PATTERN`, `TAG_SOURCE_HOST_PAGE`, `TAG_SOURCE_ITEM`, or
`TAG_SOURCE_UNSPECIFIED` when it cannot be determined. `inheritedTag` appears
only when this source replaced a value a lower source had set, and holds the
value one level down — not the Wix built-in.

## Recovery rules

- **Permission denied:** stop after the first `403` or `PERMISSION_DENIED`. Do
  not retry with another item, level, request shape, or site. Explain that the
  current Wix identity lacks **Manage SEO Settings** and must be reconnected or
  authorized. Never imply that a successful read means the write ran.
- **`UNSUPPORTED_ITEM_TYPE`:** the error message lists the item types the API
  supports; use it to redirect the request rather than retrying blindly.
- **`ITEM_NOT_FOUND`:** re-discover the item ID; do not guess a new one.
- **Invalid tags:** tags are validated before anything is saved, so nothing
  changed; fix the tag and resend the same complete set.
- **`400` on a request you built from this recipe:** the shape is wrong for that
  method. Read that method's reference article once, correct the request, and
  send it again. Never resend the same shape, and never walk through variations
  hoping one is accepted.
- **Setting tags for `EVENTS_PAGE` items:** not supported yet, although reading
  them is; say so instead of retrying.

This recipe carries everything needed for the common flows: the URL pattern,
field masks, tag shapes, and `resolvedTags` structure. Do not read the
method's reference article or search the API schemas before constructing
requests — build the request from what is above. Read the reference article
only when you hit an error this recipe does not cover, or when the user asks
about a field or behavior not documented here.
