# Blog — seeding

Seed by **running `seed-blog.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Blog app if needed, resolves a real author memberId (every post
create requires one), and creates everything in the right order — categories/tags first,
then **published** posts, then imported cover images (PATCH + re-publish).

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/blog/seed/seed-blog.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3 posts** (the seed shows
the shape; the owner writes the rest in the dashboard) and make them exercise the UI: group
them into 2 categories when the brief has natural sections, tag a couple, vary the content
blocks (heading + paragraphs + a quote or list per post), and give every post a
`coverImageUrl` (verified — a feed without covers looks broken).

```json
{
  "categories": ["Brewing", "Stories"],
  "posts": [
    { "title": "How We Roast Our Single-Origin Beans", "category": "Stories", "tags": ["coffee"],
      "coverImageUrl": "https://…",
      "content": [
        { "type": "heading", "text": "From farm to cup", "level": 2 },
        { "type": "paragraph", "text": "Every batch starts with beans sourced from a single estate." },
        { "type": "quote", "text": "Great coffee is grown, not made." }
      ] },
    { "title": "The Pour-Over, Step by Step", "category": "Brewing", "tags": ["guides"],
      "coverImageUrl": "https://…",
      "content": [
        { "type": "paragraph", "text": "A repeatable ritual in five minutes." },
        { "type": "ordered", "items": ["Rinse the filter", "Bloom 30 seconds", "Pour in circles"] }
      ] },
    { "title": "Why Water Matters More Than You Think", "category": "Brewing",
      "coverImageUrl": "https://…",
      "content": [
        { "type": "paragraph", "text": "Coffee is 98% water — its minerals decide the cup." },
        { "type": "bulleted", "items": ["Filtered, not distilled", "Aim for ~150 ppm hardness"] }
      ] }
  ]
}
```

- `content` blocks: `{type:"heading",text,level?}` · `{type:"paragraph",text}` ·
  `{type:"quote",text}` · `{type:"bulleted"|"ordered",items:[…]}`. For node types these don't
  cover (code, inline images), pass a pre-built Ricos `richContent` on the post instead.
- `category`/`categories`/`tags` are display **names** — created idempotently and resolved to
  ids internally. Optional: skip them entirely when the brief doesn't group posts.
- `coverImageUrl` — a plain https image URL; the script imports it into Wix Media (Blog binds
  covers by file id, not URL) and re-publishes the post. A failed cover never blocks the run.
- Posts are created **published** — an unpublished post never reaches visitors. The bulk
  create returns 200 even on partial failure: check each `posts[].success` in the result.

**Seeding is additive — never delete or overwrite existing content**; ask first if a cleanup
seems needed.

## Escape hatch — individual functions
`setupBlog` composes exported steps — `installBlogApp`, `getAuthorMemberId`, `createPosts`,
`createCategories`, `createTags`, `importImage`, `attachPostCovers`, plus `makeCtx()` —
import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; the
authoritative source recipe is `wix-headless/references/inline-recipes/setup-blog.md`.
