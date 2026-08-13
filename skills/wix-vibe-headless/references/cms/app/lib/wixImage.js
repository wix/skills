// wixImage — turn a Wix CMS image field value into a URL a browser can render.
// CMS media fields come back in two shapes and only ONE renders directly in <img src>:
//   • a plain `https://static.wixstatic.com/...` (or protocol-relative `//...`) URL → usable as-is
//   • a Wix media URI `wix:image://v1/<mediaId>/<filename>#originWidth=…&originHeight=…` → NOT
//     renderable by the browser; the `<mediaId>` segment maps to a static.wixstatic.com/media/ URL.
// Merchant-uploaded images (via the dashboard) are the `wix:image://` form; images your seed step
// wrote are usually already `https://`. This converts both so the shipped UI never shows a broken
// image. Returns null for an empty/unknown value (the UI shows a token surface instead).
export function wixImage(value) {
  if (!value || typeof value !== "string") return null;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http")) return value;
  if (value.startsWith("wix:image://")) {
    const mediaId = value.slice("wix:image://v1/".length).split("/")[0];
    return mediaId ? `https://static.wixstatic.com/media/${mediaId}` : null;
  }
  return null;
}
