---
name: blog
triggers: ["blog", "publish articles", "write posts", "content site", "editorial", "journal", "newsletter"]
description: "Blog — post listing, post detail with rich content, RSS feed, sitemap"

features:
  - name: "Blog"
    description: "Publish posts with a listing page, individual post pages with rich content rendering, and an RSS feed."
  - name: "RSS and sitemap"
    description: "Auto-generated RSS feed and XML sitemap for search engine discovery."

apps:
  - name: "Wix Blog"
    appDefId: "14bcded7-0066-7c35-14d7-466cb3f09103"

packages:
  - "@wix/blog"
  - "@wix/ricos"
  - "@astrojs/rss"
  - "@astrojs/sitemap"

routes:
  - route: "/blog"
  - route: "/blog/[slug]"
    name: "Blog Post"   # path-derivation would produce "Blog [slug]" — override with the user-facing label
  - route: "/rss.xml"

cmsCollections: []

seed:
  agentLocation: "references/blog/"
  scope: "seed"
  description: "Ensure Blog app is installed, seed 3 on-brand blog posts via MCP with rich Ricos content"
  references: ["references/blog/BLOG_CONTENT.md"]

components:
  agentLocation: "references/blog/"
  scope: "components"
  description: "Blog service module (queryBlogPosts, getPostBySlug), RicosViewer React wrapper, site constants, astro.config sitemap integration"
  references: ["references/blog/BLOG_SETUP.md"]
  files:
    - "src/lib/blog.ts"
    - "src/components/RicosViewer.tsx"
    - "src/consts.ts"
    - "astro.config.mjs (patch — add site property and sitemap integration)"

pages:
  - name: "blog-pages"
    agentLocation: "references/blog/"
    scope: "pages"
    description: "Wire blog listing + post detail pages to @wix/blog SDK, add RSS feed endpoint, BlogPost layout, SEO head, date formatting, patch home page latest-posts section"
    references: ["references/blog/BLOG_PAGES.md"]
    files:
      - "src/pages/blog/index.astro"
      - "src/pages/blog/[...slug].astro"
      - "src/pages/rss.xml.js"
      - "src/layouts/BlogPost.astro"
      - "src/components/BaseHead.astro"
      - "src/components/FormattedDate.astro"
      - "src/pages/index.astro (patch — latest-posts section only)"

creates:
  - { file: src/lib/blog.ts,                  phase: components }
  - { file: src/components/RicosViewer.tsx,   phase: components }
  - { file: src/consts.ts,                    phase: components }
  - { file: src/pages/blog/index.astro,       phase: pages }
  - { file: src/pages/blog/[...slug].astro,   phase: pages }
  - { file: src/pages/rss.xml.js,             phase: pages }
  - { file: src/layouts/BlogPost.astro,       phase: pages }
  - { file: src/components/BaseHead.astro,    phase: pages }
  - { file: src/components/FormattedDate.astro, phase: pages }

contributes:
  - file: astro.config.mjs
    marker: "<!-- config:sitemap -->"
    description: "site property + @astrojs/sitemap integration"
  - file: src/pages/index.astro
    marker: "<!-- home:blog -->"
    description: "Latest 3 posts grid (cover images, titles, dates, excerpts) from queryBlogPosts(3)"
  - file: src/components/Navigation.astro
    marker: "<!-- nav:links -->"
    description: "Blog menu link → /blog"

include: false
disabled: false
---

# Blog Pack

Blog vertical for content-driven sites. Loaded when the user's prompt mentions blogging, publishing, or editorial content.

## Phase decomposition

| Scope | Phase | Files | Depends on |
|-------|-------|-------|------------|
| `seed` | Phase 1 — Step 3 (bg) | None (MCP only) | MCP connection |
| `components` | Phase 3 — Step 4.5 (bg) | blog.ts, RicosViewer.tsx, consts.ts, astro.config.mjs | Styling contract |
| `blog-pages` | Phase 4 — Step 7 (bg) | blog/index.astro, blog/[...slug].astro, rss.xml.js, BlogPost.astro, BaseHead.astro, FormattedDate.astro, index.astro (patch) | Phase 2 Design System + Phase 1 Seed post data |

Phase 3 Components runs in the background from Step 4.5 through Phase 4. Phase 4 blog-pages dispatches in Step 7 after Phase 3 + Phase 1 Seed complete — it needs the React islands written by Phase 3 and the seeded post slugs from Phase 1.

RSS feed generation (`rss.xml.js`) is included in the blog-pages scope rather than a separate scope — it's ~15 lines, has no design dependency, and doesn't justify its own agent dispatch.

## Known failure modes (propagate to agent prompts)

| Wrong | Right |
|-------|-------|
| `import { items } from "@wix/data"` for blog queries | `import { posts } from "@wix/blog"` — use the Blog SDK |
| `<article set:html={post.content} />` | `<RicosViewer client:only="react" content={post.richContent} />` — content is Ricos format |
| Skip `wixMetadata` export on `[...slug].astro` | Required for Wix page routing and SEO |
| `media.wixMedia.image` as raw URL | `media.getImageUrl(item.media.wixMedia.image).url` — must resolve |
| Query posts without `RICH_CONTENT` fieldset | Always request `RICH_CONTENT` or `post.richContent` is undefined |
| `const { tag } = await tags.getTag(id)` | `const tag = await tags.getTag(id)` — returns directly (unlike `getCategory()`) |
| Scoped `<style>` for RicosViewer overrides | `<style is:global>` — React islands don't inherit scoped Astro styles |
| Skip `.ricos-content` color overrides | Ricos CSS hardcodes `color: rgb(0, 0, 0)` — invisible on dark themes without overrides |

## Images

Cover images for blog posts are generated by the shared image agent (`image-phase-2-entity` scope), not by blog agents. The image agent PATCHes cover images onto post records after Phase 1 Seed creates them. Phase 4 agents query posts and render `post.media` — the image URL flows through the post record.

## References

- `references/blog/BLOG_CONTENT.md` — Phase 1: MCP post seeding
- `references/blog/BLOG_SETUP.md` — Phase 3 Components: service module, RicosViewer, config
- `references/blog/BLOG_PAGES.md` — Phase 2 blog-pages: listing, detail, RSS, layout, SEO
