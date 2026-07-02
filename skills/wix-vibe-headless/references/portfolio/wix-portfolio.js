import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Portfolio is a read-only showcase. The model is a 3-level tree:
 *   Collection (a gallery / grouping)  →  Project (a single piece of work)  →  Project Item (one image or video).
 * A project can belong to several collections (`project.collectionIds`). The merchant
 * manages all content in the Wix dashboard — this client only reads it.
 *
 * Hidden entities (`hidden: true` on collections/projects) are editor-only and must NOT be
 * shown to visitors. Every list helper here filters `hidden` out for you.
 */

/**
 * Wix Portfolio Collection — key fields for a collections gallery.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/collection-object.md
 *
 *   id                              {string}   Collection GUID.
 *   title                           {string}   Display title.
 *   description                     {string}   Description (plain text).
 *   slug                            {string}   URL slug for routing.
 *   hidden                          {boolean}  Editor-only when true — never show to visitors.
 *   sortOrder                       {number}   Display order index (ascending).
 *   coverImage.imageInfo            {object}   Cover image: { id, url, height, width, altText, filename }.
 *   coverImage.focalPoint           {object}   { x, y } focal point for cropping.
 *   url                             {object}   { relativePath, url } — only when includePageUrl=true.
 *   createdDate / updatedDate       {string}   ISO date-time.
 *
 * NOTE: `coverImage.imageInfo.url` is a Wix Media URL. It may be a static
 * `https://static.wixstatic.com/...` URL (render directly) or a `wix:image://` URI for some
 * legacy assets — prefer `imageInfo.url` and render it as-is when it starts with "http".
 */

/**
 * Wix Portfolio Project — key fields for a project grid + project page header.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/project-object.md
 *
 *   id                              {string}   Project GUID.
 *   title                           {string}   Display title.
 *   description                     {string}   Description (plain text).
 *   slug                            {string}   URL slug for routing.
 *   hidden                          {boolean}  Editor-only when true — never show to visitors.
 *   collectionIds                   {string[]} GUIDs of the collections this project belongs to.
 *   details                         {array}    Labeled metadata rows. Each entry is ONE-OF text|link:
 *                                              [{
 *                                                label,                 // row label, e.g. "Client", "Year"
 *                                                text,                  // present for plain-text details
 *                                                link: { text, url, target }  // present for link details ('_blank' | '_self')
 *                                              }]
 *   coverImage.imageInfo            {object}   Cover image (ONE-OF with coverVideo):
 *                                              { id, url, height, width, altText, filename }.
 *   coverVideo.videoInfo            {object}   Cover video (ONE-OF with coverImage):
 *                                              { id, url, filename, posters: [Image],
 *                                                resolutions: [{ url, height, width, format, quality, filename }] }.
 *   url                             {object}   { relativePath, url } — only when includePageUrl=true.
 *   createdDate / updatedDate       {string}   ISO date-time.
 *
 * A project carries only its cover here. The full media gallery lives in its Project Items —
 * fetch them with listProjectItems(project.id).
 */

/**
 * Wix Portfolio Project Item — one media tile inside a project (image or video).
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/project-items/project-item-object.md
 *
 *   id                              {string}   Project item GUID.
 *   projectId                       {string}   Parent project GUID.
 *   sortOrder                       {number}   Display order index (ascending).
 *   title                           {string}   Item title (may be empty).
 *   description                     {string}   Item description (may be empty).
 *   type                            {string}   "IMAGE" | "VIDEO" | "UNDEFINED".
 *   image.imageInfo                 {object}   Present when type === "IMAGE":
 *                                              { id, url, height, width, altText, filename } (+ focalPoint).
 *   video.videoInfo                 {object}   Present when type === "VIDEO":
 *                                              { id, url, filename, posters: [Image],
 *                                                resolutions: [{ url, height, width, format, quality, filename }] }.
 *   link                            {object}   Optional click-through: { text, url, target } ('_blank' | '_self').
 *   createdDate / updatedDate       {string}   ISO date-time.
 *
 * Render IMAGE items from image.imageInfo.url; render VIDEO items from the first
 * video.videoInfo.resolutions[] entry (highest quality first) with a poster from
 * video.videoInfo.posters[0].
 */

const COLLECTIONS_QUERY_URL = "/portfolio/v1/collections/query";
const PROJECTS_QUERY_URL = "/portfolio/v1/projects/query";

/**
 * Query visible portfolio collections (one page), sorted by their dashboard order.
 * https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/query-collections.md
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ collections: object[], nextCursor: string|null }>}
 */
