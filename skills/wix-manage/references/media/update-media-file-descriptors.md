---
name: "Update Media Manager File Descriptors (Names, Labels, Alt Text)"
description: Updates existing Media Manager files (display name, labels, folder, internal tags) via UpdateFileDescriptor. Covers the required `fieldMask` parameter's real format (a comma-separated string, not an array or object) and the fact that image `altText` cannot be set through this API today.
---
# RECIPE: Update Media Manager File Descriptors

Learn how to update metadata on files already in a site's Media Manager — for example, bulk-renaming files or relabeling them. This is a separate flow from [uploading media](upload-media-to-wix.md).

---

## API Endpoint

```
PATCH https://www.wixapis.com/site-media/v1/files/update-file-descriptor
```

## What you can actually update

Only these fields are accepted, regardless of what the response schema/docs page shows for the full `FileDescriptor` object:

| Field | Notes |
|-------|-------|
| `displayName` | File name as shown in the Media Manager |
| `parentFolderId` | Moves the file to a different folder |
| `labels` | User/Google-Vision-assigned tags |
| `internalTags` | Internal tagging |

**`media.image.altText` is NOT settable through this API**, even though the docs/schema show it as a plain writable string with no `readOnly` flag. It's an AI-computed annotation populated internally when an image is processed — there is currently no public endpoint to set custom alt text on a Media Manager image or a Wix Stores product image. Don't spend time retrying different request shapes for it; any attempt is rejected (see below) or, on older calls, may silently no-op. If you're asked to fix "missing alt text" accessibility/SEO findings on Media Manager or product images, tell the user this isn't currently possible via API rather than attempting a workaround.

## The `fieldMask` parameter — required, and NOT documented on the method's docs page

The docs page for this method (and its schema) shows **no `fieldMask` parameter at all**. Despite that, every call **requires** it — omitting it returns:

```json
{"message":"Invalid request message","errorCode":-100,"details":{"validationError":{"fieldViolations":[{"field":"fieldMask","description":"must be an array"}]}}}
```

**That error message is misleading — do not pass an array.** `fieldMask` is a `google.protobuf.FieldMask`, whose real wire format here is a **plain comma-separated string of top-level field names**, passed as a top-level request property (a sibling of `file`, not nested inside it):

```bash
curl -X PATCH 'https://www.wixapis.com/site-media/v1/files/update-file-descriptor' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "file": {
    "id": "e6a89e_d918d88028af49328a09469b9f2d3616~mv2.png",
    "displayName": "Front porch with hanging lights"
  },
  "fieldMask": "displayName"
}'
```

To update more than one field in the same call, comma-separate the names: `"fieldMask": "displayName,labels"`.

**Do not** pass `fieldMask` as a JSON array (`["displayName"]`) or as an object (`{"paths": ["displayName"]}`) — both fail with a generic `Failed to parse request message` error. This same string-not-array/object gotcha applies to `fieldMask`/`field_mask` parameters on other Wix REST APIs too — when a method takes a `google.protobuf.FieldMask`, try the plain comma-separated-string form first if the docs don't show a worked example.

## Bulk alt-text / accessibility remediation

If asked to fix missing `alt` attributes across many product/media images (e.g. from a PageSpeed Insights or Lighthouse report): there is currently no API to do this. Say so plainly, rather than looping through `UpdateFileDescriptor` fieldMask variations — none of them will persist an alt text change.
