// Wix media → browser-loadable URLs — the twin of app/wix/media.ts, without the SDK.
//
// A media value arrives as an absolute https://static.wixstatic.com/... URL, a raw
// `wix:image://v1/<file>/<name>#originWidth=W&originHeight=H` identifier a browser cannot load
// (ERR_UNKNOWN_URL_SCHEME), or, over REST, an object whose `url` (and `id`) is the BARE file id
// `e6a89e_…~mv2.png` (Services V2 media, verified live) which a browser resolves as a relative path
// and 404s. Both raw forms are scaled through this ONE URL shape; any other hand-built form 403s:
//   https://static.wixstatic.com/media/<file>/v1/fill/w_<W>,h_<H>,al_c,q_90/<file>
const STATIC = "https://static.wixstatic.com/media";
const FILL = /\/v1\/fill\/w_\d+,h_\d+/;
/** A bare Wix media file id: no scheme, no path, an extension — `e6a89e_06cf…~mv2.png`, `11062b_27ca…~mv2.jpg`. */
const BARE_FILE_ID = /^[\w-]+~mv2\.[a-z0-9]+$/i;

export type MediaLike = string | null | undefined | { image?: unknown; url?: string | null; id?: string | null };

function rawOf(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const o = value as { image?: unknown; url?: string | null; id?: string | null };
  if (o.image != null && typeof o.image === "object") return rawOf(o.image); // { image: { id, url } }
  return (typeof o.image === "string" ? o.image : null) ?? o.url ?? o.id ?? "";
}

/** The file id behind any raw form (a wix:image id, a bare file id, a static.wixstatic.com URL); "" otherwise. */
function fileOf(v: string): string {
  if (v.startsWith("wix:image://")) return v.slice("wix:image://v1/".length).split("/")[0].split("#")[0];
  if (BARE_FILE_ID.test(v)) return v;
  const m = v.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/);
  return m ? m[1] : "";
}

/** Resolve any Wix media value to a URL sized w×h ("" when absent). */
export function imgSrc(value: unknown, width = 600, height = 600): string {
  const v = rawOf(value);
  if (!v) return "";
  // A wix:image id, a bare file id, or an absolute Wix media URL (bare, or already scaled to some
  // other size): every one re-issued through the scaler at the requested size, one shape.
  const file = fileOf(v);
  if (file) return `${STATIC}/${file}/v1/fill/w_${width},h_${height},al_c,q_90/${file}`;
  return v;
}

/** srcset candidates at several widths; `ratio` is height/width. "" only when there is no image. */
export function imgSrcSet(value: unknown, widths: number[] = [320, 480, 640, 960], ratio = 1): string {
  const v = rawOf(value);
  if (!v) return "";
  if (v.startsWith("wix:image://") || BARE_FILE_ID.test(v)) return widths.map((w) => `${imgSrc(value, w, Math.round(w * ratio))} ${w}w`).join(", ");
  if (v.includes("static.wixstatic.com/") && FILL.test(v)) {
    return widths.map((w) => `${v.replace(FILL, `/v1/fill/w_${w},h_${Math.round(w * ratio)}`)} ${w}w`).join(", ");
  }
  return v;
}

/**
 * Everything an <img> needs for one Wix image, so a tile can never ship `srcset` without `src`.
 * Attribute names as HTML spells them — spread into a template or apply with setAttribute:
 *   `<img ${attrs(imgAttrs(p.imageUrl, "(min-width: 1024px) 25vw, 50vw"))} alt="…">`
 * `sizes` is the width the image renders at; `ratio` is height/width. {} when there is no image.
 */
export function imgAttrs(value: unknown, sizes: string, ratio = 1): Record<string, string> {
  const src = imgSrc(value, 640, Math.round(640 * ratio));
  if (!src) return {};
  return { src, srcset: imgSrcSet(value, undefined, ratio), sizes, loading: "lazy", decoding: "async" };
}

/**
 * Height/width of a Wix image when the value carries its size: a raw
 * `wix:image://…#originWidth=W&originHeight=H` id (the natural size) or a resolved `/v1/fill/w_W,h_H/`
 * URL (the size it was scaled to). null when neither is present. Pass it as `ratio` to keep a
 * srcset at the image's own aspect instead of the square default:
 *   imgAttrs(item.photo, "33vw", imgRatio(item.photo) ?? 1)
 */
export function imgRatio(value: unknown): number | null {
  const v = rawOf(value);
  if (!v) return null;
  const size = v.startsWith("wix:image://")
    ? [v.match(/[#&]originWidth=(\d+)/)?.[1], v.match(/[#&]originHeight=(\d+)/)?.[1]]
    : (v.match(/\/v1\/fill\/w_(\d+),h_(\d+)/)?.slice(1) ?? []);
  const w = Number(size[0]);
  const h = Number(size[1]);
  return w > 0 && h > 0 ? h / w : null;
}

/** The media identity before scaling — de-duplicate galleries on this, never on a resolved URL. */
export function mediaKey(value: unknown): string {
  const v = rawOf(value);
  if (!v) return "";
  // The file id, whichever form the value takes — a raw id and a resolved URL of one photo share it.
  if (v.startsWith("wix:image://")) return v.slice("wix:image://v1/".length).split("/")[0].split("#")[0];
  const m = v.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/);
  return m ? m[1] : v;
}
