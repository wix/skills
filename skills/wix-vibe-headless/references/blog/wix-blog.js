import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Blog Post — key fields for building a blog reader.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/post-object.md
 *
 *   id                         {string}   Post GUID.
 *   title                      {string}   Post title.
 *   excerpt                    {string}   Short summary (≤500 chars). Auto-extracted from the
 *                                         content if the author didn't set one. Use for cards.
 *   slug                       {string}   URL slug for routing (pass to getPostBySlug).
 *   firstPublishedDate         {string}   ISO date — when first published. Default sort key (DESC).
 *   lastPublishedDate          {string}   ISO date — when last updated.
 *   pinned                     {boolean}  Pinned posts sort to the top of the feed.
 *   featured                   {boolean}  Whether the author flagged the post as featured.
 *   minutesToRead              {number}   Estimated reading time (auto-calculated).
 *   categoryIds                {string[]} Category GUIDs. Resolve labels via queryCategories.
 *   tagIds                     {string[]} Tag GUIDs. Resolve labels via queryTags.
 *   hashtags                   {string[]} Inline hashtags used in the post.
 *   heroImage                  {object}   Cover image — THE field with an actual image URL:
 *                                         { id, url, height, width, altText, filename }.
 *                                         `url` is a ready-to-use https image URL. Use it as the
 *                                         card thumbnail / post header image. May be absent.
 *   media                      {object}   Cover-media METADATA only — { displayed, custom, altText }.
 *                                         NOTE: this field carries NO image URL. When media.custom
 *                                         is false the cover is the first image inside richContent.
 *                                         For a thumbnail use heroImage.url (above); fall back to the
 *                                         first IMAGE node in richContent if heroImage is missing.
 *   contentText                {string}   Full post body as PLAIN TEXT. Returned only when the
 *                                         CONTENT_TEXT fieldset is requested (getPostBySlug does).
 *                                         Newlines separate paragraphs — split on "\n" to render.
 *   richContent                {object}   Full post body as a Ricos rich-content document
 *                                         ({ nodes, metadata, documentStyle }). Returned only when
 *                                         the RICH_CONTENT fieldset is requested (getPostBySlug does).
 *                                         Render with a Ricos renderer for images/embeds/formatting.
 *                                         Ricos document reference: https://dev.wix.com/docs/ricos/api-reference/ricos-document
 *   url                        {object}   Live post URL on the Wix site — { base, path }. Returned
 *                                         only when the URL fieldset is requested. Build the full
 *                                         link as `url.base + url.path`. Use for canonical/share links.
 *   seoData                    {object}   SEO tags/settings. Returned only with the SEO fieldset.
 *   memberId                   {string}   GUID of the post author (a site member).
 *   language                   {string}   IETF BCP 47 language code (e.g. "en").
 *
 * Available fieldsets (pass in `fieldsets` to enrich the response):
 *   "URL" | "CONTENT_TEXT" | "RICH_CONTENT" | "METRICS" | "SEO" | "CONTACT_ID" | "REFERENCE_ID"
 */

/**
 * Wix Blog Category — key fields for a category menu / landing page.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/category-object.md
 *
 *   id               {string}   Category GUID. Pass to queryPostsByCategory.
 *   label            {string}   Display name shown in the category menu.
 *   slug             {string}   URL slug for routing (pass to getCategoryBySlug).
 *   description      {string}   Optional category description (≤500 chars).
 *   postCount        {number}   Number of posts in the category. Use to hide empty categories.
 *   displayPosition  {number}   Menu order (ascending). -1 means "show at the end".
 *   coverImage       {object}   { id, url, height, width, altText, filename } — may be absent.
 *   url              {object}   { base, path } — live category page URL. Only with the URL fieldset.
 */

/**
 * Wix Blog Tag — key fields for a tag chip / tag landing page.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/tag-object.md
 *
 *   id                  {string}   Tag GUID. Pass to queryPostsByTag.
 *   label               {string}   Tag display label.
 *   slug                {string}   URL slug for routing (pass to getTagBySlug).
 *   publishedPostCount  {number}   Number of published posts with this tag.
 *   url                 {object}   { base, path } — live tag page URL. Only with the URL fieldset.
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
