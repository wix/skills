# CMS Foundations — Shared Patterns for `@wix/data`

Core patterns used by all CMS use cases: service module template, `@wix/data` queries, image resolution, elevated access, MCP seeding, and rich-text (Ricos) rendering.

> **Import note (read first).** Page code in this plugin uses `import * as items from "@wix/wix-data-items-sdk"` rather than the documented `import { items } from "@wix/data"`. The Wix-headless docs still show the `@wix/data` form, but `@wix/data` 1.0.448 dropped the `items` re-export — only sub-namespaces (`backups`, `collections`, `permissions`, …) remain, and the documented form fails the build with `'items' is not exported by '@wix/data'`. The actual `items` API (with `query`, `insert`, `update`, `remove`, `bulkInsert`, etc.) lives in `@wix/wix-data-items-sdk`, which `@wix/data` depends on transitively. Importing from there directly works on every current `@wix/data` version. The cms vertical pack adds `@wix/wix-data-items-sdk` to the install list so it's always present (`references/verticals/cms.md`). Use the wix-data-items-sdk import everywhere.

## Rendering Ricos rich-text fields

Wix CMS stores `RICH_TEXT` / `RICH_CONTENT` fields as **Ricos JSON** — a structured node tree (PARAGRAPH, HEADING, BULLETED_LIST, etc.), not HTML. The dashboard's rich-text editor reads and writes this format.

For SSR Astro pages (about, faq, portfolio, team, resource), import the seeded `renderRicos` util from `src/utils/ricos.ts`. The util is shipped by `seed-utilities.sh` (copied from `<SKILL_ROOT>/shared-utilities/ricos.ts` during Setup), so it's already on disk — do NOT inline a Ricos walker in your page.

```astro
---
import * as items from "@wix/wix-data-items-sdk";
import { auth } from "@wix/essentials";
import { renderRicos } from "../utils/ricos";

const elevatedQuery = auth.elevate(items.query);
const { items: results } = await elevatedQuery("about-content")
  .limit(1)
  .find();
const about = results[0];
const bodyHtml = renderRicos(about?.body);
---

<article class="prose">
  <h1>{about?.heading}</h1>
  <div set:html={bodyHtml} />
</article>
```

The util covers the common subset (PARAGRAPH, HEADING 1-6, BULLETED_LIST / ORDERED_LIST / LIST_ITEM, BLOCKQUOTE, DIVIDER + BOLD / ITALIC / UNDERLINE / LINK decorations). Anything outside that set renders defensively as a `<p>` with the raw text — never throws.

> **Why not @wix/ricos?** The blog vertical uses `@wix/ricos`'s React `RicosViewer` as a client island because blog posts can carry the full Ricos feature set (galleries, polls, embedded media). For static CMS pages, that's ~80kb of React for paragraphs and lists — overkill. Use the seeded SSR walker instead.

> **Do NOT `set:html={item.body}` directly.** That ships JSON-encoded text into the page (e.g. `[object Object]` or `{"nodes":...}`). Always go through `renderRicos`.

> **Critical Rules — Read Before Starting**
> 1. **Collection IDs have NO namespace** — user collections use just the name (e.g., `"Projects"`). Only Wix App collections use `<namespace>/<name>`. Verify via MCP: `GET /wix-data/v2/collections?fields=id`.
> 2. **SDK query pattern** — `items.query("CollectionId").find()`. There is no `items.queryDataItems()` in the SDK.
> 3. **`auth.elevate` on every query** — without it, restricted collections silently return no items.
> 4. **CMS only for user collections** — use `@wix/blog` for blog posts, `@wix/stores` for products, `@wix/forms` for form submissions.

## Prerequisites

- `@wix/data` package installed (collected by features orchestrator — do NOT install independently)
- `@wix/essentials` package installed (for elevation)
- A data collection created in the Wix dashboard → CMS section
- No special Wix app installation needed — `@wix/data` works with any Wix Managed Headless project

## Collection ID Format

Native (user-created) CMS collections use **just the collection name** — no namespace prefix.

Example: if the collection is called `Projects`, the collection ID is simply `"Projects"`.

