// Wix media → browser-loadable URLs — the twin of app/wix/media.ts, without the SDK.
//
// A media value arrives as either an absolute https://static.wixstatic.com/... URL or a raw
// `wix:image://v1/<file>/<name>#originWidth=W&originHeight=H` identifier a browser cannot load
// (ERR_UNKNOWN_URL_SCHEME). The raw form is scaled through this ONE URL shape; any other hand-built
// form 403s:   https://static.wixstatic.com/media/<file>/v1/fill/w_<W>,h_<H>,al_c,q_90/<file>
const STATIC = "https://static.wixstatic.com/media";
const FILL = /\/v1\/fill\/w_\d+,h_\d+/;

export type MediaLike = string | null | undefined | { image?: string | null; url?: string | null };

function rawOf(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const o = value as { image?: string | null; url?: string | null };
  return o.image ?? o.url ?? "";
}

/** Resolve any Wix media value to a URL sized w×h ("" when absent). */
export function imgSrc(value: unknown, width = 600, height = 600): string {
  const v = rawOf(value);
  if (!v) return "";
  if (v.startsWith("wix:image://")) {
    const file = v.slice("wix:image://v1/".length).split("/")[0].split("#")[0];
    return `${STATIC}/${file}/v1/fill/w_${width},h_${height},al_c,q_90/${file}`;
  }
  return v;
}

/** srcset candidates at several widths; `ratio` is height/width. "" only when there is no image. */
export function imgSrcSet(value: unknown, widths: number[] = [320, 480, 640, 960], ratio = 1): string {
  const v = rawOf(value);
  if (!v) return "";
  if (v.startsWith("wix:image://")) return widths.map((w) => `${imgSrc(value, w, Math.round(w * ratio))} ${w}w`).join(", ");
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

/** The media identity before scaling — de-duplicate galleries on this, never on a resolved URL. */
export function mediaKey(value: unknown): string {
  const v = rawOf(value);
  if (!v) return "";
  return v.startsWith("wix:image://") ? v.split("#")[0] : v.replace(FILL, "");
}
