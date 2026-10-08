// SHIPPED — wire as-is. One gallery item as its one element: a <video> with poster for a video
// item, an <img> for an image item, null when nothing is renderable (never a broken tag, never
// an <img> for a video). The branching rule is `mediaElement` in wix/portfolio/portfolio-core.ts,
// shared with every other stack; this is its React spelling. Wrapped in a link when the owner
// attached one. `className` styles the media element itself.
import type { ReactNode } from "react";
import { mediaElement } from "../../wix/portfolio/portfolio-core";
import type { GalleryItem } from "../../wix/portfolio/types";

export interface GalleryMediaProps {
  item: GalleryItem;
  className?: string;
}

export function GalleryMedia({ item, className }: GalleryMediaProps) {
  const el = mediaElement(item);
  if (!el) return null;
  if (el.tag === "video") {
    return <video src={el.attrs.src} poster={el.attrs.poster} controls playsInline className={className} />;
  }
  return <img src={el.attrs.src} alt={el.attrs.alt} loading="lazy" decoding="async" className={className} />;
}

/** The item's outbound link when the owner set one, else the children as they are. */
export function GalleryLink({ item, children }: { item: GalleryItem; children: ReactNode }) {
  return item.linkUrl ? (
    <a href={item.linkUrl} target={item.linkTarget ?? undefined} rel="noopener">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

export default GalleryMedia;