Only Wix App collections (e.g., `Members/PublicData`, `Locations/Locations`) use a `<namespace>/<name>` format. User-created collections never use a namespace.

> **How to verify**: Call `GET /wix-data/v2/collections?fields=id` via MCP and use the exact `id` value from the response. Never guess — the dashboard name may differ from the ID.

## Quick Reference — Inline Query (Simple Pages)

For pages that just need to list items from a collection:

```astro
---
import * as items from "@wix/wix-data-items-sdk";
import { auth } from "@wix/essentials";

// Always elevate queries for permission safety
const elevatedQuery = auth.elevate(items.query);
const { items: results } = await elevatedQuery("MyCollection")
  .ascending("sortField")
  .limit(50)
  .find();

// Fields are directly on each item (NOT item.data.field)
const myItems = results.map((item) => ({
  name: item.name,        // correct
  // name: item.data.name  // wrong — REST pattern, not SDK
}));
---
```

> **Common mistake:** `items.queryDataItems(...)` does NOT exist in the
> `@wix/data` SDK. The REST API uses `/items/query` with a `dataCollectionId`
> body field, but the SDK uses `items.query("collectionId")` — a chainable
> QueryBuilder. Do not confuse REST and SDK patterns.

## Service Module Template

Every CMS use case follows the same `src/lib/{usecase}.ts` pattern — a typed interface and query functions that pages import.

```typescript
import * as items from "@wix/wix-data-items-sdk";
import { auth } from "@wix/essentials";
import { media } from "@wix/sdk";

// -- Collection ID (use exact name from Wix dashboard — no namespace for native collections) --
const COLLECTION_ID = "collection-name";

// -- Typed interface matching collection fields --
export interface CollectionItem {
  _id: string;
  title: string;
  slug: string;
  // ...add fields matching your collection schema
  coverImage?: string;
}

// -- Image resolution helper --
function resolveImage(wixImageUrl: string | undefined, width = 800, height = 600): string | undefined {
  if (!wixImageUrl) return undefined;
  return media.getScaledToFillImageUrl(wixImageUrl, width, height, {});
}

// -- Query all items --
// Wrap every Wix SDK await in try/catch. If the query throws at SSR, an empty
// array keeps the page renderable instead of crashing it. (Unguarded SSR
// awaits truncate Astro's response stream mid-body — nav renders, then blank.)
export async function queryItems(): Promise<CollectionItem[]> {
  try {
    const elevatedQuery = auth.elevate(items.query);
    const { items: results } = await elevatedQuery(COLLECTION_ID)
      .ascending("orderIndex")
      .limit(50)
      .find();

    return results.map((item) => ({
      ...item,
      coverImage: resolveImage(item.coverImage),
    })) as CollectionItem[];
  } catch (err) {
    console.error(`[cms:${COLLECTION_ID}] query failed:`, err);
    return [];
  }
}

// -- Get single item by slug --
export async function getItemBySlug(slug: string): Promise<CollectionItem | null> {
  try {
    const elevatedQuery = auth.elevate(items.query);
    const { items: results } = await elevatedQuery(COLLECTION_ID)
      .eq("slug", slug)
      .limit(1)
      .find();

    const item = results[0];
    if (!item) return null;

    return {
      ...item,
      coverImage: resolveImage(item.coverImage),
    } as CollectionItem;
  } catch (err) {
    console.error(`[cms:${COLLECTION_ID}] getItemBySlug failed:`, err);
    return null;
  }
}
```

Key details:
- `auth.elevate(items.query)` wraps the query for restricted collections — always use this by default since collection permissions vary
- `media.getScaledToFillImageUrl(url, w, h, {})` resolves `wix:image://` URLs to sized CDN URLs
- Sort by `orderIndex` (ascending) for manually ordered content, or `_createdDate` (descending) for chronological
- The interface must match the collection fields — check the dashboard, don't guess

## Multi-Image Resolution

For collections with image arrays (e.g., gallery images):

```typescript
function resolveImages(imageUrls: string[] | undefined, width = 800, height = 600): string[] {
  if (!imageUrls || imageUrls.length === 0) return [];
  return imageUrls
    .map((url) => media.getScaledToFillImageUrl(url, width, height, {}))
    .filter(Boolean);
}
```

