# Reference: Blog Pages

Blog listing, post detail, category detail, RSS feed, layout, SEO, and date formatting.

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/blog/index.astro` | Blog listing page (main page — SEO auto-injected) |
| `src/pages/blog/[...slug].astro` | Blog post detail page — item page: `wixMetadata` + `<SEO.Tags>` |
| `src/pages/category/[slug].astro` | Blog category detail page — item page: `wixMetadata` + `<SEO.Tags>` |
| `src/pages/rss.xml.js` | RSS feed |
| `src/layouts/BlogPost.astro` | Blog post layout wrapper (exposes a `head` slot) |
| `src/components/BaseHead.astro` | Global `<head>` metadata (charset/viewport/favicon) + `head` slot |
| `src/components/FormattedDate.astro` | Date formatting helper |

---

## 1. SEO — canonical `@wix/seo` setup

Blog **post** and **category** pages are *item pages*: one item rendered from a parameterized route (`/blog/[...slug]`, `/category/[slug]`). Unlike main pages (the blog listing, home), whose SEO tags Wix injects automatically with no code, item pages must resolve their own tags. Use the official **`@wix/seo`** package — this is the canonical Wix Headless approach and is confirmed working with the `@wix/astro` integration (routes register in `/_wix/pages.json`, and `<SEO.Tags>` renders resolved tags into `<head>` server-side).

Each item page does two things:

1. **Register the route** — export `wixMetadata` (feeds `/_wix/pages.json` → sitemap + dashboard SEO editor + deep links).
2. **Resolve + render tags** — call `loadSEOTagsServiceConfig()` at request time and render `<SEO.Tags>` into the layout's `head` slot.

The post page (§5) and category page (§6) below each show both. This section defines the shared pieces.

### `wixMetadata` — source identifiers from `WIX_APPS`

```js
import { WIX_APPS } from "@wix/essentials";

// Blog POST page:
export const wixMetadata = {
  appDefId: WIX_APPS.blogs.id,
  pageIdentifier: WIX_APPS.blogs.postPageMetadata.pageIdentifier,
  identifiers: { slug: WIX_APPS.blogs.postPageMetadata.identifiers.slug },
};

// Blog CATEGORY page:
export const wixMetadata = {
  appDefId: WIX_APPS.blogs.id,
  pageIdentifier: WIX_APPS.blogs.categoryPageMetadata.pageIdentifier,
  identifiers: { slug: WIX_APPS.blogs.categoryPageMetadata.identifiers.slug },
};
```

- **Reference `WIX_APPS` directly inside the `wixMetadata` object.** Do NOT read it into a variable first (`const { id } = WIX_APPS.blogs`). `wixMetadata` is a module-level export evaluated in module scope, where component-body variables don't exist. One `wixMetadata` that throws clears the *entire* `/_wix/pages.json`, so this silently breaks the whole sitemap.
- **The `identifiers` key must match the route param filename** — `slug` for `[slug].astro` and `[...slug].astro`.
- Sourcing from `WIX_APPS` (rather than hardcoding `appDefId: "14bcded7-…"` / `pageIdentifier: "wix.blog.sub_pages.post"`) keeps these values correct if Wix changes them. `@wix/essentials` must be ≥ 1.0.10.

### Rendering the tags

In the page frontmatter, run `loadSEOTagsServiceConfig()` **in parallel** with the item fetch, then render `<SEO.Tags>` into the layout's `head` slot:

```astro
---
import { SEO } from "@wix/seo/components";
import { loadSEOTagsServiceConfig } from "@wix/seo/services";
import { seoTags } from "@wix/seo";
// ...
const seoTagsServiceConfig = await loadSEOTagsServiceConfig({
  pageUrl: Astro.url.href,
  itemType: seoTags.ItemType.BLOG_POST,        // or BLOG_CATEGORY
  itemData: { slug: Astro.params.slug! },       // key is literally "slug" for both types
});
---
<Layout ...>
  <SEO.Tags seoTagsServiceConfig={seoTagsServiceConfig} slot="head" />
  <!-- page markup -->
