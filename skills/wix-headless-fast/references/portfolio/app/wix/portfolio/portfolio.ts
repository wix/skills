// Portfolio reads (Wix Portfolio v1) — the only file that touches raw portfolio entities.
// Read-only vertical: no cart, no checkout, no @wix/ecom. Everything it returns is a plain
// DTO from ./types. Copy as-is; extend by adding functions, not by editing these.
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
import type {
  CollectionSummary,
  GalleryItem,
  ProjectDetail,
  ProjectDetailRow,
  ProjectSummary,
} from "./types";

const collections = wixModule(collectionsModule);
const projects = wixModule(projectsModule);
const projectItems = wixModule(projectItemsModule);

type Raw = Record<string, any>;

// The SDK types coverImage.imageInfo / item.image.imageInfo as a bare wix:image:// STRING
// (the REST docs show an object with .url — the package wins); imgSrc resolves either shape.

// videoInfo is likewise a bare wix:video:// string; getVideoUrl derives the mp4 rendition +
// poster (a wix:image:// string → imgSrc again). 720p is the standard transcode. Tolerates
// the REST-shaped object ({ resolutions, posters }) in case a surface returns it at runtime.
function toVideo(value: unknown): { videoUrl: string | null; posterUrl: string } {
  if (typeof value === "string" && value.startsWith("wix:video://")) {
    try {
      const v = media.getVideoUrl(value, VideoResolution.MID);
      return { videoUrl: v.url, posterUrl: imgSrc(v.thumbnail, 1200, 675) };
    } catch {
      return { videoUrl: null, posterUrl: "" };
    }
  }
  const raw = value as Raw | null | undefined;
  const url = raw?.resolutions?.[0]?.url;
  return {
    videoUrl: typeof url === "string" ? url : null,
    posterUrl: imgSrc(raw?.posters?.[0], 1200, 675),
  };
}

function toCollection(raw: Raw): CollectionSummary {
  return {
    id: raw._id ?? "",
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    description: raw.description ?? "",
    imageUrl: imgSrc(raw.coverImage?.imageInfo, 1200, 900),
  };
}

// coverImage is ONE-OF with coverVideo — a video-covered project falls back to its poster.
function projectCover(raw: Raw): string {
  return imgSrc(raw.coverImage?.imageInfo, 1200, 900) || toVideo(raw.coverVideo?.videoInfo).posterUrl;
}

function toProject(raw: Raw): ProjectSummary {
  return {
    id: raw._id ?? "",
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    description: raw.description ?? "",
    imageUrl: projectCover(raw),
    collectionIds: raw.collectionIds ?? [],
  };
}

// A details row is a one-of: { label, text } or { label, link: { text, url, target } }.
function toDetailRow(raw: Raw): ProjectDetailRow {
  return {
    label: raw.label ?? "",
    text: raw.link?.text ?? raw.text ?? "",
    url: raw.link?.url ?? null,
    target: raw.link?.target ?? null,
  };
}

function toDetail(raw: Raw): ProjectDetail {
  return { ...toProject(raw), details: (raw.details ?? []).map((d: Raw) => toDetailRow(d)) };
}

function toGalleryItem(raw: Raw): GalleryItem | null {
  const base = {
    id: raw._id ?? "",
    title: raw.title ?? "",
    description: raw.description ?? "",
    linkUrl: raw.link?.url ?? null,
    linkTarget: raw.link?.target ?? null,
  };
  if (raw.type === "IMAGE") {
    const imageUrl = imgSrc(raw.image?.imageInfo, 1600, 1200);
    return imageUrl ? { ...base, kind: "image", imageUrl, videoUrl: null } : null;
  }
  if (raw.type === "VIDEO") {
    const { videoUrl, posterUrl } = toVideo(raw.video?.videoInfo);
    return videoUrl ? { ...base, kind: "video", imageUrl: posterUrl, videoUrl } : null;
  }
  return null; // UNDEFINED — nothing renderable
}

/**
 * List visible collections in the owner's dashboard order (sortOrder — collections have one,
 * projects don't). An omitted `hidden` comes back ABSENT (proto3): test falsy, never === false.
 */
export async function fetchCollections({ limit = 100 } = {}): Promise<CollectionSummary[]> {
  const res = await collections.listCollections({ paging: { limit } });
  return (res.collections ?? [])
    .filter((c: Raw) => !c.hidden)
    .sort((a: Raw, b: Raw) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c: Raw) => toCollection(c));
}

/** Fetch one visible collection by its URL slug. Null when not found or hidden. */
export async function fetchCollectionBySlug(slug: string): Promise<CollectionSummary | null> {
  const res = await collections.queryCollections().eq("slug", slug).limit(1).find();
  const raw = res.items?.[0] as Raw | undefined;
  return raw && !raw.hidden ? toCollection(raw) : null;
}

/**
 * List visible projects (list order — Project exposes no sortOrder), optionally only one
 * collection's. The collection filter is client-side over the one list call (portfolios are
 * small; a project links to collections via collectionIds).
 */
export async function fetchProjects({
  collectionId,
  limit = 100,
}: { collectionId?: string; limit?: number } = {}): Promise<ProjectSummary[]> {
  const res = await projects.listProjects({ paging: { limit } });
  return (res.projects ?? [])
    .filter((p: Raw) => !p.hidden)
    .filter((p: Raw) => !collectionId || (p.collectionIds ?? []).includes(collectionId))
    .map((p: Raw) => toProject(p));
}

/** Fetch one visible project by its URL slug. Null when not found or hidden. */
export async function fetchProjectBySlug(slug: string): Promise<ProjectDetail | null> {
  const res = await projects.queryProjects().eq("slug", slug).limit(1).find();
  const raw = res.items?.[0] as Raw | undefined;
  return raw && !raw.hidden ? toDetail(raw) : null;
}

/**
 * A project's media gallery in dashboard order (item sortOrder). IMAGE and VIDEO items only —
 * UNDEFINED and unresolvable media are dropped. First arg is the project _id (positional).
 */
export async function fetchProjectGallery(projectId: string): Promise<GalleryItem[]> {
  const res = await projectItems.listProjectItems(projectId, { paging: { limit: 100 } });
  return (res.items ?? [])
    .slice()
    .sort((a: Raw, b: Raw) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((it: Raw) => toGalleryItem(it))
    .filter((g: GalleryItem | null): g is GalleryItem => g !== null);
}
