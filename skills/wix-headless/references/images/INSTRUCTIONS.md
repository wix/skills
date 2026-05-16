---
name: images-agent
description: "Generates images for the site. Two scopes: image-phase-1-decorative (hero/about/background art, no dependencies, dispatched in Step 3) and image-phase-2-entity (product/blog/CMS item images, needs Phase 1 Seed entity IDs, dispatched in Step 4.5 alongside Phase 3 Components)."
---

# Images Agent — Scope-Based Image Generation

Generates site images in two scopes dispatched separately by the parent skill. Uses Wix AI (Runware) for generation and Wix Media for hosting — all via the admin REST API authenticated with a site-scoped admin token from `@wix/cli`, no additional user credentials required.

**Nothing else blocks on image generation.** Phases 1–4 and the core pipeline all proceed independently. Products, posts, and pages work without images. Each image phase enriches them when it finishes.

## Scope Routing

Your prompt includes `Scope: <name>`. Map it to an image phase:

| Scope | When dispatched | Depends on | Output |
|---|---|---|---|
| `image-phase-1-decorative` | Step 3 (background) | Brand context only | Decorative images for hero / about / backgrounds; written to `.wix/image-urls.md` |
| `image-phase-2-entity` | Step 4.5 (background, alongside Phase 3 Components) | Phase 1 Seed return data (entity IDs in prompt) | Entity images attached to products / blog posts / CMS items via admin-REST PATCH |

If your prompt is missing a `Scope:` line, stop and ask the parent — do not guess.

## Self-Loading

1. Read `../shared/IMAGE_GENERATION.md` — Wix AI image generation + Wix Media import recipe (including the **required** batched-call pattern)
2. Read `../shared/REST_CONVENTIONS.md` — admin REST auth pattern (`Authorization: Bearer $(npx @wix/cli token --site $SITE_ID)`) and call shape
3. **Prefer the inlined recipe below and `IMAGE_GENERATION.md` over external docs.** When a PATCH or API call fails:
   1. **FIRST re-read your own recipe** in this file (INSTRUCTIONS.md § for that entity type) — it likely covers the error.
   2. If the recipe covers it, follow the recipe. Do NOT look up external docs for errors your recipe already handles.
   3. **ONLY** if you've re-read the recipe AND the error is genuinely not covered, fall back to `SearchWixRESTDocumentation` / `ReadFullDocsArticle`.
   
   Known errors already covered by this recipe (do not look up externally):
   - **428** from product PATCH → missing `options`/`variantsInfo` → see § "Products" step 1
   - **400** `"Expected an object"` from product PATCH → missing `revision` → see § "Products" step 4
   - **400** `unsupportedParameter` → strip `steps`/`CFGScale` → see § "Error Handling"
   - **400** `unsupportedDimensions` → see § "Error Handling"
   - **400** `invalidTaskUUID` → `taskUUID` must be valid UUIDv4 → see § "Quick Reference"

## Quick Reference: Generation Call Shape

Fetch a site-scoped admin token once at the start of your run and reuse it for every admin REST call:

```bash
TOKEN=$(npx @wix/cli token --site $SITE_ID)
```

**All generation calls for an image phase MUST be in one concurrent batch.** The exact shape depends on the model — see `../shared/IMAGE_GENERATION.md` § "Required: minimize round-trips" for the rule. In short:

- **`google:4@2` (the default):** N concurrent 1-task `curl` calls as siblings in one batch. (Batched N≥3 times out at 504 on this model.)
- **`bfl:5@1`, `runware:400@1`:** one batched `curl` call with N tasks in the body array.

Example task body (same for both patterns — only the distribution across tool calls changes):

```bash
curl -fsSL -X POST 'https://www.wixapis.com/runwareschemaless/v1/request' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '[
    {
      "taskType": "imageInference",
      "taskUUID": "550e8400-e29b-41d4-a716-446655440000",
      "outputType": "URL",
      "outputFormat": "PNG",
      "positivePrompt": "<prompt-for-image>",
      "height": 1024,
      "width": 1024,
      "model": "google:4@2",
      "numberResults": 1
    }
  ]'
```

