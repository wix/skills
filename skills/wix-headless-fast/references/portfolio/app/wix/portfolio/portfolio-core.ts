// Portfolio rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./portfolio.ts
// (the SDK, managed Astro and React) and the REST twin in references/portfolio/rest/portfolio.ts
// (fetch, a static site or a port to another language). Every rule about hidden entities, order,
// covers, media kinds lives HERE, once. A raw entity may come from the SDK (`_id`) or from REST
// (`id`); the mappers accept both. Imports are type-only so a strip to JS emits no imports.
import type { CollectionSummary, GalleryItem, ProjectDetail, ProjectDetailRow, ProjectSummary } from "./types";

/** A raw Portfolio v1 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;
/**
 * A `wix:video://` reference → its mp4 rendition and poster, or null when it can't be resolved.
 * Injected: only the SDK can resolve the string form (media.getVideoUrl); REST never receives it
 * (its videoInfo is already an object with resolutions + posters, handled here).
 */
export type VideoSrc = (wixVideoRef: string) => { url: string; thumbnail: string } | null;

const id = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/**
 * An image reference as either transport carries it — the SDK's bare `wix:image://` string, or
 * REST's `imageInfo` object `{ id, url, filename }` — normalized to the `wix:image://` form so
 * imgSrc scales both to the SAME URL (REST's `url` is a fixed 1024×1024 rendition; the id is the
 * media file). "" when there is no image.
 */
export function imageRef(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const o = value as Raw;
  if (typeof o.id === "string" && o.id) return `wix:image://v1/${o.id}/${o.filename ?? o.id}`;
  return typeof o.url === "string" ? o.url : "";
}

/**
 * A video as either transport carries it: the SDK's bare `wix:video://` string (resolved by the
 * injected videoSrc — 720p is the standard transcode), or REST's videoInfo object
 * `{ resolutions: [{ url }], posters: [{ id, url }] }` (optimal resolution first).
 */
export function toVideo(value: unknown, imgSrc: ImgSrc, videoSrc: VideoSrc): { videoUrl: string | null; posterUrl: string } {
  if (typeof value === "string") {
    const v = value.startsWith("wix:video://") ? videoSrc(value) : null;
    return v ? { videoUrl: v.url, posterUrl: imgSrc(imageRef(v.thumbnail), 1200, 675) } : { videoUrl: null, posterUrl: "" };
  }
  const raw = value as Raw | null | undefined;
  const url = raw?.resolutions?.[0]?.url;
  return {
    videoUrl: typeof url === "string" ? url : null,
    posterUrl: imgSrc(imageRef(raw?.posters?.[0]), 1200, 675),
  };
}

// ---- DTO mappers -----------------------------------------------------------------------------------

export function toCollection(raw: Raw, imgSrc: ImgSrc): CollectionSummary {
  return {
    id: id(raw),
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    description: raw.description ?? "",
    imageUrl: imgSrc(imageRef(raw.coverImage?.imageInfo), 1200, 900),
  };
}

/** coverImage is ONE-OF with coverVideo — a video-covered project falls back to its poster. */
export function projectCover(raw: Raw, imgSrc: ImgSrc, videoSrc: VideoSrc): string {
  return imgSrc(imageRef(raw.coverImage?.imageInfo), 1200, 900) || toVideo(raw.coverVideo?.videoInfo, imgSrc, videoSrc).posterUrl;
}

export function toProject(raw: Raw, imgSrc: ImgSrc, videoSrc: VideoSrc): ProjectSummary {
  return {
    id: id(raw),
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    description: raw.description ?? "",
    imageUrl: projectCover(raw, imgSrc, videoSrc),
    collectionIds: raw.collectionIds ?? [],
  };
}

