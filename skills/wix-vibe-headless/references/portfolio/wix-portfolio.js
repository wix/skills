import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Portfolio — read-only showcase. 3-level tree:
 *   Collection → Project → Project Item (image or video)
 * Hidden entities (hidden: true) are editor-only — every helper here filters them out.
 *
 * Collection: { id, title, description, slug, hidden, sortOrder,
 *   coverImage.imageInfo: { id, url, height, width, altText },
 *   url: { relativePath, url } (only when includePageUrl=true) }
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/collection-object.md
 *
 * Project: { id, title, description, slug, hidden, collectionIds {string[]},
 *   details {array} — [{ label, text? OR link: { text, url, target } }],
 *   coverImage.imageInfo: { id, url, height, width, altText } (ONE-OF with coverVideo),
 *   coverVideo.videoInfo: { id, url, posters, resolutions },
 *   url: { relativePath, url } (only when includePageUrl=true) }
 * Full media gallery is in Project Items — fetch with listProjectItems(project.id).
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/project-object.md
 *
 * Project Item: { id, projectId, sortOrder, title, description,
 *   type "IMAGE"|"VIDEO"|"UNDEFINED",
 *   image.imageInfo: { id, url, height, width, altText } (when IMAGE),
 *   video.videoInfo: { id, url, posters, resolutions } (when VIDEO; render first resolution),
 *   link: { text, url, target } }
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/project-items/project-item-object.md
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
