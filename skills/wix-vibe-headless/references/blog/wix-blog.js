import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Blog Post — key fields.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/post-object.md
 *
 *   id {string}, title {string}, slug {string},
 *   excerpt {string} — short summary ≤500 chars (use for cards),
 *   firstPublishedDate {string} — ISO date, default sort key DESC,
 *   pinned {boolean}, featured {boolean}, minutesToRead {number},
 *   categoryIds {string[]}, tagIds {string[]}, hashtags {string[]},
 *   media {object} — cover image at media.wixMedia.image { id, url, height, width, filename, altText? };
 *     media.wixMedia.image.url is a ready-to-use https URL (returned by default, incl. the list query).
 *     media.displayed / media.custom are booleans,
 *   contentText {string} — plain text body (CONTENT_TEXT fieldset; getPostBySlug requests it),
 *   richContent {object} — Ricos document (RICH_CONTENT fieldset; getPostBySlug requests it),
 *   url {object} — { base, path } live post URL (URL fieldset; build full link as base+path)
 * Available fieldsets: "URL" | "CONTENT_TEXT" | "RICH_CONTENT" | "METRICS" | "SEO"
 *
 * Category: { id, label, slug, description, postCount, displayPosition,
 *   coverImage: { id, url, height, width, altText }, url: { base, path } }
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/category-object.md
 *
 * Tag: { id, label, slug, publishedPostCount, url: { base, path } }
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/tag-object.md
 */

const POST_LIST_FIELDSETS = ["URL"];
const POST_FULL_FIELDSETS = ["URL", "CONTENT_TEXT", "RICH_CONTENT"];

/**
 * Query published posts (one page), newest first (pinned posts lead).
 * Pass `nextCursor` from a previous call back as `cursor` to load the next page.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function queryPosts({ limit = 100, cursor } = {}) {
  const res = await wixApiRequest("/v3/posts/query", {
    method: "POST",
    body: {
      fieldsets: POST_LIST_FIELDSETS,
      query: {
        cursorPaging: cursor ? { limit, cursor } : { limit },
        sort: [{ fieldName: "firstPublishedDate", order: "DESC" }],
      },
    },
  });
  return {
    posts: res?.posts ?? [],
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Fetch one post by its URL slug, with full content (contentText + richContent + url).
 * Returns null if no post matches the slug — show a not-found state, never invent a post.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-by-slug.md
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getPostBySlug(slug) {
  try {
    const res = await wixApiRequest(`/v3/posts/slugs/${encodeURIComponent(slug)}`, {
      method: "GET",
      query: { fieldsets: POST_FULL_FIELDSETS },
    });
    return res?.post ?? null;
  } catch {
    return null;
  }
}

/**
 * Query published posts in a given category (one page), newest first.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
 * @param {string} categoryId  Category GUID (`category.id` from queryCategories / getCategoryBySlug).
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function queryPostsByCategory(categoryId, { limit = 100, cursor } = {}) {
  const res = await wixApiRequest("/v3/posts/query", {
    method: "POST",
    body: {
      fieldsets: POST_LIST_FIELDSETS,
      query: {
        ...(cursor ? {} : { filter: { categoryIds: { $hasSome: [categoryId] } } }),
        cursorPaging: cursor ? { limit, cursor } : { limit },
        sort: [{ fieldName: "firstPublishedDate", order: "DESC" }],
      },
    },
  });
  return {
    posts: res?.posts ?? [],
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Query published posts with a given tag (one page), newest first.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
 * @param {string} tagId  Tag GUID (`tag.id` from queryTags / getTagBySlug).
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function queryPostsByTag(tagId, { limit = 100, cursor } = {}) {
  const res = await wixApiRequest("/v3/posts/query", {
    method: "POST",
    body: {
      fieldsets: POST_LIST_FIELDSETS,
      query: {
        ...(cursor ? {} : { filter: { tagIds: { $hasSome: [tagId] } } }),
        cursorPaging: cursor ? { limit, cursor } : { limit },
        sort: [{ fieldName: "firstPublishedDate", order: "DESC" }],
      },
    },
  });
  return {
    posts: res?.posts ?? [],
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Total number of published posts. Used for empty-state logic (0 → prompt the user to add
 * posts in their Wix dashboard). Never invent posts.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-total-posts.md
 * @returns {Promise<number>}
 */
export async function getTotalPosts() {
  const res = await wixApiRequest("/blog/v2/stats/posts/total", { method: "GET" });
  return res?.total ?? 0;
}

/**
 * Query blog categories (one page), ordered by menu display position.
 * Categories use offset paging (max 100 per page); most blogs have well under 100.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/query-categories.md
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ categories: object[], total: number }>}
 */
export async function queryCategories({ limit = 100, offset = 0 } = {}) {
  const res = await wixApiRequest("/blog/v3/categories/query", {
    method: "POST",
    body: {
      fieldsets: ["URL"],
      query: {
        paging: { limit, offset },
        sort: [{ fieldName: "displayPosition", order: "ASC" }],
      },
    },
  });
  return {
    categories: res?.categories ?? [],
    total: res?.pagingMetadata?.total ?? (res?.categories?.length ?? 0),
  };
}

/**
 * Get one category by its URL slug. Returns null if not found.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/get-category-by-slug.md
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getCategoryBySlug(slug) {
  try {
    const res = await wixApiRequest(`/blog/v3/categories/slugs/${encodeURIComponent(slug)}`, {
      method: "GET",
      query: { fieldsets: ["URL"] },
    });
    return res?.category ?? null;
  } catch {
    return null;
  }
}

/**
 * Query blog tags (one page), most-used first.
 * Tags use offset paging (max 100 per page).
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags.md
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ tags: object[], total: number }>}
 */
export async function queryTags({ limit = 100, offset = 0 } = {}) {
  const res = await wixApiRequest("/v3/tags/query", {
    method: "POST",
    body: {
      fieldsets: ["URL"],
      query: {
        paging: { limit, offset },
        sort: [{ fieldName: "publishedPostCount", order: "DESC" }],
      },
    },
  });
  return {
    tags: res?.tags ?? [],
    total: res?.pagingMetadata?.total ?? (res?.tags?.length ?? 0),
  };
}

/**
 * Get one tag by its URL slug. Returns null if not found.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/get-tag-by-slug.md
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getTagBySlug(slug) {
  try {
    const res = await wixApiRequest(`/v3/tags/slugs/${encodeURIComponent(slug)}`, {
      method: "GET",
      query: { fieldsets: ["URL"] },
    });
    return res?.tag ?? null;
  } catch {
    return null;
  }
}
