// Portfolio reads (Wix Portfolio v1) over the SDK — the only file that touches raw portfolio
// entities on this transport. Read-only vertical: no cart, no checkout, no @wix/ecom. Everything
// it returns is a plain DTO from ./types. The rules and mappers live in ./portfolio-core (shared
// with the REST twin in references/portfolio/rest/); this file is the transport only. Copy as-is;
// extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/list-collections.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/list-projects.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/project-items/list-project-items.md
// docs: https://dev.wix.com/docs/sdk/core-modules/sdk/media.md
import {
  collections as collectionsModule,
  projects as projectsModule,
  projectItems as projectItemsModule,
} from "@wix/portfolio";
import { media, VideoResolution } from "@wix/sdk";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import {
  galleryItems,
  visibleCollection,
  visibleCollections,
  visibleProject,
  visibleProjects,
  type Raw,
  type VideoSrc,
} from "./portfolio-core";
import type { CollectionSummary, GalleryItem, ProjectDetail, ProjectSummary } from "./types";

const collections = wixModule(collectionsModule);
const projects = wixModule(projectsModule);
const projectItems = wixModule(projectItemsModule);

// The SDK types coverImage.imageInfo / item.image.imageInfo as a bare wix:image:// STRING and
// videoInfo as a bare wix:video:// string; getVideoUrl derives the mp4 rendition + poster.
const videoSrc: VideoSrc = (ref) => {
  try {
    const v = media.getVideoUrl(ref, VideoResolution.MID);
    return { url: v.url, thumbnail: v.thumbnail };
  } catch {
    return null;
  }
};

/** List visible collections in the owner's dashboard order (sortOrder). */
export async function fetchCollections({ limit = 100 } = {}): Promise<CollectionSummary[]> {
  const res = await collections.listCollections({ paging: { limit } });
  return visibleCollections((res.collections ?? []) as Raw[], imgSrc);
}

/** Fetch one visible collection by its URL slug. Null when not found or hidden. */
export async function fetchCollectionBySlug(slug: string): Promise<CollectionSummary | null> {
  const res = await collections.queryCollections().eq("slug", slug).limit(1).find();
  return visibleCollection(res.items?.[0] as Raw | undefined, imgSrc);
}

/** List visible projects (list order), optionally only one collection's. */
export async function fetchProjects({
  collectionId,
  limit = 100,
}: { collectionId?: string; limit?: number } = {}): Promise<ProjectSummary[]> {
  const res = await projects.listProjects({ paging: { limit } });
  return visibleProjects((res.projects ?? []) as Raw[], collectionId, imgSrc, videoSrc);
}

/** Fetch one visible project by its URL slug. Null when not found or hidden. */
export async function fetchProjectBySlug(slug: string): Promise<ProjectDetail | null> {
  const res = await projects.queryProjects().eq("slug", slug).limit(1).find();
  return visibleProject(res.items?.[0] as Raw | undefined, imgSrc, videoSrc);
}

/**
 * A project's media gallery in dashboard order (item sortOrder). IMAGE and VIDEO items only —
 * UNDEFINED and unresolvable media are dropped. First arg is the project _id (positional).
 */
export async function fetchProjectGallery(projectId: string): Promise<GalleryItem[]> {
  const res = await projectItems.listProjectItems(projectId, { paging: { limit: 100 } });
  return galleryItems((res.items ?? []) as Raw[], imgSrc, videoSrc);
}
