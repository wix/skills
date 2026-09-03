---
name: "Generate an Image with AI"
description: Generates an image from a text prompt with the Wix AI APIs (Runware). Returns a short-lived URL that must be imported to be kept — importing is Upload Media to Wix's job, and this recipe hands off to it. Covers choosing a model and its cost/latency/content-filter trade-off, the accepted output sizes, per-model batching limits, the AI credit each call spends, and why a content refusal arrives as a success response with no image.
---
# RECIPE: Generate an Image with AI

For an image the user does not have. An image they supplied — an attachment or a public URL — is uploaded instead: [Upload Media to Wix](upload-media-to-wix.md).

**API reference:** [About the Wix AI APIs](https://dev.wix.com/docs/api-reference/articles/ai-tools/ai-apis/about-the-wix-ai-apis), *Generating images* — endpoint, auth, and the full model table. Developer Preview, so confirm the contract there.

---

## AI credits

Each call spends roughly **one AI credit**, billed to the site owner, or to the Wix user who installed the calling app. `numberResults: n` spends n. Importing is free.

Generate one image per entity that needs one, and say how many a run will generate before starting it. Regenerate only when the user asks.

---

## Step 1: Generate

```bash
curl -X POST 'https://www.wixapis.com/runwareschemaless/v1/request' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-H 'wix-site-id: <METASITE_ID>' \
-d '[{
    "taskType": "imageInference",
    "taskUUID": "3f8c1e42-9b7a-4d16-8a5e-2c0f7b9d4e11",
    "outputType": "URL",
    "outputFormat": "PNG",
    "positivePrompt": "a ceramic pour-over coffee dripper on a walnut counter, morning light",
    "width": 1024,
    "height": 1024,
    "model": "runware:400@1",
    "numberResults": 1
}]'
```

| Parameter | Value |
|---|---|
| `taskUUID` | A real UUIDv4. Anything else returns `400 invalidTaskUUID` |
| `width` / `height` | `1024×1024` (square — products, services, menu items), `1376×768` (16:9 hero), `1200×896` (4:3 editorial). Free-form sizes return 400 |
| `model` | See below |
| `numberResults` | `1` |

Omit `steps` and `CFGScale`: Runware accepts them, other models return `400 unsupportedParameter`.

### Models

| `model` | Latency | Content filter |
|---|---|---|
| `runware:400@1` | ~5s | Loosest — the default |
| `google:4@2` | ~25s | Medium, best fidelity |
| `bfl:5@1` | — | Strictest; refuses trademark-ish prompts |

Any Runware-supported model works — the reference's *Suggested models* table has the current AIR IDs.

### Read the response

```json
{ "data": [ { "imageURL": "https://im.runware.ai/image/ws/2/ii/<id>.png" } ] }
```

**A refusal is a success response with no `imageURL`** — test for the field, not the status. On a refusal, reword the prompt or switch model, and report the image as not created.

---

## Step 2: Import

`imageURL` expires, so import it as it lands. [Upload Media to Wix](upload-media-to-wix.md) owns that endpoint and its `PENDING` / `READY` rules; pass the `imageURL` as `url` and `image/png` as `mimeType`.

The result is the returned `file.id` / `file.url` — permanent, and what an entity field takes.

---

## Batches

`runware:400@1` and `bfl:5@1` take several tasks in one body. `google:4@2` returns 504 at three or more, so fire parallel single-task requests for it.

Failure is per image: attach the ones that succeeded, create the rest of the entities text-only, and name which entities have no image and why. A failed image stays missing rather than being swapped for another.

---

For JavaScript callers there is an SDK path — `generateImage()` from the Vercel AI SDK with `runware.image(...)` from `@wix/ai`: [Set up the Wix AI SDK](https://dev.wix.com/docs/api-reference/articles/ai-tools/ai-apis/set-up-the-wix-ai-sdk).
