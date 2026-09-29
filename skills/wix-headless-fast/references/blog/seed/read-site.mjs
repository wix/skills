// What the blog holds: posts, categories, tags.
//   node <SKILL_ROOT>/references/blog/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/blog";

await runReader({
  vertical: "blog",
  appId: BLOG_APP_ID,
  async read(api, { limit }) {
    const posts = await api.call({ path: "/v3/posts/query", body: { fieldsets: ["URL"], query: { paging: { limit } } }, docs: `${D}/posts-stats/query-posts` });
    const cats = await api.tryCall({ path: "/blog/v3/categories/query", body: { query: { paging: { limit: 100 } } }, docs: `${D}/category/query-categories` });
    const tags = await api.tryCall({ path: "/v3/tags/query", body: { query: { paging: { limit: 100 } } }, docs: `${D}/tags/query-tags` });
    return {
      postCount: posts.metaData?.total ?? posts.pagingMetadata?.total ?? (posts.posts ?? []).length,
      posts: (posts.posts ?? []).map((p) => ({ title: p.title, slug: p.slug, published: p.firstPublishedDate ?? null, cover: !!p.coverMedia?.image, categories: (p.categoryIds ?? []).length, tags: (p.tagIds ?? []).length, minutesToRead: p.minutesToRead ?? null })),
      categories: (cats?.categories ?? []).map((c) => ({ id: c.id, label: c.label, slug: c.slug, postCount: c.postCount ?? null })),
      tags: (tags?.tags ?? []).map((t) => ({ id: t.id, label: t.label, postCount: t.postCount ?? null })),
    };
  },
});
