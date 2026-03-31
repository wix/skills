---
name: wix-headless-blog
description: "Inner skill — invoked by wix-headless-features-orchestrator. Implements a blog using the Wix Blog app with @wix/blog SDK, @wix/ricos for rich content, and RSS/sitemap support."
---

# Wix Headless Blog — Wix Blog App Integration

Implements a full blog using the **Wix Blog app** with `@wix/blog` SDK, a service module for data fetching, and `@wix/ricos` for rich content rendering.

## Anti-Patterns

| WRONG | CORRECT |
|-------|---------|
| `import { items } from "@wix/data"` to query blog posts | `import { posts } from "@wix/blog"` — use the Blog SDK, not generic CMS queries |
| `<article set:html={post.content} />` | `<RicosViewer client:only="react" content={post.richContent} />` — Blog content is Ricos format, not raw HTML |
| Skip `wixMetadata` export on blog post page | Always export `wixMetadata` on `[...slug].astro` — required for Wix page routing |
| `import { media } from "@wix/blog"` | `import { media } from "@wix/sdk"` — media utilities come from the SDK package |
| Query posts without `RICH_CONTENT` fieldset | Always request `RICH_CONTENT` fieldset to get renderable content |
| `const { tag } = await tags.getTag(id)` | `const tag = await tags.getTag(id)` — `getTag()` returns `BlogTag` directly, unlike `getCategory()` which returns `{ category }` |
| `heroImage: item.media?.wixMedia?.image` | `media.getImageUrl(item.media.wixMedia.image).url` — raw Wix media references are not URLs; must resolve with `media.getImageUrl()` |
| `<style>` (scoped) for blog post page | `<style is:global>` — RicosViewer is a React island; scoped `data-astro-cid-*` attributes don't transfer to React DOM |
| `rgb(var(--gray-dark))`, `rgb(var(--gray))`, etc. | `var(--color-text)`, `var(--color-text-muted)`, `var(--color-accent)` — use the design system CSS variables |
| Skip Ricos color overrides in blog post layout | Include `.ricos-content` overrides with `!important` — Ricos CSS hardcodes `color: rgb(0, 0, 0)` |

> **Visual boundary:** This skill handles SDK integration only. All styling is owned by the design skill. The BlogPost layout's `<style is:global>` block (including Ricos overrides) is defined in the design skill's `COMPONENT_PATTERNS.md`. Do not add `<style>` blocks or Tailwind classes.

---

## Blog Content Styling

The design skill's `COMPONENT_PATTERNS.md` includes the complete BlogPost layout styles and the required Ricos dark-theme overrides in the `<style is:global>` block.

**Technical note — why `is:global` is required:** RicosViewer renders as a React island (`client:only="react"`). Astro scoped styles use `data-astro-cid-*` attributes that don't transfer to React-rendered DOM. Without `is:global`, both layout styles and Ricos color overrides silently stop applying. The Ricos library CSS hardcodes `color: rgb(0, 0, 0)` on content elements, requiring `!important` overrides.

---

## Architecture Overview

The blog uses a **service module** that wraps `@wix/blog` SDK calls, resolving categories, tags, and media into ready-to-use data:

```
@wix/blog SDK → src/lib/blog.ts (service module) → Pages
                                                      ├── blog/index.astro (listing)
                                                      ├── blog/[...slug].astro (detail + RicosViewer)
                                                      └── rss.xml.js (RSS feed)
```

1. **Blog service** (`src/lib/blog.ts`) — queries posts via `posts.queryPosts`, resolves categories/tags/media per post
2. **Pages** — import `queryBlogPosts()` and `getPostBySlug()` from the service module
3. **SSR mode** — Wix headless projects use `output: "server"` (Cloudflare Workers), so pages use `Astro.params` directly (no `getStaticPaths`)
4. **Rich content** — rendered with `@wix/ricos` `RicosViewer` component via a React wrapper with `client:only="react"`

## Required Dependencies

```
@wix/blog @wix/ricos @astrojs/rss @astrojs/sitemap
```

> Features collects these for a single batch install — do NOT install independently.

## Implementation References

| Reference | What It Covers |
|-----------|---------------|
| `references/BLOG_SETUP.md` | Blog service module, constants, astro.config changes |
| `references/BLOG_PAGES.md` | Blog listing, post detail, RSS feed, layout, SEO head, date formatting |
| `references/BLOG_CONTENT.md` | Seed initial blog posts via MCP |
| `../shared/IMAGE_GENERATION.md` | AI image generation, Wix Media import, cover images for posts |

Follow `BLOG_SETUP.md` first, then `BLOG_PAGES.md`, then `BLOG_CONTENT.md` to seed initial posts.

---

## Seed Initial Content via MCP

After SDK code is wired and before the first preview, seed the blog with 3 on-brand posts so the site shows real content immediately.

> **Required when coming from the discover flow.** MCP tools and discovery context are guaranteed available in the discover → cli → design → features flow. A blog with zero posts on first preview is a build failure — the user sees an empty page. Always execute content seeding in this path.
>
> **Skip only for standalone invocations** where MCP is genuinely unavailable (i.e., user invoked this skill directly without MCP configured).

See `references/BLOG_CONTENT.md` for the full recipe: get member ID, design 3 posts using discovery context, create via `POST /blog/v3/draft-posts` with `publish: true`, and verify.

After content seeding and image generation, **log results** to `.wix/features.log.md` per `../shared/FEATURES_LOG.md`, and **append a lifecycle entry** (`####` sub-phase) to `.wix/lifecycle.log.md` per `../shared/LIFECYCLE_LOG.md`.
