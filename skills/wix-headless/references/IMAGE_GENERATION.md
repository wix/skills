# Image generation (opt-in, all project types)

A single reusable capability: generate an image with **Wix AI (Runware)** via the `wixapis.com` proxy, import it into Wix Media, and attach it where it's needed. **Opt-in** — only runs when `imagery` is on (resolved in `DISCOVERY.md`; default off → text-only). It's **agnostic to the project type**: it uses `$TOKEN`/`$SITE_ID` from the provided authentication mechanism, exactly like every other call.

Use it **intelligently, by need** — there's no fixed slot list:
- **Entity images** — during Seed, attach images to seeded image-bearing entities (e.g. stores products, blog covers, CMS items, bookings services, restaurant items, portfolio projects + collection covers, event heroes — illustrative, not a write-shape index; each capability's recipe pins its own attach shape, see §3). **Attaching the generated image to the entity is a required second step** — a seeder creates the entity in pass 1 (text-first), then a pass-2 update/patch writes the image onto it. An entity is not "done" until its image is attached (or the attach is skipped because imagery is off / it failed — then it stays text-only, which is fine).
- **Contextual / decorative images** — when the skill is building a frontend (the create/connect flows) and the agent or user decides a surface needs one (e.g. a homepage hero, an about-section visual). Generate only what the page actually uses, up to the per-run `imageCap` (`DISCOVERY.md` §4); a slot over the cap or off gets the **themed-block fallback** (below), not an empty gap.

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

Keep two values from the `file` object: **`file.url`** (the full permanent `wixstatic.com` URL) and **`file.id`** (the WixMedia file id, e.g. `<hash>~mv2.jpg`). Some entities bind by url, others by id — **which one a given entity uses is the recipe's concern** (§3), not this common section's. (The import response has **no `fileUrl` field** — the id is `file.id`.)

## 3 · Attach (by entity type)

The pass-2 **write shape is per-entity earned knowledge and lives in each capability's seed recipe** — right next to the create shape the seeder already reads (`inline-recipes/setup-<capability>.md`). **That recipe is authoritative** — read the exact shape there (field paths, any required companion fields, silent-drop warnings, confirm-by-requery), not here. This section is navigation only and carries no shapes:

| Entity | Recipe | Section |
|---|---|---|
| Store product | `setup-online-store.md` | **Attach images** |
| Blog post cover | `setup-blog.md` | **Attach images** |
| CMS item | `setup-cms.md` | **Attach images** |
| Bookings service | `setup-bookings.md` | **Attach images** |
| Portfolio project / collection | `setup-portfolio.md` | **Attach images** (cover + gallery) |
| Restaurant menu item | `setup-restaurants.md` | **Attach images** |
| Event hero (`mainImage`) | `setup-events.md` | **Attach images** |
| *(any entity whose recipe doesn't pin one)* | — | discover live via `DOC_DISCOVERY.md` |

- **Frontend** (when building a site) — drop `file.url` into the `<img src>` / CSS `background-image` of the page being built.

## Prompts

Brand-contextual, never generic. Include: subject; the brand aesthetic/mood; the palette (real tones, e.g. "warm cream and forest green"); style/lighting; and always **"no text, no watermarks"** (AI-rendered text is garbled). Pull context from the brand + the entity (product name/description, post topic, page purpose).

## Credits, cost & the not-generating fallback

Each generated image costs **1 Wix AI credit**, billed at the account level regardless of project type (the account behind the metasite must have credits). Volume is bounded in `DISCOVERY.md` §4 — carry those two values through:

- **Cost is surfaced** — the pre-work line states the plan in credits (*"~N images ≈ N credits"*). Keep the running count honest with that estimate.
- **Honor the per-run `imageCap`** (default ~12, from Discovery). Generate up to the cap by priority (hero/most-visible surfaces first); **beyond the cap, don't generate — render the themed-block fallback** and log what was capped. Never silently exceed the cap on a "throughout"-style phrase.

**Themed-block fallback (the not-generating path).** Whenever a **frontend** image isn't generated — imagery off, over the cap, declined, or a generation failure — render a **styled `div` that follows the site's design tokens** (palette, radius, spacing, an optional label/gradient) in the slot, never an empty gap or a broken `<img>`. It's deterministic, needs no input, never hangs — so it's the safe default for any non-interactive run and keeps the layout on-brand at zero credits. (A *seeded backend entity* with no image just stays text-only — there's no div to render server-side; `SEED.md` § "Entity images".)

**Never block the run on image failure**: on `unsupportedParameter`/`unsupportedDimensions` fix and retry once; on model/5xx/credit-exhaustion, **skip that image and continue** — a frontend slot falls back to a themed block, a seeded entity stays text-only (the user can add their own later).
