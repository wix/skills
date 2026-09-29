// What the blog holds: posts, categories, tags.
//   node <SKILL_ROOT>/templates/blog/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/blog";

// A V3 post's cover lives at media.wixMedia.image (an image), media.wixMedia.videoV2 (a Wix video),
// or media.embedMedia (YouTube/Vimeo); media.displayed === false is a cover the author hid.
const hasCover = (p) => p.media?.displayed !== false && !!(p.media?.wixMedia?.image || p.media?.wixMedia?.videoV2 || p.media?.embedMedia?.video?.url);

await runReader({
  vertical: "blog",
  appId: BLOG_APP_ID,
  async read(api, { limit }) {
    // The public gateway serves the blog under /blog/v3/... (the SDK's mapping also accepts the bare /v3/... alias).
    const posts = await api.call({ path: "/blog/v3/posts/query", body: { fieldsets: ["METRICS"], query: { paging: { limit } } }, docs: `${D}/posts-stats/query-posts` });
    const cats = await api.tryCall({ path: "/blog/v3/categories/query", body: { query: { paging: { limit: 100 } } }, docs: `${D}/category/query-categories` });
    const tags = await api.tryCall({ path: "/blog/v3/tags/query", body: { query: { paging: { limit: 100 } } }, docs: `${D}/tags/query-tags` });
    return {
      postCount: posts.metaData?.total ?? posts.pagingMetadata?.total ?? (posts.posts ?? []).length,
      posts: (posts.posts ?? []).map((p) => ({
        title: p.title, slug: p.slug, published: p.firstPublishedDate ?? null, pinned: p.pinned === true, featured: p.featured === true,
        cover: hasCover(p), author: p.memberId ?? null, commentingEnabled: p.commentingEnabled === true,
        categories: (p.categoryIds ?? []).length, tags: (p.tagIds ?? []).length, related: (p.relatedPostIds ?? []).length,
        minutesToRead: p.minutesToRead ?? null, views: p.metrics?.views ?? null, likes: p.metrics?.likes ?? null, comments: p.metrics?.comments ?? null,
      })),
      categories: (cats?.categories ?? []).map((c) => ({ id: c.id, label: c.label, slug: c.slug, postCount: c.postCount ?? null })),
      // publishedPostCount counts what visitors see; postCount also counts drafts.
      tags: (tags?.tags ?? []).map((t) => ({ id: t.id, label: t.label, slug: t.slug, postCount: t.publishedPostCount ?? t.postCount ?? null })),
    };
  },
});
