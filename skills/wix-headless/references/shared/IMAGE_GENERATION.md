# Recipe: AI Image Generation + Wix Media Import

Generate images using **Wix AI (Runware)** via the `wixapis.com` REST proxy, then import them into Wix Media. This is a **pure utility** — it generates an image and returns the result. The calling skill owns prompt construction and entity attachment.

Image generation authenticates with the same CLI-minted site-scoped token used for every other Wix REST call in this skill (see `AUTHENTICATION.md`) — no separate API keys, no MCP, no sandbox escape hatches.

## Step 1: Generate Image via Wix AI

Call the Runware proxy through `curl`. The body is an **array of tasks** — one request can generate N images by adding more task objects.

```
REST: POST https://www.wixapis.com/runwareschemaless/v1/request
body: [
  {
    "taskType": "imageInference",
    "taskUUID": "<unique-uuid-per-task>",
    "outputType": "URL",
    "outputFormat": "PNG",
    "positivePrompt": "<PROMPT>",
    "height": 1024,
    "width": 1024,
    "model": "google:4@2",
    "numberResults": 1
  }
]
```

Send `body` as a real JSON array (not a stringified blob). Auth uses the CLI-minted site-scoped token and the standard headers — see `<SKILL_ROOT>/references/shared/AUTHENTICATION.md`.

Extract `data[0].imageURL` from the response. This is a short-lived URL — **import to Wix Media immediately** in the same task queue.

### Required Fields

| Field | Value | Notes |
|-------|-------|-------|
| `taskType` | `"imageInference"` | Always this value |
| `taskUUID` | valid **UUIDv4** | Runware validates the v4 format strictly — human-readable slugs like `product-maestro-001` return `400 invalidTaskUUID`. Generate via `uuidgen` (macOS/Linux) or `crypto.randomUUID()`. Example: `550e8400-e29b-41d4-a716-446655440000`. One unique UUID per task; reusing in the same request errors. |
| `outputType` | `"URL"` | Return a URL (not base64) |
| `outputFormat` | `"PNG"` or `"JPG"` | PNG for transparency-friendly art, JPG for photography |
| `positivePrompt` | brand-contextual prompt | See "Prompt Guidelines" below |
| `height`, `width` | one of the allowed pairs below | Free-form sizes return 400 |
| `model` | `"google:4@2"` (default) | Nano Banana Pro 2. Alternatives: `bfl:5@1`, `runware:400@1` — only switch if the default fails repeatedly |
| `numberResults` | `1` | Increase if you need multiple variants per prompt |

### Allowed Dimensions (safe defaults)

Runware enforces a fixed set per model. Start with these:

| Aspect | Size | Use for |
|--------|------|---------|
| Square | `1024 × 1024` | Product photos, decorative squares, Instagram-style hero |
| 16:9 | `1376 × 768` | Page heroes, wide banners |
| 4:3 | `1200 × 896` | About-page visuals, editorial imagery |

If a 400 response lists supported dimensions, use one from that list — do not retry with the same invalid size.

### Forbidden Parameters (for `google:4@2`)

Do NOT send `steps` or `CFGScale` — both are rejected with `unsupportedParameter` and cause a 400. These fields are valid for other Runware models but must be omitted for `google:4@2`.

## Preferred: run the whole phase through `generate-images.mjs`

Generation + Wix Media import is **embarrassingly parallel** (N independent `generate → import` chains, no cross-image dependency) and **recipe-free** (no entity write-shapes), so it is best run by a deterministic script rather than by hand. `<SKILL_ROOT>/scripts/generate-images.mjs` does exactly this: it fires every image as a **concurrent single-task request in one process** (`Promise.all`), then imports each result to Wix Media — all in parallel — and returns a `key → {url, fileId}` map. Because each task is its **own** request (not N tasks in one body), it sidesteps the `google:4@2` N≥3-in-one-request 504 entirely, and because the parallelism lives in code it cannot degrade into the sequential-turns anti-pattern below.

```bash
echo '{
  "siteId": "<siteId>",
  "model": "google:4@2",
  "images": [
    {"key": "hero",  "positivePrompt": "<prompt>", "width": 1376, "height": 768},
    {"key": "about", "positivePrompt": "<prompt>", "width": 1200, "height": 896}
  ]
}' | WIX_TOKEN="$TOKEN" node <SKILL_ROOT>/scripts/generate-images.mjs
```

`key` is a **slot name** for Phase 1 (`hero`, `about`) or an **entityId** for Phase 2. The returned `slots` map (key→url) pipes straight into `write-decorative-json.mjs` (Phase 1); the `map` (key→{url,fileId}) feeds the entity PATCH/PUT/publish recipe (Phase 2). Pass the **already-minted** site token via `WIX_TOKEN` (mint-once — `AUTHENTICATION.md`); the script mints its own only as a fallback. Per-image failures are isolated (`status: "partial"`), and `x-wix-request-id` is captured per call into `results[]` for trace analysis.

The manual `curl` shapes below remain the **reference for the request bodies** the script builds, and the **fallback** when the script can't be used. The "one concurrent batch" rule still applies if you ever hand-drive a phase.

## Required (manual fallback): minimize round-trips per image phase

The image agent's `image-phase-1-decorative` and `image-phase-2-entity` scopes each generate multiple images. **Do not emit N one-task calls in sequential turns** — sequential dispatch across many turns adds ~30–40 s of inter-message overhead. The correct shape depends on the model:

### For `bfl:5@1`, `runware:400@1`, and other models: ONE batched call

```
REST: POST https://www.wixapis.com/runwareschemaless/v1/request
body: [
  { "taskType": "imageInference", "taskUUID": "<uuid-1>", "positivePrompt": "...", ... },
  { "taskType": "imageInference", "taskUUID": "<uuid-2>", "positivePrompt": "...", ... },
  { "taskType": "imageInference", "taskUUID": "<uuid-3>", "positivePrompt": "...", ... }
]
```
One round-trip. Response's `data[]` array contains one result per task, matched by `taskUUID`.

### For `google:4@2` (the default): N parallel 1-task sibling calls

`google:4@2` times out with `504` when a single request bundles N≥3 tasks — Runware's backend serializes work per request and the model is slow enough that large batches exceed the proxy timeout. Instead, emit **N parallel `curl` tool calls as siblings in one concurrent batch**, each carrying one task:

```
Assistant message (single turn, multiple tool calls):
  REST: POST https://www.wixapis.com/runwareschemaless/v1/request
  REST: POST https://www.wixapis.com/runwareschemaless/v1/request
  REST: POST https://www.wixapis.com/runwareschemaless/v1/request
```

All three fire in parallel (runtime dispatches concurrent siblings concurrently). No 504, no sequential wait. The important constraint is *one concurrent batch* — splitting them across turns loses the parallelism: sequential 1-task calls across multiple turns each add inter-message overhead.

### Procedure to enforce batching

Whether you batch one request or fire parallel siblings, **all calls in each stage MUST be in one concurrent batch**. Follow these steps in order:

1. **Write all prompts first.** In your text response, list every image you will generate with its positivePrompt, dimensions, and a UUID. Do not make any tool calls yet.
2. **Compose the generation call(s).** For `bfl:5@1` / `runware:400@1`, one batched call with the full body array; for `google:4@2`, N parallel 1-task sibling calls. Verify the task count matches the entity count.
3. **Generate.** Fire that generation as one concurrent batch.
4. **Parallel imports.** After the generate response arrives, emit all N `POST /site-media/v1/files/import` calls as concurrent sibling calls in one concurrent batch.
5. **Parallel PATCHes.** After all imports resolve, emit all N PATCH calls as concurrent sibling calls in one concurrent batch.

**Three concurrent batches total (one per stage).** If you find yourself making more, stop and check whether you're serializing. See the skill's `references/PLAN.md` § "Batching discipline" for why sibling batching beats sequential dispatch.

## Step 2: Import to Wix Media

This API is Wix-side and model-agnostic — the same shape works for any image source:

```
REST: POST https://www.wixapis.com/site-media/v1/files/import
body: {
  "url": "<imageURL from Runware response>",
  "mimeType": "image/png",
  "displayName": "<descriptive-name>.png"
}
```

## Returns

The Wix Media import response contains a `file` object. The calling skill receives two values:

| Field | Value | Use For |
|-------|-------|---------|
| `file.url` | Full permanent `wixstatic.com` URL | Product media, `<img>` tags, CSS `background-image`, CMS Image fields |
| `file.fileUrl` | File ID (e.g., `9a9cdf_abc123~mv2.png`) | Blog post `media.wixMedia.image.id` field |

The calling skill is responsible for attaching the image to whatever entity it belongs to (product, blog post, page element).

## Prompt Guidelines

Every prompt should incorporate the full brand context available from the discovery and design phases. Never generate generic images.

### Prompt Structure

1. **Subject** — what the image shows
2. **Brand aesthetic** — the design direction from brand discovery
3. **Color guidance** — reference the brand palette (e.g., "warm cream and forest green tones" not generic colors)
4. **Style/mood** — photography style, lighting, composition
5. **Constraints** — always include "no text, no watermarks"

### Context Sources

| Source | What to Extract |
|--------|----------------|
| Discovery plan | Business type, brand name, industry, target audience |
| Design Step 1 (brand discovery) | Aesthetic direction, mood, personality |
| Design Step 2 (design system) | Color palette hex codes from `global.css` |
| Entity being created | Product name/description, blog post title/topic, page purpose |

### Anti-Patterns (NEVER do these)

- Generic prompts without brand context ("a product photo")
- Ignoring the color palette established in global.css
- Using stock-photo language ("diverse team of professionals")
- Requesting text in images (AI-generated text is garbled)
- Same prompt style across different brand aesthetics

## Error Handling

| Error | Action |
|---|---|
| `unsupportedParameter` (400) | Strip the offending field (most commonly `steps` or `CFGScale`) and retry |
| `unsupportedDimensions` (400) | Retry with one of the allowed defaults (`1024×1024`, `1376×768`, `1200×896`) or a size from the error payload's supported list |
| Model-specific failure (model down, rate limited) | Switch to an alternative model (`bfl:5@1`, `runware:400@1`) and retry once; skip if still failing |
| Credit exhaustion | Stop generating, return `status: "partial"` with `errors: [{code: "CREDITS_EXHAUSTED", ...}]` listing what was completed (see `RETURN_CONTRACT.md`) |
| Generation fails (5xx, timeout) | Skip this image, continue with others |
| Wix Media import fails | Skip this image, entity gets no image |
| All images fail | Proceed without images, return `status: "failed"` with the root cause |

**Never block the main flow on image generation failure.** Products, posts, and pages work without images — users can upload their own via the Wix dashboard later.