Extract `data[i].imageURL` from each response. Import each to Wix Media immediately. **Do NOT send `steps` or `CFGScale`** with `google:4@2` — both cause a 400 error. `taskUUID` must be a valid UUIDv4 (`uuidgen` or `crypto.randomUUID()`) — Runware rejects human-readable slugs with `400 invalidTaskUUID`.

### Mandatory pre-call procedure — construct ALL tasks FIRST, then dispatch in ONE message

Image Phase 2 serializes into 6+ sequential calls across multiple turns when you compose and send tasks one-at-a-time. The fix is to build the full task set first and dispatch them as a single concurrent batch.

**Required procedure (do this, exactly, every time):**

1. **Plan all image prompts in your text response FIRST.** Write out every entity you need to generate for, with its prompt text, dimensions, and UUIDv4. Use a numbered list or table. Do not start any tool calls yet.

2. **Compose the full task set** as a fenced JSON block in your text. Verify the count matches the entity count.

3. **Dispatch in one concurrent batch.** For `google:4@2`: N concurrent sibling `curl` calls, each with one task. For other models: one call with all N tasks in `-d`.

4. **After generation returns:** make all N import calls as **sibling calls in one concurrent batch** (not sequential messages). Same for PATCH calls — all N as siblings in one message.

That gives you exactly 3 concurrent batches for the whole image phase: 1 generate dispatch, 1 batch of imports, 1 batch of PATCHes.

Concurrent siblings are safe across all three stages (gen, import, PATCH). Wix Media imports do not rate-limit at typical scales (≤10/run); product PATCHes against distinct entity IDs do not produce revision conflicts because each entity has independent revision tracking. The 3-message recipe (one batch per stage) typically completes in ~190 s end-to-end vs ~480 s for the same 4 entities done sequentially — ~2.5× speedup.

**Self-check before the generate dispatch:**
- [ ] You have planned all N tasks with UUIDv4 `taskUUID` values
- [ ] All generate calls will be in one concurrent batch (siblings for `google:4@2`, or one block with N tasks for other models)
- [ ] You wrote out the full plan in your text before making any tool call

### Expected call budget

Image Phase 2 for N products + M CMS items: 1 product query + 1 batched generate + (N+M) imports + (N+M) PATCHes ≈ 2(N+M) + 2 calls. For 4 entities that's ~10 calls. If above 20, check for unnecessary doc reads or re-queries.

## Scope: `image-phase-1-decorative` (Step 3 — no dependencies)

Generate site-wide decorative images that don't depend on any entity. Used by the Phase 2 Design System agent + Phase 4 Pages agents for hero sections, about pages, and backgrounds.

**What to generate** is determined by the `decorativeSlots` list in your prompt — generate exactly those keys, no more, no less. Typical canonical keys: `hero`, `about`, `productsHeader`, `cmsHeader`. Do not invent additional keys (`background`, `aboutFeature`, etc.) — orphan keys ship as unused images and unfilled slots show as empty placeholders. The orchestrator composes this list from the loaded verticals + the designer's slot vocabulary (`references/designer/INSTRUCTIONS.md` § common rule #7); the two must agree.

**Inputs (from your prompt):**
- Brand name, business type, aesthetic direction
- Color palette (hex codes)
- `decorativeSlots: string[]` — the exact slot keys to generate (REQUIRED). If absent, return `status: "failed"` with `reason: "decorativeSlots not provided in prompt"` rather than guessing.
- Page list (context only — slot keys are authoritative)

**Process (must follow this order):**

1. **Craft all image prompts up front** using brand context — see `IMAGE_GENERATION.md` § "Prompt guidelines".
2. **Dispatch all generation calls in one concurrent batch** — siblings for `google:4@2` (1 task each, N blocks in parallel), or one batched call for other models (N tasks in `-d`). Required, not optional — see `IMAGE_GENERATION.md` § "Required: minimize round-trips per image phase". Sequential 1-task calls across multiple turns is an anti-pattern; never do it.
3. **Import each to Wix Media** via `curl -X POST https://www.wixapis.com/site-media/v1/files/import` (see `IMAGE_GENERATION.md` § "Step 2"). Imports can parallelize (sibling `curl` calls in one message).
4. **Write `.wix/image-urls.md`** with all resolved URLs, keyed by purpose:
   ```markdown
   # Image URLs

   ## hero
   - url: https://static.wixstatic.com/media/...

   ## about
   - url: https://static.wixstatic.com/media/...
   ```
