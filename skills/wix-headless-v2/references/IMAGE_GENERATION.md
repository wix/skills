# Image generation (opt-in, all project types)

A single reusable capability: generate an image with **Wix AI (Runware)** via the `wixapis.com` proxy, import it into Wix Media, and attach it where it's needed. **Opt-in** — only runs when `imagery` is on (resolved in `DISCOVERY.md`; default off → text-only). It's **agnostic to the project type**: it uses `$TOKEN`/`$SITE_ID` from the provided authentication mechanism, exactly like every other call.

Use it **intelligently, by need** — there's no fixed slot list:
- **Entity images** — during Seed, attach images to seeded image-bearing entities (stores products, blog covers, CMS items, portfolio projects, restaurant items, gift-card products).
- **Contextual / decorative images** — when the skill is building a frontend (the create/connect conductors) and the agent or user decides a surface needs one (e.g. a homepage hero, an about-section visual). Generate only what the page actually uses.

## 1 · Generate

```
POST https://www.wixapis.com/runwareschemaless/v1/request
body: [
  { "taskType": "imageInference", "taskUUID": "<UUIDv4>", "outputType": "URL",
    "outputFormat": "PNG", "positivePrompt": "<prompt>",
    "width": 1024, "height": 1024, "model": "google:4@2", "numberResults": 1 }
]
```

Auth: the universal call shape (`Authorization: Bearer $TOKEN`, `wix-site-id: $SITE_ID`, `Content-Type: application/json`). Extract `data[0].imageURL` (short-lived — import it immediately).

- **`taskUUID`** must be a real UUIDv4 (`uuidgen`); slugs return `400 invalidTaskUUID`.
- **Allowed dimensions** (per model): `1024×1024` (square — products, squares), `1376×768` (16:9 — heroes/banners), `1200×896` (4:3 — editorial). Free-form sizes 400.
- **Forbidden for `google:4@2`**: `steps`, `CFGScale` (→ `400 unsupportedParameter`). Alternatives if it keeps failing: `bfl:5@1`, `runware:400@1`.

### Batching
- **`google:4@2`** times out (`504`) when one request bundles **N≥3** tasks. Fire **N parallel 1-task requests** as concurrent sibling `curl` calls in a single batch — never N≥3 tasks in one body, never sequential one-per-turn.
- **`bfl:5@1` / `runware:400@1`** can batch multiple tasks in one request body.

## 2 · Import to Wix Media

```
POST https://www.wixapis.com/site-media/v1/files/import
body: { "url": "<imageURL from generate>", "mimeType": "image/png", "displayName": "<name>.png" }
```

Keep two values from the `file` object: **`file.url`** (full permanent `wixstatic.com` URL — for `<img>`/CSS/product/CMS image fields) and **`file.fileUrl`** (the file id — for blog cover `media.wixMedia.image.id`).

## 3 · Attach (by entity type)

Read the exact write-shape off the live REST docs (`SEED.md` §1 navigation); the essentials:

- **Product** — PATCH `media.itemsInfo.items[{ url, altText }]`. **428 prevention**: first `GET /stores/v3/products/{id}` for `options` + `variantsInfo` + `revision`, and echo them back in the PATCH (don't send a field mask — the validator runs before masking). Use `file.url`.
- **Blog post** — PATCH the cover via `media.wixMedia.image.id = "<file.fileUrl>"`, then **re-publish** the post (the PATCH unpublishes it).
- **CMS item** — **read-merge-PUT**: `POST /wix-data/v2/items/query` for the item, merge the image URL into its `data`, then PUT the whole record (PATCH needs JsonPatch; PUT is stable). Use `file.url`.
- **Frontend** (when building a site) — drop `file.url` into the `<img src>` / CSS `background-image` of the page being built.

## Prompts

Brand-contextual, never generic. Include: subject; the brand aesthetic/mood; the palette (real tones, e.g. "warm cream and forest green"); style/lighting; and always **"no text, no watermarks"** (AI-rendered text is garbled). Pull context from the brand + the entity (product name/description, post topic, page purpose).

## Credits & failure

Each generated image costs **1 Wix AI credit**, billed at the account level regardless of project type (the account behind the metasite must have credits). **Never block the run on image failure**: on `unsupportedParameter`/`unsupportedDimensions` fix and retry once; on model/5xx/credit-exhaustion, **skip that image and continue** — entities and pages are fine without images (the user can add their own later).