</Layout>
```

- `loadSEOTagsServiceConfig` resolves tags from `itemType` + `slug` alone via the Wix SEO service — it does **not** read `post.seoData` / `category.seoData` off the SDK. So the blog service (`BLOG_SETUP.md`) doesn't need to fetch `seoData`.
- Render into the existing **`head` slot** (the same slot Stores uses — see `astro/stores/PRODUCT_PAGES.md`). A standalone page that owns its own `<head>` (like the category page in §6) can drop `<SEO.Tags>` straight into the head with no slot at all.
- **`hasSeoTags` is only for a layout that emits its own default `<title>`** (the Design System's shared `Layout.astro`) — passing it makes that layout omit the default so it doesn't duplicate `<SEO.Tags>`. The reduced `BaseHead` below emits no title, so pages using it (post detail, category) don't need `hasSeoTags`.
- **SSR only** — these calls need request context. Do NOT set `prerender = true` or use `getStaticPaths()`.

### Known platform caveats (verified against a live site)

- **Post overrides resolve correctly.** A merchant's dashboard SEO title/description for a *post* flows through `loadSEOTagsServiceConfig` to the live `<head>` (and the resolver adds canonical, `og:type=article`, `article:*` times, and JSON-LD `BlogPosting`).
- **Category overrides currently do NOT resolve.** `resolve-item-seo-tags` for `BLOG_CATEGORY` returns label-derived defaults and ignores the category's stored `seoData.tags`, even though the override *is* persisted on the category record (confirmed via the Blog Categories API). The route still registers (sitemap) and renders a valid default tag set — only merchant *overrides* are dropped. This is a Wix backend behavior, not an Astro/wiring issue: the category page code is identical in shape to the (working) post page. Set expectations accordingly and don't try to "fix" it in code.
- **Auto-injection may duplicate on item routes.** Wix's automatic SEO injection (main-pages-only per spec, marked `wix-seo-tag="true"`) has been observed *also* emitting generic page-type tags (`Blog | Site`, `Category | Site`) on registered item routes, on top of `<SEO.Tags>` (marked `wix-seo-tags="true"`) — producing duplicate/conflicting `<title>`/`og:*`. Platform-side; flag it, don't paper over it in the layout.
- **Canonical protocol.** `Astro.url.href` can resolve to `http://` behind the Wix proxy, so `<SEO.Tags>`'s `pageUrl`-derived canonical/`og:url` may render `http://`. Prefer building `pageUrl` from the site's canonical `https://` origin.

### `BaseHead.astro` — global metadata only (no SEO tags)

Because `<SEO.Tags>` owns the SEO tags on item pages (and auto-injection owns them on main pages), `BaseHead` must **not** emit `<title>`/`<meta name="description">`/OG/Twitter tags of its own — those would duplicate them. Reduce it to non-SEO global metadata and expose a `head` slot:

```astro
---
import '../styles/global.css';
---

<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta name="generator" content={Astro.generator} />
<slot name="head" />
```

> If the project already has a shared `Layout.astro` with a `head` slot + `hasSeoTags` prop (the Design System phase writes one — see `astro/stores/PRODUCT_PAGES.md` § "Layout head slot"), use it for the category page instead of a blog-only `BaseHead`, and keep the blog's `BlogPost.astro` layout consistent with it.

---

## 2. Formatted Date Component (`src/components/FormattedDate.astro`)

```astro
---
interface Props {
  date: Date;
}

const { date } = Astro.props;
---

<time datetime={date.toISOString()}>
  {
    date.toLocaleDateString('en-us', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
</time>
```

---

## 3. Blog Post Layout (`src/layouts/BlogPost.astro`)