/** A details row is a one-of: { label, text } or { label, link: { text, url, target } }. */
export function toDetailRow(raw: Raw): ProjectDetailRow {
  return {
    label: raw.label ?? "",
    text: raw.link?.text ?? raw.text ?? "",
    url: raw.link?.url ?? null,
    target: raw.link?.target ?? null,
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc, videoSrc: VideoSrc): ProjectDetail {
  return { ...toProject(raw, imgSrc, videoSrc), details: ((raw.details ?? []) as Raw[]).map(toDetailRow) };
}

/** IMAGE → image item, VIDEO → video item; UNDEFINED or unresolvable media → null (nothing renderable). */
export function toGalleryItem(raw: Raw, imgSrc: ImgSrc, videoSrc: VideoSrc): GalleryItem | null {
  const base = {
    id: id(raw),
    title: raw.title ?? "",
    description: raw.description ?? "",
    linkUrl: raw.link?.url ?? null,
    linkTarget: raw.link?.target ?? null,
  };
  if (raw.type === "IMAGE") {
    const imageUrl = imgSrc(imageRef(raw.image?.imageInfo), 1600, 1200);
    return imageUrl ? { ...base, kind: "image", imageUrl, videoUrl: null } : null;
  }
  if (raw.type === "VIDEO") {
    const { videoUrl, posterUrl } = toVideo(raw.video?.videoInfo, imgSrc, videoSrc);
    return videoUrl ? { ...base, kind: "video", imageUrl: posterUrl, videoUrl } : null;
  }
  return null;
}

// ---- list rules -----------------------------------------------------------------------------------

/**
 * Visible collections in the owner's dashboard order (sortOrder — collections have one, projects
 * don't). An omitted `hidden` comes back ABSENT (proto3): test falsy, never === false.
 */
export function visibleCollections(raws: Raw[], imgSrc: ImgSrc): CollectionSummary[] {
  return raws
    .filter((c) => !c.hidden)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => toCollection(c, imgSrc));
}

/** One visible collection, or null when missing or hidden (a real 404, never a fallback). */
export function visibleCollection(raw: Raw | undefined | null, imgSrc: ImgSrc): CollectionSummary | null {
  return raw && !raw.hidden ? toCollection(raw, imgSrc) : null;
}

/**
 * Visible projects in list order (Project exposes no sortOrder), optionally only one collection's.
 * The collection filter is client-side over the one list (portfolios are small; a project links
 * to collections via collectionIds).
 */
export function visibleProjects(raws: Raw[], collectionId: string | undefined, imgSrc: ImgSrc, videoSrc: VideoSrc): ProjectSummary[] {
  return raws
    .filter((p) => !p.hidden)
    .filter((p) => !collectionId || ((p.collectionIds ?? []) as string[]).includes(collectionId))
    .map((p) => toProject(p, imgSrc, videoSrc));
}

/** One visible project with its details rows, or null when missing or hidden. */
export function visibleProject(raw: Raw | undefined | null, imgSrc: ImgSrc, videoSrc: VideoSrc): ProjectDetail | null {
  return raw && !raw.hidden ? toDetail(raw, imgSrc, videoSrc) : null;
}

/** A project's gallery in dashboard order (item sortOrder); UNDEFINED and unresolvable items dropped. */
export function galleryItems(raws: Raw[], imgSrc: ImgSrc, videoSrc: VideoSrc): GalleryItem[] {
  return raws
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((it) => toGalleryItem(it, imgSrc, videoSrc))
    .filter((g): g is GalleryItem => g !== null);
}

// ---- render rule ----------------------------------------------------------------------------------

/** The one element a gallery item renders as, attribute names as HTML spells them. */
export type MediaElement =
  | { tag: "img"; attrs: { src: string; alt: string; loading: "lazy"; decoding: "async" } }
  | { tag: "video"; attrs: { src: string; poster?: string; controls: ""; playsinline: "" } };

/**
 * Branch on `kind` once, here: a video item is a <video> with its poster, an image item an <img>,
 * anything else null — never a broken tag, never an <img> for a video. The shipped GalleryMedia.tsx
 * renders this; a static page or a port creates the element from it.
 */
export function mediaElement(item: GalleryItem): MediaElement | null {
  if (item.kind === "video" && item.videoUrl) {
    return { tag: "video", attrs: { src: item.videoUrl, ...(item.imageUrl ? { poster: item.imageUrl } : {}), controls: "", playsinline: "" } };
  }
  if (item.imageUrl) return { tag: "img", attrs: { src: item.imageUrl, alt: item.title, loading: "lazy", decoding: "async" } };
  return null;
}