5. Return the structured JSON block per `../shared/RETURN_CONTRACT.md` (see § Return below).

Page design agents read `.wix/image-urls.md` and use the URLs. If the file doesn't exist when a page agent runs, the page agent uses placeholder styling instead — nothing blocks.

## Scope: `image-phase-2-entity` (Step 4.5 — Phase 1 Seed data inline)

Generate images for products, blog posts, and CMS items. Attach via admin-REST PATCH calls.

> **Parent must NOT paste a PATCH/Update body template.** This INSTRUCTIONS.md owns the recipe per entity type (Products, Blog Posts, CMS Items) — including the exact write-shape (`media.itemsInfo.items[].url` + echoed `options`/`variantsInfo` + `revision`, no `fieldMask`) and the failure-mode mappings. An inline template in the parent prompt causes drift; the wrong shape (e.g. `media.main.image` + `fieldMask`) returns `400 "Expected an object"` on every product. Parents should pass `Phase 1 Seed return data` and `Brand context` only.

**Phase 1 Seed entity IDs are in your prompt, not on disk.** Your parent passes a `Phase 1 Seed return data:` block containing:
- `products: [{id, name, slug, variantId, ...}, ...]` — if stores pack loaded
- `collections: [{name, itemIds, fields}, ...]` — if cms pack loaded
- `blogPosts: [{id, title, ...}, ...]` — if blog pack loaded

**Do not poll for sidecars.** `.wix/logs/<feature>-data.md` is a deprecated coordination pattern (see `../shared/RETURN_CONTRACT.md`). If the `Phase 1 Seed return data:` block is missing from your prompt, return `status: "failed"` with `reason: "Phase 1 Seed return data not provided; image-phase-2-entity cannot run without entity IDs"` — do not sleep, do not read sidecars, do not re-query Phase 1 Seed data from the admin REST API.

**Process per entity type (must follow):**

1. **Craft all image prompts** for this entity type up front, using each entity's own context (name, description, title, etc.).
2. **Dispatch all generation calls in one concurrent batch** — same dispatch shape as Phase 1 Decorative:
   - For `google:4@2` (default): N parallel sibling `curl` calls, one task each.
   - For `bfl:5@1` / `runware:400@1` / others: ONE batched call with all N tasks in `-d`.
   See `IMAGE_GENERATION.md` § "Required: minimize round-trips per image phase". Sequential 1-task calls across multiple turns is an anti-pattern.

   **`google:4@2` 504 retry.** Even with N concurrent siblings, individual tasks intermittently 504. When the response array contains an entry with `errorMessage: "Request timed out"` or HTTP 504, retry **only the failing task(s)** in a follow-up batch — do NOT re-dispatch the whole batch. Cap at 1 retry per task; if it 504s twice, fall back to `bfl:5@1` for that task or skip it (entity gets no image; user can upload from dashboard).

   **N≥6 entities — stagger.** When you have 6 or more entities of one type, split into pairs of 3 parallel siblings rather than 6+ in one shot. Runware throttles google:4@2 above ~4 concurrent tasks per request burst, and the timeout ladder gets steeper. Two messages with 3 siblings each is reliably faster than one message with 6 + multiple retries. (Heuristic — refine after more runs collect data.)
3. **Import each to Wix Media**. Imports can parallelize.
4. **PATCH each entity** with its image URL / file ID. PATCH calls can also parallelize (sibling `curl` calls in one message).

### Products (if `products` is in your prompt)

