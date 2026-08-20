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

## Choose the level

Wix combines tags from several sources, where a more specific source wins.
Match the user's request to the level that owns the change:

| User intent | Level | API |
|---|---|---|
| "Change my site's default social image", site verification tags, site-wide indexing | Site | **Site SEO Tags** |
| "All my product/blog/event pages should be titled like X" — a convention for every item of a page type | Pattern | **SEO Patterns** |
| "Change the title of this page/product/post" — one specific item | Item | **Item SEO Tags** |

All three APIs live under the **SEO** category of the Wix REST API reference.
Read the chosen method's own reference article directly rather than searching
schemas; these are the methods each level has:

| Level | Methods |
|---|---|
| Site | Get Site SEO Tags, Set Site SEO Tags |
| Pattern | Get SEO Pattern, List SEO Patterns, List SEO Pattern Variables, Create SEO Pattern, Set SEO Pattern, Reset SEO Pattern To Default |
| Item | Get Item SEO Tags, List Item SEO Tags, Set Item SEO Tags, Bulk Set Item SEO Tags, Reset Item SEO Tags To Default |

Work at the level that matches the change. Writing the same title onto many
items is the same outcome as one pattern and much harder to undo. If the user's
words fit more than one level, ask one short question before writing. An
explicit request to change a specific tag at a clear level is already
confirmation to make that write.

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

## Read before write — every write replaces in full

1. **Get** the current tags or pattern for the target first.
2. Merge the requested change into the complete current set.
3. **Set** the complete set back, naming only the changed fields in the field
   mask. Sending only the changed tag deletes every other tag the target had.
4. To remove an item's own tags so it inherits again, call **Reset Item SEO
   Tags To Default** (or **Reset SEO Pattern To Default**) — never set an empty
   list to mean "reset".
5. Read the target back and confirm the result before reporting success. Reads
   are strongly consistent.

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

- When reporting what a page will render with, read the item's `resolvedTags`
  and name the source of each tag (site, default pattern, user pattern, host
  page, or the item itself). `hasOverride: false` does not mean built-in
  defaults — the item may inherit from a customized pattern or the site.
- `resolvedTags` excludes tags added by site code or apps at render time, so
  present it as what Wix manages, not a literal copy of the rendered page head.

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
- **Setting tags for `EVENTS_PAGE` items:** not supported yet, although reading
  them is; say so instead of retrying.

Load the current public API reference before constructing requests so field
names, masks, permissions, and error schemas come from the live contract.