## Category Filtering Pattern

Many use cases filter by category via URL search params (server-rendered, no client JS):

```astro
---
const activeCategory = Astro.url.searchParams.get("category");
const allItems = await queryItems();
const filtered = activeCategory
  ? allItems.filter((item) => item.category === activeCategory)
  : allItems;
const categories = [...new Set(allItems.map((item) => item.category).filter(Boolean))];
---

<nav>
  <a href="?" class:list={[!activeCategory && "active"]}>All</a>
  {categories.map((cat) => (
    <a
      href={`?category=${encodeURIComponent(cat)}`}
      class:list={[activeCategory === cat && "active"]}
    >{cat}</a>
  ))}
</nav>
```

> **Styling note:** Category filter pill styling is created by the design skill. See `COMPONENT_PATTERNS.md` → Category Filter.

## MCP Seeding (Conditional)

If Wix MCP tools are available, check if the collection has data and seed sample items if empty. This is **conditional** — only attempt if MCP is connected.

1. Query the collection — if items exist, skip seeding
2. If empty, create the collection and insert sample items via MCP (see templates below)
3. Design sample data that matches the business type from the functional plan

> MCP seeding is optional. If MCP tools are not available, instruct the user to add content via the Wix dashboard → CMS section.

### Create collection (if it doesn't exist)

```
<prefix>CallWixSiteAPI: POST https://www.wixapis.com/wix-data/v2/collections
body: {
  "collection": {
    "id": "about-content",
    "displayName": "About Content",
    "fields": [
      { "key": "heading", "displayName": "Heading", "type": "TEXT" },
      { "key": "body", "displayName": "Body", "type": "RICH_TEXT" },
      { "key": "image", "displayName": "Image", "type": "IMAGE" }
    ]
  }
}
```

### Insert item WITH field data

**This is the critical step that must include actual field values.** Creating an item without populating the `data` object results in an empty record — the collection schema exists but the item has no content.

```
<prefix>CallWixSiteAPI: POST https://www.wixapis.com/wix-data/v2/items
body: {
  "dataCollectionId": "about-content",
  "dataItem": {
    "data": {
      "heading": "Our Story",
      "body": "<p>Founded on a belief that...</p><p>We source the finest...</p>"
    }
  }
}
```

The response returns the created item's `_id` — collect these for the Phase 1 return contract.

**Every text field must be populated in the `data` object.** Do not create items with empty `data: {}` and expect Phase 2 or the image agent to fill in text fields — they only handle their own scope (pages and images respectively).

For FAQ items, include both `question` and `answer` plus `sortOrder`:

```
<prefix>CallWixSiteAPI: POST https://www.wixapis.com/wix-data/v2/items
body: {
  "dataCollectionId": "faq",
  "dataItem": {
    "data": {
      "question": "What is your return policy?",
      "answer": "We accept returns within 30 days of purchase...",
      "sortOrder": 1
    }
  }
}
```

### Verify inserts with a live query (mandatory)

After inserting all items, **query each collection once** and confirm every field you sent is present in the stored `data`. A POST without errors does NOT prove the content persisted — the API has accepted insert bodies with missing fields before, and the failure is invisible until a human opens the page.

```
<prefix>CallWixSiteAPI: POST https://www.wixapis.com/wix-data/v2/items/query
body: { "dataCollectionId": "<collection>" }
```

For every returned item, confirm its `data` object contains every text field you POSTed (`heading`, `body`, `question`, `answer`, etc.). If any field is missing:

- Do NOT return `status: "complete"`.
- Re-insert the item (a DELETE then POST is safest — PUT replaces the whole record) and re-verify.
- If re-insert fails twice, return `status: "partial"` with `errors: [{code: "SEED_FIELD_MISSING", collection: "<c>", itemId: "<id>", missingFields: [...]}]`.

A CMS seeder can return `complete` for an about-content item, then Image Phase 2 silently wipes its `heading` + `body` via a destructive full-record PUT. The verify-after-insert step here plus the read-merge-PUT rule in the images agent makes that class of data loss unreachable.

### MCP Seeding with Images

