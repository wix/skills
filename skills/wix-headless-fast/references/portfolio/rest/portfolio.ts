// Portfolio reads over REST — the twin of app/wix/portfolio/portfolio.ts. Same exports, same DTOs;
// the rules and mappers come from portfolio-core (the SAME file the SDK transport uses, deployed
// flat next to this one by deploy.mjs --stack static), so this file is only the transport: one
// fetch with a literal URL and body per function. Every call here is a public read, safe from a
// browser with a visitor token. Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/list-collections.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/query-collections.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/list-projects.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/query-projects.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/project-items/list-project-items.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import {
  galleryItems,
  visibleCollection,
  visibleCollections,
  visibleProject,
  visibleProjects,
  type Raw,
  type VideoSrc,
} from "./portfolio-core.js";
import type { CollectionSummary, GalleryItem, ProjectDetail, ProjectSummary } from "./types.js";

// REST never returns the bare wix:video:// string — videoInfo arrives as { resolutions, posters },
// which the core reads directly. A string here has no resolver on this transport → dropped.
const videoSrc: VideoSrc = () => null;

/** Visible collections in dashboard order.  GET /portfolio/v1/collections?paging.limit=N → { collections } */
export async function fetchCollections({ limit = 100 } = {}): Promise<CollectionSummary[]> {
  const res = await wixRequest<Raw>("/portfolio/v1/collections", { method: "GET", query: { "paging.limit": String(limit) } });
  return visibleCollections((res?.collections ?? []) as Raw[], imgSrc);
}

/**
 * One visible collection by URL slug; null when missing or hidden → a real 404.
 * POST /portfolio/v1/collections/query  { query: { filter: { slug }, cursorPaging: { limit: 1 } } } → { collections }
 */
export async function fetchCollectionBySlug(slug: string): Promise<CollectionSummary | null> {
  const res = await wixRequest<Raw>("/portfolio/v1/collections/query", {
    body: { query: { filter: { slug }, cursorPaging: { limit: 1 } } },
  });
  return visibleCollection(res?.collections?.[0] as Raw | undefined, imgSrc);
}

/** Visible projects in list order, optionally one collection's.  GET /portfolio/v1/projects?paging.limit=N → { projects } */
export async function fetchProjects({
  collectionId,
  limit = 100,
}: { collectionId?: string; limit?: number } = {}): Promise<ProjectSummary[]> {
  const res = await wixRequest<Raw>("/portfolio/v1/projects", { method: "GET", query: { "paging.limit": String(limit) } });
  return visibleProjects((res?.projects ?? []) as Raw[], collectionId, imgSrc, videoSrc);
}

/**
 * One visible project with its details rows by URL slug; null when missing or hidden.
 * POST /portfolio/v1/projects/query  { query: { filter: { slug }, cursorPaging: { limit: 1 } } } → { projects }
 */
export async function fetchProjectBySlug(slug: string): Promise<ProjectDetail | null> {
  const res = await wixRequest<Raw>("/portfolio/v1/projects/query", {
    body: { query: { filter: { slug }, cursorPaging: { limit: 1 } } },
  });
  return visibleProject(res?.projects?.[0] as Raw | undefined, imgSrc, videoSrc);
}

/**
 * A project's gallery in dashboard order; IMAGE and VIDEO items only.
 * GET /portfolio/v1/projectItems/{projectId}/items?paging.limit=100 → { items }
 */
export async function fetchProjectGallery(projectId: string): Promise<GalleryItem[]> {
  const res = await wixRequest<Raw>(`/portfolio/v1/projectItems/${encodeURIComponent(projectId)}/items`, {
    method: "GET",
    query: { "paging.limit": "100" },
  });
  return galleryItems((res?.items ?? []) as Raw[], imgSrc, videoSrc);
}