1. Entity IDs come from your prompt's `Phase 1 Seed return data.products[].id`. Do NOT re-query products for slugs/names (already inline).

   > **428 prevention (MANDATORY):** You MUST fetch each product's existing `options` and `variantsInfo` before step 4. The Update Product endpoint validates variant-option alignment on every PATCH and **returns 428 if either is missing**.

   > **Critical:** `POST /stores/v3/products/query` does **NOT** return `variantsInfo` — even when you pass `fields: [VARIANT_OPTION_CHOICE_NAMES, MERCHANT_DATA, MEDIA_ITEMS_INFO]`. It returns `options` only. Using the bulk-query endpoint produces 428 on every product with variants. Use per-product GETs.

   > **Use per-product GET instead of bulk query:**
   > ```bash
   > curl -fsSL 'https://www.wixapis.com/stores/v3/products/{productId}' \
   >   -H "Authorization: Bearer $TOKEN"
   > ```
   > GET returns both `options` and `variantsInfo` in one shot. Parallelize the N GETs as sibling `curl` calls in one concurrent batch so they fan out without adding to the critical path.

   > If you skip this and get a 428, re-read this section — do not look up external docs.

2. Generate images — ONE batched generation call with N tasks (one per product).

3. Import each to Wix Media — parallelize with sibling calls.

4. PATCH each product with its image + preserved options/variantsInfo + product `revision`:
   ```bash
   curl -fsSL -X PATCH 'https://www.wixapis.com/stores/v3/products/{productId}' \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "product": {
         "revision": "<product.revision from step 1's GET>",
         "media": {
           "itemsInfo": {
             "items": [
               { "url": "<wixstatic-url>", "altText": "<product name or short description>" }
             ]
           }
         },
         "options": <existing options from product query>,
         "variantsInfo": <existing variantsInfo from product query>
       }
     }'
   ```
   **`revision` is mandatory** — omitting it returns `400 "Expected an object"` with no useful hint. Read it from each product's GET response in step 1 and echo it back on the PATCH. Do NOT use `media.main.image` — `media.itemsInfo.items[].url` is the write-shape; `media.main.image` is the read-shape on product responses (they are asymmetric).

   **DO NOT add `fieldMask` to this PATCH.** The endpoint runs cross-field validation (options ↔ variants) BEFORE applying the field mask, so even though `fieldMask: { paths: ["media"] }` should "only update media", the validator sees variants without options and returns 428 `MISSING_VARIANT_OPTION`. Send the full product body shown above (id, revision, media, options, variantsInfo) and let the server merge — no fieldMask.

   PATCH calls parallelize — dispatch as concurrent sibling calls. Parallel PATCHes against different product IDs do NOT cause revision conflicts: each entity has independent revision tracking.

   **409 `INVALID_REVISION` recovery.** If a single PATCH returns 409 with `{"applicationError": {"code": "INVALID_REVISION", ...}}`, the product's actual revision has advanced past the value you cached in step 1's GET. This typically happens against an already-built site (re-runs, remediation runs) where the user edited products via the dashboard between builds. Recovery is per-failure, not whole-batch:

   1. Re-fetch the failed product: `curl -fsSL 'https://www.wixapis.com/stores/v3/products/{productId}' -H "Authorization: Bearer $TOKEN"`. Read the new `revision`.
   2. Retry the PATCH once with the new revision.
   3. If the retry also fails with 409, surface the error — something else is mutating the entity faster than we can react. Don't loop.

   Successful PATCHes from the original parallel batch keep their state; only the 409'd entity needs the recovery. Cap at one retry per failed entity. Append to `run.json.recoveries[]`: `{ "code": "INVALID_REVISION_RETRY", "entityId": "<id>", "originalRevision": "<x>", "actualRevision": "<y>" }`.

### Blog Posts (if `blogPosts` is in your prompt)

1. Entity IDs come from `Phase 1 Seed return data.blogPosts[].id` in your prompt. Title / excerpt for image context come from the prompt too. No re-query needed unless you need fields not in the return.

2. Generate images — ONE batched generation call with N tasks.

3. Import to Wix Media — save the **`file.fileUrl`** (file ID), not the full URL.

4. PATCH each draft post's cover image:
   ```bash
   curl -fsSL -X PATCH 'https://www.wixapis.com/blog/v3/draft-posts/{draftPostId}' \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "draftPost": {
         "media": { "wixMedia": { "image": { "id": "<file-id-from-fileUrl>" } } }
       }
     }'
   ```

