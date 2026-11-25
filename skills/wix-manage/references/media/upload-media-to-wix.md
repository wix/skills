---
name: "Upload Media to Wix"
description: Uploads images and files to the Wix Media Manager. Covers importing from an external URL, uploading a file that is not at a URL (such as a file the user attached, including one that arrives as base64 text), checking file status, and using the returned wixstatic.com URL in other APIs.
---
# RECIPE: Upload Media to Wix Media Manager

Learn how to upload images and files to a Wix site's Media Manager using the REST API.

---

## Overview

The Wix Media Manager stores all media files for a site. When you need to use images or files in other Wix APIs, you should first upload them to the Media Manager to get a reliable wixstatic.com URL.

**Key Points:**
- Uploaded files are permanently stored on Wix servers
- You get back a `url` (wixstatic.com) that works reliably in other APIs
- External URLs can fail if the source server blocks requests - Media Manager URLs never fail

---

## Method: Import File from External URL

The simplest way to add media is to import it from an external URL. Wix will download and store the file.

### API Endpoint

```
POST https://www.wixapis.com/site-media/v1/files/import
```

### Request Example

```bash
curl -X POST 'https://www.wixapis.com/site-media/v1/files/import' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
    "url": "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400",
    "mimeType": "image/jpeg",
    "displayName": "My Image"
}'
```

### Request Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | The external URL of the file to import |
| `mimeType` | Recommended | MIME type (e.g., `image/jpeg`, `image/png`). If omitted, Wix tries to detect it |
| `displayName` | No | Display name in Media Manager. Include extension (e.g., `My Image.jpg`) |
| `parentFolderId` | No | Folder ID to store the file. Defaults to `media-root` |

### Response Example

```json
{
    "file": {
        "id": "e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "displayName": "My Image.jpg",
        "url": "https://static.wixstatic.com/media/e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "parentFolderId": "media-root",
        "mediaType": "IMAGE",
        "operationStatus": "PENDING",
        "sizeInBytes": "31911"
    }
}
```

### Key Response Fields

| Field | Description |
|-------|-------------|
| `id` | Media ID |
| `url` | **The wixstatic.com URL - use this in other APIs** |
| `operationStatus` | `PENDING` → `READY` when processed, or `FAILED` if import failed |

> **Can I Use the URL Immediately?**
>
> **In most cases, yes.** The returned `wixstatic.com` URL typically works immediately for basic use cases like adding to products or blog posts.
>
> **Wait for READY when:**
> - You need image dimensions or metadata
> - You're using image transformations (resize, crop)
> - You want guaranteed consistency for critical operations
>
> **Practical approach:** Try using the URL immediately. If it fails, poll until `operationStatus: "READY"`.

---

## Checking File Status

After importing, the file goes through async processing. For guaranteed consistency, verify `operationStatus: "READY"` before using the file.

### Get File by ID (Recommended)

Use this endpoint to check the status of a specific file:

```bash
curl -X GET 'https://www.wixapis.com/site-media/v1/files/get-file-by-id?fileId={fileId}' \
-H 'Authorization: <AUTH>'
```

**Example:**

```bash
curl -X GET 'https://www.wixapis.com/site-media/v1/files/get-file-by-id?fileId=e6a89e_9d32c0dbae954582bce7b2bf35981ca6~mv2.jpg' \
-H 'Authorization: <AUTH>'
```

### List Recent Files (Alternative)

If you need to find files without knowing the ID:

```bash
curl -X GET 'https://www.wixapis.com/site-media/v1/files?parentFolderId=media-root&mediaTypes=IMAGE&sort.fieldName=updatedDate&sort.order=DESC&paging.limit=5' \
-H 'Authorization: <AUTH>'
```

### Status Values

| Status | Meaning |
|--------|---------|
| `PENDING` | Still processing - wait before using |
| `READY` | File is ready to use |
| `FAILED` | Import failed |

### Response When Ready

