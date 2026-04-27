---
name: "Upload Media to Wix"
description: Uploads images and files to the Wix Media Manager. Supports two methods - importing from an external public URL, or uploading binary content from a local file via a two-step generate-upload-url + PUT flow. Covers both methods, checking file status, and using the returned wixstatic.com URL in other APIs.
---
# RECIPE: Upload Media to Wix Media Manager

Learn how to upload images and files to a Wix site's Media Manager using the REST API.

---

## Overview

The Wix Media Manager stores all media files for a site. When you need to use images or files in other Wix APIs, you should first upload them to the Media Manager to get a reliable wixstatic.com URL.

**There are two ways to upload media:**
- **Upload a local file** — generate a signed upload URL, then PUT the file bytes directly. See [Method: Upload from Local File](#method-upload-from-local-file) below.
- **Import from an external URL** — provide a public HTTPS URL and Wix fetches the file. See [Alternative: Import File from External URL](#alternative-import-file-from-external-url) below.

---

## Which method should I use?

The right method depends on **two separate capabilities**: whether you can read the file, and whether you can execute shell commands / make binary HTTP requests.

| Your situation | Method |
|---|---|
| You can execute shell commands (e.g. Claude Code, ChatGPT with computer use) | [Upload from local file](#method-upload-from-local-file) — run the curl steps yourself |
| You have no filesystem and no shell access (e.g. browser-only, sandboxed environment) | [Import from external URL](#alternative-import-file-from-external-url) — ask the user for a public URL |
| User attached a file to the conversation, but you cannot execute shell commands | [Generate the upload URL via API, then hand the user ready-to-run curl commands](#when-user-attaches-a-file-but-you-cannot-execute-shell-commands) |

> **Important:** Receiving a file as an attachment is NOT the same as being able to upload it to Wix. The two-step local upload requires executing a binary HTTP PUT (`curl --data-binary`). If you cannot run shell commands, you cannot complete that step automatically — even if you can see the file content.

---

## Method: Upload from Local File

**Use this when you can execute shell commands on the machine where the file lives.**

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

### Step 2: PUT the File to the Generated URL

```bash
curl -X PUT '<UPLOAD_URL_FROM_RESPONSE>' \
-H 'Content-Type: image/jpeg' \
--data-binary @/path/to/my-photo.jpg
```

> **Note:** For files larger than 10MB, use the Resumable Upload URL API instead.

---

## When User Attaches a File But You Cannot Execute Shell Commands

If the user attached a file to the conversation but you have no way to run `curl` or make binary HTTP requests yourself:

1. **Call the generate-upload-url API** to get a signed upload URL (you can do this via your available API tools).
2. **Give the user ready-to-run curl commands** with the generated URL filled in, so they can complete the upload from their terminal.

Example handoff message to the user:

> I've generated a signed upload URL for your file. Run this command in your terminal to complete the upload:
>
> ```bash
> curl -X PUT '<GENERATED_UPLOAD_URL>' \
> -H 'Content-Type: image/jpeg' \
> --data-binary @/path/to/your-file.jpg
> ```
>
> Once done, let me know and I'll continue from there.

Do **not** tell the user "I can't upload local files" and ask for a public URL — you can still do half the work (generate the signed URL) and let the user do the binary transfer step.

---

## Alternative: Import File from External URL

**Use this when neither you nor the user can run shell commands**, or when the user already has the file at a public URL. Wix will download and store the file directly.

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

| Scenario | Method | Who does the PUT? |
|---|---|---|
| You have shell access | Generate upload URL → PUT file | You (AI) |
| User attached file, no shell access | Generate upload URL → hand curl command to user | User |
| No file, no shell access | Import from public URL | Wix (fetches from URL) |