For use cases with image fields (`photo`, `coverImage`, `galleryImages`),
follow `../../shared/IMAGE_GENERATION.md` (Steps 1–2) for Wix AI image
generation and Wix Media import. Image generation is MCP-authenticated
and always available — do not ask the user for credentials.

**Workflow:**

1. Seed all items first (text fields only, no images) using `POST /wix-data/v2/items` as shown in § "Insert item WITH field data" above. Every text field must have a value in the `data` object — empty items cause "Content coming soon" placeholder pages.
2. Run the verify-after-insert query (see § "Verify inserts with a live query" above) before touching images.
3. Generate images via Wix AI (IMAGE_GENERATION.md Steps 1–2) using the prompt templates from each use-case reference
4. Attach each image by reading the existing item, merging, and writing the whole record back via PUT. Do NOT use PATCH here — the endpoint expects a JsonPatch `fieldModifications` array and rejects the `{dataItem:{data}}` body. Do NOT PUT with just `{image}` — PUT replaces the entire record and erases heading/body.

```
# Step a: read the existing item
<prefix>CallWixSiteAPI: POST https://www.wixapis.com/wix-data/v2/items/query
body: {
  "dataCollectionId": "CollectionName",
  "query": { "filter": { "_id": { "$in": ["{itemId}"] } } }
}

# Step b: merge image into existing data and PUT the full record
<prefix>CallWixSiteAPI: PUT https://www.wixapis.com/wix-data/v2/items/{itemId}
body: {
  "dataCollectionId": "CollectionName",
  "dataItem": {
    "id": "{itemId}",
    "data": { ...existingData, "{imageField}": "<wixstatic-url>" }
  }
}
```

`...existingData` must include every non-system field from step a (system fields `_id`, `_owner`, `_createdDate`, `_updatedDate` don't need to be echoed). Skipping the merge wipes seeded text fields and ships an empty About page.

**Prompt templates** — each use-case reference defines its own prompt template (see the "Seed with Images" section in TEAM_DIRECTORY.md, PORTFOLIO.md, RESOURCE_LIBRARY.md). Always incorporate brand context from the discovery/design phases.

**Constraints:**
- Never block the main flow on image failures — text data is already seeded
- Runware image URLs are short-lived — import to Wix Media immediately after generation
- If image generation or import fails for a single item, skip that item and continue with others
- If all generation fails (credits exhausted, MCP errors), write the sidecar with `Status: partial` and proceed — but always attempt first
- FAQ_KNOWLEDGE_BASE has no image fields — skip image generation for FAQ use cases

## Return Results

Emit a structured JSON block at the end of your completion message per `../../shared/RETURN_CONTRACT.md`. Do NOT write sidecar files.

```json
{
  "status": "complete",
  "phase": "cms-seed",
  "scope": "seed-seed",
  "summary": "Created {N} collections; seeded {M} items; verified every field persisted",
  "data": {
    "collections": [
      {
        "name": "<collection-slug>",
        "itemIds": ["<id>", "..."],
        "fields": ["<field>", "..."],
        "storedFields": ["<field>", "..."],
        "sampleValues": { "<field>": "<short sample value>" },
        "imageField": "<field name or null>"
      }
    ]
  },
  "files": [],
  "errors": []
}
```

- `storedFields` MUST match the real keys seen in the verify-after-insert query response's `data` object (see § "Verify inserts with a live query"). Downstream pages agents compare against this — if you return `fields: ["heading", "body"]` but only `heading` was actually stored, pages render empty bodies.
- `sampleValues` is a single example item's field-to-short-string map. Lets downstream agents spot-check that content is real without another MCP round-trip. Truncate rich-text bodies to the first ~80 characters.
- For collections without image fields (e.g., FAQ), set `imageField: null`.
- The JSON block MUST be the last content in your message.

## Testing

1. Create a data collection in the Wix dashboard → CMS
2. Add fields matching the use case schema (see the specific use case reference)
3. Add at least 2–3 items with all fields populated, including `slug` and `published` (if applicable)
4. Run `npx @wix/cli dev`
5. Navigate to the listing page — should show items
6. Click an item — should navigate to the detail page