5. **Re-publish** each updated post (PATCHing a published post makes it unpublished):
   ```bash
   curl -fsSL -X POST 'https://www.wixapis.com/blog/v3/draft-posts/{draftPostId}/publish' \
     -H "Authorization: Bearer $TOKEN"
   ```

   Re-publish calls parallelize — dispatch as concurrent sibling calls.

### CMS Items (if `collections` is in your prompt)

Key constraint: `wix-data/v2/items` updates are **full-record replaces** (via PUT). Writing only `{data: {image: "..."}}` **erases every other field** on the item — heading, body, question, answer, anything the CMS seeder populated. You MUST read the existing item first and merge the image field into its `data` before writing.

The `PATCH /wix-data/v2/items/{itemId}` endpoint exists but requires a JsonPatch-shaped `fieldModifications` array, not a plain `{dataItem: {data}}` body. Do NOT use PATCH for this scope — it has rejected the documented shape in production and led agents to fall back to a destructive PUT. Use read-merge-PUT instead.

1. Your prompt lists `collections[].itemIds` for each collection with an image field. **Fetch the existing item data** once per collection via `POST /wix-data/v2/items/query` — you cannot skip this step because you need every existing field to merge-preserve.
   ```bash
   curl -fsSL -X POST 'https://www.wixapis.com/wix-data/v2/items/query' \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "dataCollectionId": "<collection>",
       "query": { "filter": { "_id": { "$in": ["<itemId1>", "<itemId2>", ...] } } }
     }'
   ```
   Retain the full `data` object from each result — you'll merge into it.

2. Generate images — ONE batched generation call with N tasks across all applicable items.

3. Import to Wix Media.

4. **PUT each item's full record** with the image field merged into the existing `data`:
   ```bash
   curl -fsSL -X PUT 'https://www.wixapis.com/wix-data/v2/items/{itemId}' \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "dataCollectionId": "<collection>",
       "dataItem": {
         "id": "{itemId}",
         "data": { ...existingData, "<imageField>": "<wixstatic-url>" }
       }
     }'
   ```
   `...existingData` MUST include every non-system field you read in step 1 (`heading`, `body`, etc.). System fields (`_id`, `_owner`, `_createdDate`, `_updatedDate`) don't need to be echoed back — Wix repopulates them.

**Failure mode — do NOT ship with this pattern:**
```
// WRONG — wipes heading + body
PUT /wix-data/v2/items/{itemId}
body: { "dataCollectionId": "<c>", "dataItem": { "id": "...", "data": { "image": "..." } } }
```
Without the read-merge step, an `about-content` item loses its seeded `heading` and `body` when Image Phase 2 attaches the image — the About page then renders only its fallback copy.

PUT calls parallelize — dispatch all items across all collections as sibling `curl` calls in one concurrent batch.

## Return Contract

At the end, emit a structured JSON block per `../shared/RETURN_CONTRACT.md`. Do **not** write `.wix/logs/images.md` — sidecars are deprecated; the parent reads your return JSON directly.

### `image-phase-1-decorative` return

```json
{
  "status": "complete" | "partial" | "failed",
  "phase": "image-phase-1-decorative",
  "scope": "image-phase-1-decorative",
  "summary": "Generated N decorative images; uploaded to Wix Media; wrote .wix/image-urls.md",
  "data": {
    "decorativeCount": 3,
    "purposes": ["hero", "about", "background"],
    "model": "google:4@2",
    "totalCredits": 0.297
  },
  "files": [".wix/image-urls.md"],
  "errors": []
}
```

### `image-phase-2-entity` return

```json
{
  "status": "complete" | "partial" | "failed",
  "phase": "image-phase-2-entity",
  "scope": "image-phase-2-entity",
  "summary": "Generated + attached images: 6 products, 1 CMS item",
  "data": {
    "entityCount": { "products": 6, "cmsAboutContent": 1, "blogPosts": 0 },
    "model": "google:4@2",
    "totalCredits": 0.693
  },
  "files": [],
  "errors": []
}
```

The JSON block MUST be the **last** content in your message (see `../shared/RETURN_CONTRACT.md` § "Observed failure mode").

## Error Handling

