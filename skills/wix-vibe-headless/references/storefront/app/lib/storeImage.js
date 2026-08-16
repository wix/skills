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
