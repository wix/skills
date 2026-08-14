---
name: "Set Image Alt Text"
description: Where alt text for an image actually lives on Wix, and which API to call depending on where the image is used. Covers the Media Manager's raw file (no write path exists), and per-placement alt text on Stores products, Blog posts, Rich Content, and Pro Galleries (all writable).
---
# RECIPE: Setting Image Alt Text

Learn where to set an image's alt text depending on where the image is placed. Alt text is **not** a single property of the underlying media file — it's stored per-placement, and different placements use different APIs.

---

## There is no way to set alt text on a raw Media Manager file

`media.image.image.altText` shows up in `GetFileDescriptor`/`UpdateFileDescriptor` response schemas, which makes it look settable. **It isn't.** Calling `UpdateFileDescriptor` with `fieldMask` containing `media` returns `200 OK` but silently makes no change — the alt text is never persisted, `updatedDate` doesn't move.

```bash
# This "succeeds" but does nothing:
curl -X PATCH 'https://www.wixapis.com/site-media/v1/files/update-file-descriptor' \
-H 'Authorization: <AUTH>' \
-H 'Content-Type: application/json' \
-d '{
  "file": { "id": "<fileId>", "media": { "image": { "image": { "altText": "..." } } } },
  "fieldMask": "media"
}'
```

Root cause: the proxy only ever forwards `parentFolderId`, `displayName`, `labels`, and `internalTags` downstream for this endpoint — anything else in the `fieldMask` is dropped before the request leaves the service. A `media` field written by an image's alt text has no code path here at all; the only way `altText` gets populated is Wix's own AI image annotation at import time, which you cannot trigger or override via this API.

**Don't retry this with different `fieldMask` shapes** (array, `{paths: [...]}`, etc.) hoping one will stick — none will, because the field isn't wired downstream regardless of how the mask is encoded.

## Where alt text actually IS writable

Alt text is a property of the *placement* — the specific instance of the image used somewhere — not of the Media Manager file itself. Set it via whichever placement API actually applies:

| Placement | Field | API |
|---|---|---|
| Stores product image (Catalog V3) | `product.media.itemsInfo.items[].altText` | [Create Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/create-product) / [Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product) |
| Blog post cover image | `heroImage.altText` | [Create Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/create-draft-post) / Update Draft Post |
| Image inside rich content (blog body, product description, etc.) | the image/gallery node's `altText` | See [Ricos Rich Content recipe](../rich-content/author-ricos-rich-content.md) |
| Pro Gallery item | `imageInfo.altText` | [Update Gallery Item](https://dev.wix.com/docs/api-reference/assets/pro-gallery/update-gallery-item) |

If the image is placed directly in the Wix Editor as a page Image component (not through one of the business solutions above), there is currently **no API** (REST, SDK, or Velo `$w`) to set its alt text — the Editor SDK's Image element only exposes `src`. That has to be done manually in the Editor's Image Settings panel.

## Practical flow

1. Ask (or infer from context) where the image is actually used — a store product, a blog post, a gallery, or a raw page placement.
2. If it's one of the business-solution placements above, read that resource first (`GET`/`Get Draft Post`/etc.), set `altText` in the relevant sub-object, and write back the full object per that API's usual partial-update rules.
3. If it's a page Image component with no covering business API, tell the user this has to be set manually in the Editor — don't attempt `UpdateFileDescriptor`, it will silently no-op.