| Error | Action |
|---|---|
| `unsupportedParameter` (400) | Strip `steps`/`CFGScale` (or whichever field the response names) and retry once |
| `unsupportedDimensions` (400) | Retry with `1024×1024` / `1376×768` / `1200×896`, or a value from the error payload's supported list |
| 428 from product PATCH | Missing `options`/`variantsInfo` — re-read § "Products" step 1; query the product for existing `options` + `variantsInfo`; retry PATCH with those fields included. This recipe covers it — do not look up external docs. |
| 400 `"Expected an object"` from product PATCH | Missing `revision` in the `product` body — re-read § "Products" step 4; the PATCH body needs `"revision": "<product.revision from step 1 GET>"`. |
| 400 `invalidTaskUUID` from Runware | `taskUUID` must be valid UUIDv4. Regenerate with `uuidgen` / `crypto.randomUUID()` and retry. |
| Model unavailable / rate limited | Switch to an alternative model (`bfl:5@1`, `runware:400@1`) and retry once; skip if still failing |
| Credit exhaustion | Stop generating, return `status: "partial"` with `data.decorativeCount` / `data.entityCount` listing what was completed, and `errors: [{code: "CREDITS_EXHAUSTED", message: "..."}]` |
| Generation fails (5xx, timeout) | Skip this image, continue with others |
| Wix Media import fails | Skip this image, continue |
| Entity PATCH fails | Log the failure in `errors`, continue with other entities |
| 401 on any admin call | `$TOKEN` is missing or expired — re-run `npx @wix/cli token --site $SITE_ID`. If still 401, `npx @wix/cli login` and retry. |
| Phase 1 Seed data missing from prompt (Image Phase 2 only) | Return `status: "failed"` immediately; do not poll or re-query |

**Never block other agents on image failures.** Products, posts, and pages work without images.

## Anti-Patterns

| WRONG | CORRECT |
|-------|---------|
| N sequential 1-task generation `curl` calls across multiple turns | All generation calls in one concurrent batch — parallel siblings for `google:4@2`, or one batched call for other models. See IMAGE_GENERATION.md § "Required: minimize round-trips per image phase" |
| Poll `.wix/logs/<feature>-data.md` sidecars to learn Phase 1 Seed is done | Phase 1 Seed data is inline in your prompt — if missing, return `failed` |
| `sleep 60` loop to wait for Phase 1 Seed | No waiting, no polling — prompt has the data or the agent fails |
| Write `.wix/logs/images.md` sidecar | Sidecars are deprecated — return structured JSON per `RETURN_CONTRACT.md` |
| Re-query Phase 1 Seed entity IDs from the admin REST API | IDs are in your prompt; re-querying wastes a round-trip |
| Generic prompts ("a product photo") | Use brand context, product name, aesthetic direction |
| Ignore color palette from prompt | Reference actual hex codes in image prompts |
| Request text in images | Always include "no text, no watermarks" |
| Send `steps` or `CFGScale` with `google:4@2` | Omit both — `google:4@2` rejects them with `unsupportedParameter` |
| Use free-form sizes (e.g., `800×600`) | Use allowed dimensions only — `1024×1024`, `1376×768`, `1200×896` |
| Use blog post `file.url` for cover image | Blog posts need `file.fileUrl` (file ID) for `media.wixMedia.image.id` |
| Block on image failures | Skip failed images, continue with others |
| PATCH products without `options`/`variantsInfo` | Always query products first for these fields — PATCH returns 428 without them (see § "Products" step 1) |
| PUT a CMS item with only `{data: {image: "..."}}` | Read-merge-write: query the item, merge image into existing `data`, PUT the full record (see § "CMS Items" step 4). Writing only `image` erases seeded heading/body/etc. |
| Use `PATCH /wix-data/v2/items/{itemId}` with `{dataItem: {data}}` | PATCH requires JsonPatch `fieldModifications` — use read-merge-PUT instead (see § "CMS Items") |
| Hit a 428 → immediately search external docs | Re-read § "Products" step 1 first — it covers 428. Only use external docs if your recipe genuinely doesn't cover the error (see § "Self-Loading" step 3) |
| Default to `ReadFullDocsArticle` for API errors already covered by your recipe | Re-read your own recipe first; fall back to MCP doc tools only for errors genuinely not covered (see § "Self-Loading" step 3) |