```json
{
    "files": [{
        "id": "e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "url": "https://static.wixstatic.com/media/e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "operationStatus": "READY",
        "media": {
            "image": {
                "image": {
                    "height": 600,
                    "width": 400
                }
            }
        },
        "labels": ["cupcakes", "pastry", "dessert"]
    }]
}
```

> **Note:** Wix automatically generates labels (tags) for images using AI.

---

## Alternative: Upload a File That Is Not at a URL

When the file is not at a URL (a file on a device, or a file the user attached), upload the file itself in two steps.

### Step 1: Generate Upload URL

```bash
curl -X POST 'https://www.wixapis.com/site-media/v1/files/generate-upload-url' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
    "mimeType": "image/jpeg",
    "fileName": "my-photo.jpg"
}'
```

The response holds the `uploadUrl`.

### Step 2: Upload to the Generated URL

Send the file's raw bytes as the body, with its MIME type and its name:

```bash
curl -X PUT '<UPLOAD_URL_FROM_RESPONSE>?filename=my-photo.jpg' \
-H 'Content-Type: image/jpeg' \
--data-binary @my-photo.jpg
```

The response holds the stored `file`, in the same shape as the import response: use its `url`.

> **Note:** For files larger than 10MB, use the Resumable Upload URL API instead.

### When the File Is Base64 Text

A file often reaches your code as base64 text and not as bytes: an attached file handed over as `{ path, content, encoding: "base64" }`, or a `data:image/png;base64,...` value the user pasted. That text is not the file. Sent as the body in Step 2, it is stored as a text document, and the upload still answers 200. The Import File API does not take a `data:` URL either.

Decode the text to bytes, then run the two steps. In an environment that runs one script over several Wix API requests (`wix.request` stands for an authenticated Wix API request there), it is one call:

```javascript
async function() {
  // The file's name, its MIME type, and its base64 text (for a data: URL, the part after "base64,").
  const fileName = "pink-dress.jpg";
  const mimeType = "image/jpeg";
  const base64 = "<BASE64_TEXT>";

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  const { data: { uploadUrl } } = await wix.request({
    method: "POST",
    url: "https://www.wixapis.com/site-media/v1/files/generate-upload-url",
    body: { mimeType, fileName }
  });

  const { data: { file } } = await wix.request({
    method: "PUT",
    url: uploadUrl + "?filename=" + encodeURIComponent(fileName),
    headers: { "Content-Type": mimeType },
    body: bytes // the decoded bytes, never the base64 text
  });

  return { id: file.id, url: file.url, mediaType: file.mediaType, operationStatus: file.operationStatus };
}
```

**Check what was stored before you use it.** An image comes back with `mediaType: "IMAGE"` and a `static.wixstatic.com/media/...` URL. A URL that ends in `.txt`, or a `mediaType` that is not the kind of file you sent, means the text was uploaded and not the file: do not use that URL and do not report the upload as done. Decode and upload again.

---

## Common Issues

### Issue 1: Import Fails (operationStatus: FAILED)

**Problem:** The file shows `operationStatus: "FAILED"` after import.

**Causes:**
- Source server blocks external requests (e.g., Wikipedia, some CDNs)
- Source server requires authentication
- Invalid URL or file not found
- File type not supported

**Solution:** Use image sources that allow hotlinking:
- Unsplash (`images.unsplash.com`)
- Pexels (`images.pexels.com`)
- Your own hosted images
- Public cloud storage (S3, GCS with public access)

### Issue 2: File Stuck in PENDING

**Problem:** File stays in `PENDING` status for a long time.

**Solution:**
- Large files take longer to process
- Check back after a few seconds
- If still pending after 30+ seconds, the import may have silently failed

---

## Summary

| Step | Action | Result |
|------|--------|--------|
| 1 | Call Import File API with external URL | Get file `id` and `url` with status `PENDING` |
| 2 | Poll List Files API | Wait for `operationStatus: "READY"` |
| 3 | Use in other APIs | Use the `url` field (wixstatic.com URL) |

When the file is not at a URL, step 1 is the two-step upload in [Upload a File That Is Not at a URL](#alternative-upload-a-file-that-is-not-at-a-url). If the file is base64 text, decode it to bytes first.
