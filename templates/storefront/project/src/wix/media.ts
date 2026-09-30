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
  | { image?: unknown; url?: string | null; id?: string | null };

/** A bare Wix media file id (`e6a89e_06cf…~mv2.png`): what REST-shaped media objects carry as `url` and `id`. */
const BARE_FILE_ID = /^[\w-]+~mv2\.[a-z0-9]+$/i;

function rawOf(value: MediaLike): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.image != null && typeof value.image === "object") return rawOf(value.image as MediaLike); // { image: { id, url } }
  return (typeof value.image === "string" ? value.image : null) ?? value.url ?? value.id ?? "";
}

/** Resolve any Wix media value to a browser-loadable URL ("" when absent). */
export function imgSrc(value: MediaLike, width = 600, height = 600): string {
  const v = rawOf(value);
  if (!v) return "";
  if (v.startsWith("wix:image://")) {
    return media.getScaledToFillImageUrl(v, width, height, {});
  }
  // A bare file id (what REST-shaped media objects carry) or an absolute Wix media URL (bare, or
  // already carrying a /v1/fill/ segment at some other size): re-issue it through the scaler at the
  // requested size, so every image path lands on one shape.
  const file = BARE_FILE_ID.test(v) ? v : v.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/)?.[1];
  if (file) return `https://static.wixstatic.com/media/${file}/v1/fill/w_${width},h_${height},al_c,q_90/${file}`;
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
  const raw = rawOf(value);
  if (!raw) return "";
  if (raw.startsWith("wix:image://") || BARE_FILE_ID.test(raw)) {
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
 * Height/width of a Wix image when the value carries its size: a raw
 * `wix:image://…#originWidth=W&originHeight=H` id (the natural size) or a resolved `/v1/fill/w_W,h_H/`
 * URL (the size it was scaled to). null when neither is present. Pass it as `ratio` to keep a
 * srcset at the image's own aspect instead of the square default:
 *   <img {...imgAttrs(item.photo, "33vw", imgRatio(item.photo) ?? 1)} alt={…} />
 */
export function imgRatio(value: MediaLike): number | null {
  const v = rawOf(value);
  if (typeof v !== "string" || !v) return null;
  const size = v.startsWith("wix:image://")
    ? [v.match(/[#&]originWidth=(\d+)/)?.[1], v.match(/[#&]originHeight=(\d+)/)?.[1]]
    : (v.match(/\/v1\/fill\/w_(\d+),h_(\d+)/)?.slice(1) ?? []);
  const w = Number(size[0]);
  const h = Number(size[1]);
  return w > 0 && h > 0 ? h / w : null;
}

/**
 * The identity of a media value BEFORE scaling — de-duplicate galleries on this, never on a
 * resolved URL (two scaled URLs of one photo differ in their size parameters).
 */
export function mediaKey(value: MediaLike): string {
  const v = rawOf(value);
  if (!v) return "";
  // The file id, whichever form the value takes — a raw id and a resolved URL of one photo share it.
  if (v.startsWith("wix:image://")) return v.slice("wix:image://v1/".length).split("/")[0].split("#")[0];
  const m = v.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/);
  return m ? m[1] : v;
}
