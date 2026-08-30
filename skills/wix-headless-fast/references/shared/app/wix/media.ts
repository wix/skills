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
  return typeof v === "string" ? v : "";
}