```astro
---
import BaseHead from '../components/BaseHead.astro';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
import FormattedDate from '../components/FormattedDate.astro';

interface Props {
  title: string;
  description?: string;
  pubDate: Date;
  updatedDate?: Date;
  heroImage?: string;
  tags?: Array<{ label: string; slug: string }>;
}

const { title, description, pubDate, updatedDate, heroImage, tags = [] } = Astro.props;
---

<html lang="en">
  <head>
    <BaseHead />
    <slot name="head" />
    <style is:global>
      /* All BlogPost layout styles are created by the merged pages scope.
         See references/shared/STYLING.md (Blog Post Content) for the complete
         styling contract: .hero-image, .prose, .title, .date, .tags,
         .ricos-content overrides, etc. */
    </style>
  </head>

  <body>
    <Header />
    <main>
      <article>
        <div class="hero-image">
          {heroImage && <img width={1020} height={510} src={heroImage} alt="" />}
        </div>
        <div class="prose">
          <div class="title">
            <div class="date">
              <FormattedDate date={pubDate} />
              {
                updatedDate && (
                  <div class="last-updated-on">
                    Last updated on <FormattedDate date={updatedDate} />
                  </div>
                )
              }
            </div>
            <h1>{title}</h1>
            {tags.length > 0 && (
              <div class="tags">
                {tags.map((tag) => (
                  <span class="tag">{tag.label}</span>
                ))}
              </div>
            )}
            <hr />
          </div>
          <slot />
        </div>
      </article>
    </main>
    <Footer />
  </body>
</html>
```

> Adapt `Header` and `Footer` imports to match the project's existing components. If the project uses a different layout pattern (e.g., `Layout.astro` wrapper), use that instead and incorporate the blog-specific elements (hero image, date, title, tags).

---

## 4. Blog Listing Page (`src/pages/blog/index.astro`)

```astro
---
import { queryBlogPosts } from "../../lib/blog";
import BaseHead from "../../components/BaseHead.astro";
import Footer from "../../components/Footer.astro";
import FormattedDate from "../../components/FormattedDate.astro";
import Header from "../../components/Header.astro";

const posts = await queryBlogPosts();
---

<!doctype html>
<html lang="en">
  <head>
    <BaseHead />
    <style>
      /* The merged blog-pages scope writes this route once — applying the
         listing styles and binding queryBlogPosts() data in the same pass. */
    </style>
  </head>
  <body>
    <Header />
    <main>
      <section>
        {
          posts.length === 0 ? (
            <div>There are no posts available.</div>
          ) : (
            <ul>
              {posts.map((post) => (
                <li>
                  <a href={`/blog/${post.slug}/`}>
                    {post.coverImageUrl && (
                      <img
                        width={720}
                        height={360}
                        src={post.coverImageUrl}
                        alt=""
                      />
                    )}
                    <h4 class="title">{post.title}</h4>
                    <p class="date">
                      <FormattedDate date={post.pubDate} />
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )
        }
      </section>
    </main>
    <Footer />
  </body>
</html>
```

> Adapt the layout to match the project's existing design. The key pattern is: `queryBlogPosts()` from the blog service, linking to `/blog/${post.slug}/`.

> **The listing is a main page**, not an item page — it sits at one fixed URL (`/blog`), so it gets its SEO tags from Wix's automatic injection with no code. That's why it renders the bare `<BaseHead />` (no `title`/`description`, no `wixMetadata`, no `<SEO.Tags>`). Only the post (§5) and category (§6) detail routes need the `@wix/seo` wiring. (`SITE_TITLE`/`SITE_DESCRIPTION` from `consts.ts` are still used by the RSS feed in §7.)

---

## 5. Blog Post Detail Page (`src/pages/blog/[...slug].astro`)

