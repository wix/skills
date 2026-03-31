# CMS Foundations — Shared Patterns for `@wix/data`

Core patterns used by all CMS use cases: service module template, `@wix/data` queries, image resolution, elevated access, and MCP seeding.

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
import { items } from "@wix/data";
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
import { items } from "@wix/data";
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
export async function queryItems(): Promise<CollectionItem[]> {
  const elevatedQuery = auth.elevate(items.query);
  const { items: results } = await elevatedQuery(COLLECTION_ID)
    .ascending("orderIndex")
    .limit(50)
    .find();

  return results.map((item) => ({
    ...item,
    coverImage: resolveImage(item.coverImage),
  })) as CollectionItem[];
}

// -- Get single item by slug --
export async function getItemBySlug(slug: string): Promise<CollectionItem | null> {
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
2. If empty, use `mcp__wix-mcp-remote__CallWixSiteAPI` to insert sample items
3. Design sample data that matches the business type from the functional plan

> MCP seeding is optional. If MCP tools are not available, instruct the user to add content via the Wix dashboard → CMS section.

### MCP Seeding with Images

> **BLOCKING:** After seeding text content, always ask the user whether they want
> to generate images. Do not skip this step silently — items without images look
> incomplete. Only skip if the user explicitly declines.

For use cases with image fields (`photo`, `coverImage`, `galleryImages`),
follow `../shared/IMAGE_GENERATION.md` (Steps 1–3) for API key resolution,
image generation, and Wix Media import.

**Workflow:**

1. Seed all items first (text fields only, no images) using the MCP insert calls above
2. Ask the user if they want to generate images (per IMAGE_GENERATION.md Step 1 — API key resolution)
3. If yes, generate images via DALL-E (IMAGE_GENERATION.md Steps 2-3) using the prompt templates from each use-case reference
4. Patch each item with the wixstatic URL:

```
CallWixSiteAPI: PATCH /wix-data/v2/items/{itemId}
body: {
  "dataCollectionId": "CollectionName",
  "dataItem": {
    "data": {
      "{imageField}": "<wixstatic-url>"
    }
  }
}
```

**Prompt templates** — each use-case reference defines its own prompt template (see the "Seed with Images" section in TEAM_DIRECTORY.md, PORTFOLIO.md, RESOURCE_LIBRARY.md). Always incorporate brand context from the discovery/design phases.

**Constraints:**
- Conditional on user providing an OpenAI API key — never block the main flow
- DALL-E URLs expire in ~1 hour — import to Wix Media immediately after generation
- If image generation or import fails for a single item, skip that item and continue with others
- If all generation fails (bad API key, rate limits), inform the user and proceed — but always attempt first
- FAQ_KNOWLEDGE_BASE has no image fields — skip image generation for FAQ use cases

## Log Results

After seeding (and optional image generation), write to `.wix/features.log.md` (see `../shared/FEATURES_LOG.md` for format). Write one entry per collection:

```markdown
## cms/{CollectionName}
- Status: complete
- Content: {n} items created ({item names})
- Image field: {field name}
- Images: {generated (n/n attached) | skipped (user declined) | not attempted}
```

For collections without image fields (e.g., FAQ), use `Images: not applicable` and omit the `Image field` line.

## Testing

1. Create a data collection in the Wix dashboard → CMS
2. Add fields matching the use case schema (see the specific use case reference)
3. Add at least 2–3 items with all fields populated, including `slug` and `published` (if applicable)
4. Run `npx @wix/cli dev`
5. Navigate to the listing page — should show items
6. Click an item — should navigate to the detail page
