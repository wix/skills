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

/** The media identity before scaling — de-duplicate galleries on this, never on a resolved URL. */
export function mediaKey(value: unknown): string {
  const v = rawOf(value);
  if (!v) return "";
  return v.startsWith("wix:image://") ? v.split("#")[0] : v.replace(FILL, "");
}