```astro
---
import { WIX_APPS } from "@wix/essentials";
import { SEO } from "@wix/seo/components";
import { loadSEOTagsServiceConfig } from "@wix/seo/services";
import { seoTags } from "@wix/seo";
import RicosViewer from '../../components/RicosViewer';
import { getPostBySlug } from "../../lib/blog";
import BlogPost from '../../layouts/BlogPost.astro';

// Register this route for Wix's sitemap + dashboard SEO editor.
// Reference WIX_APPS directly inside the object (see BLOG_PAGES.md § SEO).
export const wixMetadata = {
  appDefId: WIX_APPS.blogs.id,
  pageIdentifier: WIX_APPS.blogs.postPageMetadata.pageIdentifier,
  identifiers: { slug: WIX_APPS.blogs.postPageMetadata.identifiers.slug },
};

const { slug } = Astro.params;

// Resolve SEO tags in parallel with the post fetch (one fewer round trip).
const [post, seoTagsServiceConfig] = await Promise.all([
  getPostBySlug(slug!),
  loadSEOTagsServiceConfig({
    pageUrl: Astro.url.href,
    itemType: seoTags.ItemType.BLOG_POST,
    itemData: { slug: slug! },
  }),
]);

if (!post) {
  return Astro.redirect("/blog");
}
---

<BlogPost
  title={post.title}
  description={post.excerpt}
  pubDate={post.pubDate}
  heroImage={post.coverImageUrl}
  tags={post.tags}
>
  <SEO.Tags seoTagsServiceConfig={seoTagsServiceConfig} slot="head" />
  <RicosViewer client:only="react" content={post.richContent} />
</BlogPost>
```

> No `hasSeoTags` prop is needed here: the reduced `BaseHead` (§1) emits no `<title>`/`<meta description>`, so there's nothing to suppress — `<SEO.Tags>` is the only source of those tags on this page. `hasSeoTags` is only relevant if you render into the Design System's shared `Layout.astro`, which *does* emit a default title unless told not to.

Critical details:
- **`wixMetadata` export is required** — it tells the Wix platform this page is a blog post page. The `appDefId` is the Wix Blog app's ID (constant, do not change). `identifiers.slug` maps the URL param to the blog post slug.
- **`client:only="react"` is required** — `@wix/ricos` is a React component; `client:only="react"` ensures it renders only on the client, avoiding SSR issues with React-dependent code.
- **`[...slug]` (rest param)** — uses Astro's rest parameter syntax, not `[slug]`, to match the full slug path.
- **`RicosViewer`** renders the rich content from the Wix Blog editor (images, videos, text formatting, embeds, etc.) using `quickStartViewerPlugins()` for full content-type support.
- **Blog deliberately uses the React `RicosViewer`** (full feature set: galleries, polls, embedded media) — not a contradiction with CMS, which uses the lighter SSR `renderRicos` walker (`src/utils/ricos.ts`). Blog posts can carry the full Ricos feature set, so they need the React island; static CMS pages (about/faq/portfolio/team/resource) only need paragraphs + lists and avoid shipping ~80kb of React. See `references/astro/cms/CMS_FOUNDATIONS.md` § "Why not @wix/ricos?".
- **No `getStaticPaths()`** — Wix headless projects use `output: "server"` (SSR on Cloudflare Workers), so pages use `Astro.params` directly instead of static path generation.
- **404 handling** — `getPostBySlug` returns `null` for missing posts; redirect to `/blog` listing.
- **Ricos color overrides** — The BlogPost layout's `<style is:global>` block includes `.ricos-content` overrides that force `var(--color-text)` on all Ricos elements. Without these, blog text is invisible on dark themes.

---

## 6. Blog Category Page (`src/pages/category/[slug].astro`)

An item page that lists the posts in one category. It resolves its SEO tags exactly like the post page (§5), but there's no rich body to render — just the category's title/description and its post list. Requires the `getCategoryBySlug` + `getPostsByCategory` helpers from `BLOG_SETUP.md` § "Category Helpers".