export async function queryCollections({ limit = 100, cursor } = {}) {
  const res = await wixApiRequest(COLLECTIONS_QUERY_URL, {
    method: "POST",
    body: {
      includePageUrl: true,
      query: cursor
        ? { cursorPaging: { limit, cursor } }
        : {
            filter: { hidden: false },
            sort: [{ fieldName: "sortOrder", order: "ASC" }],
            cursorPaging: { limit },
          },
    },
  });
  return {
    collections: res?.collections ?? [],
    nextCursor: res?.metadata?.cursors?.next ?? null,
  };
}

/**
 * Get a single visible collection by its URL slug. Returns null if not found / hidden.
 * Portfolio has no get-by-slug endpoint, so this queries with a slug filter.
 * https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/query-collections.md
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getCollectionBySlug(slug) {
  const res = await wixApiRequest(COLLECTIONS_QUERY_URL, {
    method: "POST",
    body: {
      includePageUrl: true,
      query: { filter: { slug, hidden: false }, cursorPaging: { limit: 1 } },
    },
  });
  return res?.collections?.[0] ?? null;
}

/**
 * Total number of visible collections. Used for empty-state logic
 * (0 → prompt the user to add collections in their Wix dashboard).
 * @returns {Promise<number>}
 */
export async function countCollections() {
  const res = await wixApiRequest(COLLECTIONS_QUERY_URL, {
    method: "POST",
    body: { query: { filter: { hidden: false }, cursorPaging: { limit: 100 } } },
  });
  return res?.metadata?.total ?? (res?.collections?.length ?? 0);
}

/**
 * Query visible projects (one page), sorted newest-first. Use for an "all work" gallery.
 * https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/query-projects.md
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ projects: object[], nextCursor: string|null }>}
 */
export async function queryProjects({ limit = 100, cursor } = {}) {
  const res = await wixApiRequest(PROJECTS_QUERY_URL, {
    method: "POST",
    body: {
      includePageUrl: true,
      query: cursor
        ? { cursorPaging: { limit, cursor } }
        : {
            filter: { hidden: false },
            sort: [{ fieldName: "createdDate", order: "DESC" }],
            cursorPaging: { limit },
          },
    },
  });
  return {
    projects: res?.projects ?? [],
    nextCursor: res?.metadata?.cursors?.next ?? null,
  };
}

/**
 * Query the visible projects that belong to a collection (one page), in dashboard order.
 * Filters on `collectionIds` with `$hasSome`.
 * https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/query-projects.md
 * @param {string} collectionId  `collection.id` from queryCollections / getCollectionBySlug.
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ projects: object[], nextCursor: string|null }>}
 */
export async function queryProjectsByCollection(collectionId, { limit = 100, cursor } = {}) {
  const res = await wixApiRequest(PROJECTS_QUERY_URL, {
    method: "POST",
    body: {
      includePageUrl: true,
      query: cursor
        ? { cursorPaging: { limit, cursor } }
        : {
            filter: { hidden: false, collectionIds: { $hasSome: [collectionId] } },
            cursorPaging: { limit },
          },
    },
  });
  return {
    projects: res?.projects ?? [],
    nextCursor: res?.metadata?.cursors?.next ?? null,
  };
}

/**
 * Get a single visible project by its URL slug. Returns null if not found / hidden.
 * Portfolio has no get-by-slug endpoint, so this queries with a slug filter.
 * https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/query-projects.md
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getProjectBySlug(slug) {
  const res = await wixApiRequest(PROJECTS_QUERY_URL, {
    method: "POST",
    body: {
      includePageUrl: true,
      query: { filter: { slug, hidden: false }, cursorPaging: { limit: 1 } },
    },
  });
  return res?.projects?.[0] ?? null;
}

/**
 * Get a single project by its GUID. Returns null if not found.
 * Use when you already hold a project id (e.g. from a list) rather than a slug.
 * https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/get-project.md
 * @param {string} projectId
 * @returns {Promise<object|null>}
 */
export async function getProject(projectId) {
  try {
    const res = await wixApiRequest(`/portfolio/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "GET",
      query: { includePageUrl: "true" },
    });
    return res?.project ?? null;
  } catch {
    return null;
  }
}

/**
 * List all media items (images/videos) of a project, in dashboard order.
 * This is the project's gallery — call it on the project detail screen.
 * https://dev.wix.com/docs/api-reference/business-solutions/portfolio/project-items/list-project-items.md
 * @param {string} projectId  `project.id`.
 * @param {{ limit?: number, offset?: number }} [options]  Project items use offset paging, not cursors.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listProjectItems(projectId, { limit = 100, offset = 0 } = {}) {
  const res = await wixApiRequest(`/portfolio/v1/projectItems/${encodeURIComponent(projectId)}/items`, {
    method: "GET",
    query: { "paging.limit": String(limit), "paging.offset": String(offset) },
  });
  const items = (res?.items ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return { items, total: res?.metadata?.total ?? items.length };
}
