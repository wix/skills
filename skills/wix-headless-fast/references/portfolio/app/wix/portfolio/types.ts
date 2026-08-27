// Portfolio DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs; videos are playable mp4 URLs with a poster frame.

/** A collection as the gallery grid needs it. */
export interface CollectionSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Resolved https URL ("" when the collection has no cover). */
  imageUrl: string;
}

/** A project as a grid tile needs it. */
export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Cover image; a video-covered project falls back to its poster frame ("" when neither). */
  imageUrl: string;
  /** The collections this project belongs to (a project can be in several). */
  collectionIds: string[];
}

/** One row of a project's metadata (Role, Year, Client…): plain text or an outbound link. */
export interface ProjectDetailRow {
  label: string;
  text: string;
  /** Non-null → render the row's text as a link. */
  url: string | null;
  /** Link rows only: "_blank" | "_self". */
  target: string | null;
}

/** A project as the detail page needs it. */
export interface ProjectDetail extends ProjectSummary {
  details: ProjectDetailRow[];
}

/** One media item of a project's gallery (dashboard order). */
export interface GalleryItem {
  id: string;
  kind: "image" | "video";
  title: string;
  description: string;
  /** image: the resolved image. video: the poster frame ("" when the video has none). */
  imageUrl: string;
  /** video only: playable mp4 URL. */
  videoUrl: string | null;
  /** Optional owner-attached outbound link for this item. */
  linkUrl: string | null;
  linkTarget: string | null;
}
