// storeImage — turn a Wix Stores image value into a URL the browser can load.
// Wix returns these protocol-relative (`//static.wixstatic.com/...`), which resolves against the
// current page. That works on https pages and breaks on anything else, so normalise it once here
// instead of at each call site — product media, PDP gallery items, and cart line items all carry the
// same shape. Returns null for a missing value so callers can render a placeholder.
export function storeImage(value) {
  const url = typeof value === "string" ? value : value?.image?.url || value?.url;
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

// A Wix media id (e.g. "abc123~mv2.jpg") is NOT a URL — build the static CDN url for it.
export function wixMediaUrl(mediaId) {
  if (!mediaId || typeof mediaId !== "string") return null;
  if (mediaId.startsWith("http") || mediaId.startsWith("//")) return storeImage(mediaId);
  return `https://static.wixstatic.com/media/${mediaId}`;
}

// The media id inside a Wix image url (…/media/<id>/v1/… or a bare …/media/<id>). Compare two urls of
// the SAME image that differ only in sizing/format params by their id, not full-string equality.
export function wixMediaId(url) {
  const m = typeof url === "string" && url.match(/\/media\/([^/?]+)/);
  return m ? m[1] : url;
}

// The image assigned to a product OPTION CHOICE (e.g. a colour swatch). The storefront fetches with the
// PRODUCT_CHOICES_MEDIA_REFERENCES field, so Wix returns the choice image at choice.media.items[].mediaId
// and returns choice.linkedMedia EMPTY. Read media.items — do NOT switch this to choice.linkedMedia even
// if a direct admin/API probe shows linkedMedia populated: a probe made WITHOUT that field mask returns
// linkedMedia, but the storefront requests the mask, which blanks linkedMedia and returns media.items.
export function choiceImage(choice) {
  const mediaId = choice?.media?.items?.[0]?.mediaId;
  return mediaId ? wixMediaUrl(mediaId) : null;
}

// The image for a resolved VARIANT (a full choice combination). Wix computes variant.media from the
// picked choices' media, so this is the exact image for the current selection — prefer it over a
// single choice's image once all options are chosen.
// ⚠️ Read `media.image.url` (the URL the API already returns), or build from `media.id` — the
// `~mv2` file id. NOT `media.uploadId`: that's a dashed GUID (the id the file was uploaded with),
// and https://static.wixstatic.com/media/<uploadId> is a 403. Variants without media (a fresh
// template's demo products) return null, and the caller falls back to the choice's own image.
export function variantImage(variant) {
  const m = variant?.media;
  if (!m) return null;
  return storeImage(m.image?.url) || wixMediaUrl(m.id) || storeImage(m.thumbnail?.url);
}

// The main catalog image for a product (grid tiles, cart fallbacks).
export function productImage(product) {
  return storeImage(product?.media?.main?.image?.url);
}

// Every gallery image for a product, main first, de-duplicated — `media.itemsInfo.items` repeats the
// main image, and video items carry no `image.url`. Returns [{ url, altText }].
export function productGallery(product) {
  const items = product?.media?.itemsInfo?.items || [];
  const urls = [productImage(product), ...items.map((i) => storeImage(i))];
  const seen = new Set();
  return urls
    .map((url, i) => ({ url, altText: items[i - 1]?.altText || product?.name || "" }))
    .filter(({ url }) => url && !seen.has(url) && seen.add(url));
}
