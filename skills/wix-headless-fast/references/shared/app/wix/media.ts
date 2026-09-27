// Wix media resolution — define once, use on EVERY image render path. Copy as-is.
//
// SDK media fields come back either as an already-absolute https URL, or as a
// `wix:image://v1/<hash>/<file>#originWidth=…` identifier that a browser cannot load
// (ERR_UNKNOWN_URL_SCHEME). The wix:image:// form must go through the SDK media module;
// never hand-build a static.wixstatic.com URL (wrong format → 403).
// docs: https://dev.wix.com/docs/sdk/core-modules/sdk/media.md
import { media } from "@wix/sdk";

type MediaLike =
  | string
  | null
  | undefined
  | { image?: string | null; url?: string | null };

/** Resolve any Wix media value to a browser-loadable URL ("" when absent). */
export function imgSrc(value: MediaLike, width = 600, height = 600): string {
  const v =
    typeof value === "object" && value !== null
      ? (value.image ?? value.url ?? "")
      : (value ?? "");
  if (!v) return "";
  if (typeof v === "string" && v.startsWith("wix:image://")) {
    return media.getScaledToFillImageUrl(v, width, height, {});
  }
  if (typeof v !== "string") return "";
  // An absolute Wix media URL (bare, or already carrying a /v1/fill/ segment at some other size):
  // re-issue it through the scaler at the requested size, so every image path lands on one shape.
  const m = v.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/);
  if (m) return `https://static.wixstatic.com/media/${m[1]}/v1/fill/w_${width},h_${height},al_c,q_90/${m[1]}`;
  return v;
}

/**
 * Responsive candidates for `srcset`: the same image at several widths through Wix's scaler, so a
 * card never downloads a hero-sized file. Pair with `sizes`:
 *   <img src={imgSrc(m, 640, 640)} srcSet={imgSrcSet(m)} sizes="(min-width: 1024px) 25vw, 50vw"
 *        width={640} height={640} loading="lazy" alt={…} />
 * Accepts every form an image reaches you in: a raw `wix:image://` id, an ALREADY-RESOLVED Wix URL
 * (what the DTOs carry — `imageUrl`, `gallery[]`; its `/v1/fill/w_…,h_…` segment is rewritten per
 * width), or any other https URL (returned as the single candidate). `ratio` is height/width
 * (1 = square). "" only when there is no image at all — still set `src` as well.
 */
export function imgSrcSet(value: MediaLike, widths: number[] = [320, 480, 640, 960], ratio = 1): string {
  const raw = typeof value === "object" && value !== null ? (value.image ?? value.url ?? "") : (value ?? "");
  if (typeof raw !== "string" || !raw) return "";
  if (raw.startsWith("wix:image://")) {
    return widths.map((w) => `${imgSrc(value, w, Math.round(w * ratio))} ${w}w`).join(", ");
  }
  // A resolved Wix URL: …/v1/fill/w_800,h_800,al_c,… — swap the size for each width.
  const FILL = /\/v1\/fill\/w_\d+,h_\d+/;
  if (/static\.wixstatic\.com\//.test(raw) && FILL.test(raw)) {
    return widths.map((w) => `${raw.replace(FILL, `/v1/fill/w_${w},h_${Math.round(w * ratio)}`)} ${w}w`).join(", ");
  }
  return raw; // one candidate, never an empty srcset for a real image
}

/**
 * Everything an <img> needs for one Wix image, so a tile can never ship `srcSet` without `src`:
 *   <img {...imgAttrs(p.imageUrl, "(min-width: 1024px) 25vw, 50vw")} alt={p.name} />
 * `sizes` is the width the image renders at (a CSS length or media-query list); `ratio` is
 * height/width. Returns an empty object when there is no image — render your placeholder then.
 */
export function imgAttrs(value: MediaLike, sizes: string, ratio = 1): { src: string; srcSet: string; sizes: string; loading: "lazy"; decoding: "async" } | Record<string, never> {
  const src = imgSrc(value, 640, Math.round(640 * ratio));
  if (!src) return {};
  return { src, srcSet: imgSrcSet(value, undefined, ratio), sizes, loading: "lazy", decoding: "async" };
}

/**
 * The identity of a media value BEFORE scaling — de-duplicate galleries on this, never on a
 * resolved URL (two scaled URLs of one photo differ in their size parameters).
 */
export function mediaKey(value: MediaLike): string {
  const v = typeof value === "object" && value !== null ? (value.image ?? value.url ?? "") : (value ?? "");
  if (!v) return "";
  // The file id, whichever form the value takes — a raw id and a resolved URL of one photo share it.
  if (v.startsWith("wix:image://")) return v.slice("wix:image://v1/".length).split("/")[0].split("#")[0];
  const m = v.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/);
  return m ? m[1] : v;
}
