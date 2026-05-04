---
name: "Upload Media to Wix"
description: "Uploads images and files to the Wix Media Manager. Covers two methods: (1) importing from external URLs using the Import File API, and (2) uploading from a local device using the Generate Upload URL API. Also covers checking file status and using the returned wixstatic.com URL in other APIs."
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

## Three Upload Methods

| Method | When to use |
|--------|-------------|
| **Import from URL** (below) | You have a publicly accessible `https://` URL |
| **Import from chat-uploaded file** (below) | User uploaded a file directly to the chat — use the file's `download_url` |
| **Upload from local device** (see [Alternative section](#alternative-upload-from-local-device)) | You have a file on disk and can provide it as a binary stream |

### Chat-Uploaded Files

> **IMPORTANT — API capability clarification:** The Wix Media API fully supports uploading from local file binaries via the Generate Upload URL endpoint. Never say "Wix's Media API cannot upload from a local file path" — that is false. The correct statement, when applicable, is: "my current environment does not support code execution, so I cannot perform a binary upload." The limitation is always in the runtime, never in the API.

When a user uploads a file directly to the chat, check what your platform gives you:

**Case A — Platform provides a `download_url`**

> **Always check for a `download_url` first — before anything else.** Even if the file appears as a local path (e.g. `/mnt/data/...`), inspect the file's full metadata object. Many platforms expose a `download_url` alongside the local path. If one exists, use it here. Do not skip this check and do not proceed to Case B without confirming no `download_url` is present.
>
> **A `/mnt/data/...` path is NOT a URL.** Never pass it to the Import File API — the Import API only accepts externally accessible `https://` URLs. If you only have a local path and no `download_url`, go to Case B.

Pass it directly to the Import File API — it works the same as any external URL:

```json
{
    "url": "<image.download_url>",
    "mimeType": "image/jpeg",
    "displayName": "uploaded-image.jpg"
}
```

**Case B — No `download_url` found**

> **Uploading a local file is a two-step process:**
> - **Step 1** — Call `generate-upload-url` via the Wix MCP
> - **Step 2** — PUT the file binary using your **Bash tool** (run `curl`) or Python interpreter
>
> You have a Bash tool. Use it. A PUT upload is a single `curl` command — it is not a "streaming" operation that requires special capabilities. Saying "I can't stream the file from here" is incorrect and forbidden.

**FORBIDDEN behaviors — never do these:**
- Do NOT generate the upload URL and then stop
- Do NOT show the user a `curl` command and ask them to run it
- Do NOT say "I can't complete the upload from here" or "this requires streaming"
- Do NOT claim a lack of an "upload tool" — `curl` via the Bash tool is the upload tool

**Step 1:** Generate an upload URL:

```bash
curl -X POST 'https://www.wixapis.com/site-media/v1/files/generate-upload-url' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
    "mimeType": "image/jpeg",
    "fileName": "my-photo.jpg"
}'
```

Response:
```json
{ "uploadUrl": "https://upload.wixmp.com/..." }
```

> **After receiving the `uploadUrl`, immediately execute Step 2 — do not pause, do not report back, do not show the URL to the user.** The URL is short-lived. Execute Step 2 now, in the same flow.

**Step 2:** Run the PUT upload using the **Bash tool** — do NOT describe it, do NOT give it to the user to run, just execute it yourself now:

```bash
curl -X PUT '<uploadUrl from Step 1>' \
  -H 'Content-Type: image/jpeg' \
  --data-binary @"/path/to/the/file"
```

If you don't have a Bash tool, use Python:
```python
import requests

with open('/path/to/the/file', 'rb') as f:
    response = requests.put(
        '<uploadUrl from Step 1>',
        headers={'Content-Type': 'image/jpeg'},
        data=f
    )
print(response.status_code, response.text)
```

**Step 3:** Find the uploaded file (poll until `operationStatus: "READY"`):

```bash
curl -X GET 'https://www.wixapis.com/site-media/v1/files?mediaTypes=IMAGE&sort.fieldName=updatedDate&sort.order=DESC&paging.limit=1' \
-H 'Authorization: <AUTH>'
```

Use `files[0].url` as the permanent wixstatic.com URL.

> **Only ask the user to do the upload manually** if you have confirmed ALL of the following: (1) the file has no `download_url`, AND (2) your Bash tool call actually failed (not just returned a non-2xx — actually failed to execute), AND (3) you have no Python interpreter. Rationale: you have a Bash tool, so this condition almost never applies.

---

## Determining Upload Success

After any upload attempt, use the API response — not your own assessment of the transfer — as the source of truth.

### After a URL import or binary PUT

If the response includes a file object with `id`, `displayName`, `url`, and `operationStatus` → **report success immediately.** Include the `displayName`, file ID, wixstatic.com URL, and status.

### If the response body is missing or ambiguous

Do NOT claim failure. Verify by querying recent Media Manager files:

```bash
curl -X GET 'https://www.wixapis.com/site-media/v1/files?parentFolderId=media-root&mediaTypes=IMAGE&sort.fieldName=updatedDate&sort.order=DESC&paging.limit=10' \
-H 'Authorization: <AUTH>'
```

If the expected file appears (matched by `displayName`, timestamp, or URL) → say **"The file appears to have uploaded successfully"** and include the URL.

### Status rules

| Status | Meaning | What to say |
|--------|---------|-------------|
| `READY` | Fully processed | "Upload succeeded" |
| `PENDING` | Accepted, still processing | "Upload accepted; Wix is still processing it" — do NOT say failed |
| `FAILED` | Import rejected by Wix | "Upload failed" — retry with a different source URL |

**Only say "not uploaded" when:**
- The PUT or import request returned a clear non-2xx error, OR
- Media Manager verification shows no matching recent file, OR
- `operationStatus` is explicitly `FAILED`

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
    "displayName": "My Image.jpg"
}'
```

### Request Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | The external URL of the file to import |
| `mimeType` | Recommended | MIME type (e.g., `image/jpeg`, `image/png`). If omitted, Wix tries to detect it |
| `displayName` | No | Display name in Media Manager. Include extension (e.g., `"My Image.jpg"`) |
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

### Get File by ID — Response When Ready

```json
{
    "file": {
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
    }
}
```

> **Note:** Wix automatically generates labels (tags) for images using AI.

### List Recent Files — Response When Ready

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

---

## Alternative: Upload from Local Device

If you need to upload files from a local device (not from a URL), use the two-step upload process:

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

**Step 1 Response** — only `uploadUrl` is returned, no file ID or wixstatic URL yet:

```json
{
    "uploadUrl": "https://upload.wixmp.com/..."
}
```

### Step 2: Upload the File to the Generated URL

PUT the binary directly to `uploadUrl` from Step 1:

```bash
curl -X PUT '<uploadUrl from Step 1 response>' \
-H 'Content-Type: image/jpeg' \
--data-binary @my-photo.jpg
```

> **Note:** For files larger than 10MB, use the Resumable Upload URL API instead.

### Step 3: Get the wixstatic.com URL

Since Step 1 returns no file ID, find the file by listing recent uploads (sorted by date descending) and poll until `operationStatus: "READY"`:

```bash
curl -X GET 'https://www.wixapis.com/site-media/v1/files?mediaTypes=IMAGE&sort.fieldName=updatedDate&sort.order=DESC&paging.limit=1' \
-H 'Authorization: <AUTH>'
```

The `files[0].url` is the permanent wixstatic.com URL to use in other APIs.

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
| 2 | Poll Get File by ID API | Wait for `operationStatus: "READY"` |
| 3 | Use in other APIs | Use the `url` field (wixstatic.com URL) |