```astro
---
import { WIX_APPS } from "@wix/essentials";
import { SEO } from "@wix/seo/components";
import { loadSEOTagsServiceConfig } from "@wix/seo/services";
import { seoTags } from "@wix/seo";
import BaseHead from "../../components/BaseHead.astro";
import Header from "../../components/Header.astro";
import Footer from "../../components/Footer.astro";
import FormattedDate from "../../components/FormattedDate.astro";
import { getCategoryBySlug, getPostsByCategory } from "../../lib/blog";

// Register this route for Wix's sitemap + dashboard SEO editor.
export const wixMetadata = {
  appDefId: WIX_APPS.blogs.id,
  pageIdentifier: WIX_APPS.blogs.categoryPageMetadata.pageIdentifier,
  identifiers: { slug: WIX_APPS.blogs.categoryPageMetadata.identifiers.slug },
};

const { slug } = Astro.params;

const [category, seoTagsServiceConfig] = await Promise.all([
  getCategoryBySlug(slug!),
  loadSEOTagsServiceConfig({
    pageUrl: Astro.url.href,
    itemType: seoTags.ItemType.BLOG_CATEGORY,
    itemData: { slug: slug! },
  }),
]);

if (!category) {
  return Astro.redirect("/blog");
}

const categoryPosts = await getPostsByCategory(category.id);
---

<!doctype html>
<html lang="en">
  <head>
    <BaseHead />
    <SEO.Tags seoTagsServiceConfig={seoTagsServiceConfig} />
  </head>
  <body>
    <Header />
    <main>
      <section>
        <h1>{category.label}</h1>
        {category.description && <p>{category.description}</p>}
        {
          categoryPosts.length === 0 ? (
            <div>No posts in this category yet.</div>
          ) : (
            <ul>
              {categoryPosts.map((post) => (
                <li>
                  <a href={`/blog/${post.slug}/`}>
                    {post.coverImageUrl && (
                      <img width={720} height={360} src={post.coverImageUrl} alt="" />
                    )}
                    <h4 class="title">{post.title}</h4>
                    <p class="date">
                      <FormattedDate date={post.pubDate} />
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )
        }
      </section>
    </main>
    <Footer />
  </body>
</html>
```

Critical details:
- **`wixMetadata` uses `categoryPageMetadata`** (not `postPageMetadata`) — `pageIdentifier` `wix.blog.sub_pages.category`, slug token `BLOG.CATEGORY.SLUG`. Same `appDefId` (`WIX_APPS.blogs.id`) as the post page.
- **`itemType: seoTags.ItemType.BLOG_CATEGORY`** in `loadSEOTagsServiceConfig` — the `itemData` key is still literally `slug`.
- **This page owns its own `<head>`**, so `<SEO.Tags>` goes directly inside `<head>` with **no `slot`** (contrast §5, where it's a child of the `BlogPost` layout and uses `slot="head"`). `BaseHead` sits alongside it for the non-SEO global metadata.
- **404 handling** — `getCategoryBySlug` returns `null` for a missing slug; redirect to `/blog`.
- **Route param is `slug`** (`[slug].astro`), matching the `identifiers.slug` key in `wixMetadata`.
- **Known limitation (Wix backend):** merchant SEO *overrides* for categories don't currently resolve through `loadSEOTagsServiceConfig` — the page still gets a valid default tag set (title = category name) and registers in the sitemap, but a custom category title set in the dashboard won't appear on the live page. See §1 "Known platform caveats." Wire it exactly as shown regardless; the defect is server-side, not in this code.

Adapt `Header`/`Footer`/markup to the project's design, mirroring the listing page (§4).

---

## 7. RSS Feed (`src/pages/rss.xml.js`)

```javascript
import rss from '@astrojs/rss';
import { queryBlogPosts } from '../lib/blog';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';

export async function GET(context) {
  const posts = await queryBlogPosts();
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts.map((post) => ({
      title: post.title,
      pubDate: post.pubDate,
      description: post.excerpt,
      link: `/blog/${post.slug}/`,
    })),
  });
}
```

> Requires the `site` property in `astro.config.mjs` (set in BLOG_SETUP.md step 1).