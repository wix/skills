'use strict';

// Resolve a WordPress/WooCommerce image reference to the source's ORIGINAL, maximum-resolution
// file (spec 0106).
//
// An image reference in a WordPress-family payload is never one URL — it is a SET of candidate
// URLs for the same picture: the file the merchant uploaded, plus the crops WordPress generated
// from it. Which field holds which varies by route, and two routes on the SAME site disagree:
//
//   wc/store/v1/products  (public)         images[].src IS the original
//   wc/v3/products        (authenticated)  images[].src can be the SMALLEST crop, because the
//                                          admin controller resolves it through WordPress's
//                                          registered image sizes, which any theme or
//                                          image-optimizer plugin is free to redefine
//
// So no caller may name a field. Every caller hands the whole reference to resolveImageUrl and
// gets back the biggest file available. Doing it any other way is how a whole catalog shipped as
// 150x150 thumbnails.
//
// It matters because the destination gives exactly one attempt: Wix Stores media takes ONE url
// per item and generates every derivative from it, with no way to raise the quality afterwards.
// Whatever this function returns is that product image's permanent ceiling.

// WordPress names every crop it generates by appending the dimensions to the filename, so a
// candidate WITHOUT that suffix is the uploaded original. This is a filename convention of the
// source platform, not a guarantee — do not reuse this module for a non-WordPress source
// without re-deriving the rule.
//
// The extension group repeats (`(\.ext)+`) because image optimizers append their own format
// rather than replacing the original one: WebP Express, EWWW and Imagify all emit
// `photo-150x150.jpg.webp` beside `photo-150x150.jpg`. Matching only the LAST extension made
// every such crop look like an uploaded original, so rule 3 below returned the first one it saw —
// a 150px thumbnail winning over a 1200px sibling, reported as `isCrop: false` so nothing flagged
// it either. That is unrecoverable once ingested, which is the whole reason this module exists.
const CROP_SUFFIX = /-(\d+)x(\d+)(\.[A-Za-z0-9]+)+$/;

// Fields that hold a single URL, across every WordPress-family shape we read:
//   wc/v3 + wc/store/v1 product images  -> src, thumbnail
//   wp/v2 media                         -> source_url
const SINGLE_URL_FIELDS = ['src', 'thumbnail', 'source_url'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function pathOf(url) {
  // Compare against the path only. A query string can end in anything, and matching the crop
  // suffix against it would misread `?v=-150x150` as a crop.
  const withoutFragment = String(url).split('#')[0];
  return withoutFragment.split('?')[0];
}

// Width descriptors in a srcset entry ("<url> 800w") and the width baked into a crop filename
// are both ranking keys and nothing else. Never treat either as the image's true dimensions.
function declaredWidth(url, descriptorWidth) {
  const match = CROP_SUFFIX.exec(pathOf(url));
  const fromName = match ? Number(match[1]) : 0;
  return Math.max(Number(descriptorWidth) || 0, fromName);
}

function parseSrcset(srcset) {
  if (!isNonEmptyString(srcset)) return [];
  return srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(/\s+/);
      const url = parts[0];
      const descriptor = parts.length > 1 ? parts[parts.length - 1] : '';
      const width = /^\d+w$/.test(descriptor) ? Number(descriptor.slice(0, -1)) : 0;
      return isNonEmptyString(url) ? { url, width } : null;
    })
    .filter(Boolean);
}

// Every URL the record offers for this one picture, each with whatever width we can infer.
function collectCandidates(record) {
  if (!record || typeof record !== 'object') return [];
  const candidates = [];

  for (const field of SINGLE_URL_FIELDS) {
    if (isNonEmptyString(record[field])) candidates.push({ url: record[field], width: 0 });
  }

  // wc/store/v1 exposes a second srcset for the thumbnail rendition; it occasionally carries a
  // width the main one does not, and taking the max across both costs nothing.
  for (const field of ['srcset', 'thumbnail_srcset']) {
    candidates.push(...parseSrcset(record[field]));
  }

  // wp/v2 media keeps its renditions in a nested map rather than a srcset string.
  const sizes = record.media_details && record.media_details.sizes;
  if (sizes && typeof sizes === 'object') {
    for (const size of Object.values(sizes)) {
      if (size && isNonEmptyString(size.source_url)) {
        candidates.push({ url: size.source_url, width: Number(size.width) || 0 });
      }
    }
  }

  return candidates;
}

// A raw URL with non-ASCII characters is not fetchable by ordinary HTTP clients — our own
// verification tooling throws on it before the destination ever sees the request. Encode the
// path only: the host is already punycode or ASCII, and the query is left to the URL parser's
// own normalization so its parameter structure is never rewritten.
function encodeImageUrl(url) {
  if (!isNonEmptyString(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname
      .split('/')
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
    return parsed.toString();
  } catch {
    // Not an absolute URL. Hand it back untouched rather than mangling a relative path — the
    // caller knows its own base and this module does not.
    return url;
  }
}

// The one entry point. Returns the encoded URL of the largest file the record offers, or null
// when it offers none. Never invents a URL: a record with no image is a fact to report, not a
// gap to fill with a placeholder.
function resolveImageUrl(record) {
  const candidates = collectCandidates(record);
  if (candidates.length === 0) return null;

  const original = candidates.find((candidate) => !CROP_SUFFIX.test(pathOf(candidate.url)));
  if (original) return encodeImageUrl(original.url);

  // Only crops exist. Take the widest rather than failing — something always beats a thumbnail —
  // and let the caller report it via resolvedIsCrop().
  let best = candidates[0];
  let bestWidth = declaredWidth(best.url, best.width);
  for (const candidate of candidates.slice(1)) {
    const width = declaredWidth(candidate.url, candidate.width);
    if (width > bestWidth) {
      best = candidate;
      bestWidth = width;
    }
  }
  return encodeImageUrl(best.url);
}

// True when the best available URL is still a generated crop, i.e. the source genuinely had no
// original to give. Callers MUST surface this: a migration may ship a small picture when the
// source only has a small picture, but it may not do so silently.
function resolvedIsCrop(url) {
  return isNonEmptyString(url) && CROP_SUFFIX.test(pathOf(url));
}

// Resolve a whole images[] array in order, dropping references that carry no URL at all.
// Order is load-bearing downstream: the first surviving item becomes the product's main media.
function resolveImageUrls(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((record) => {
      const url = resolveImageUrl(record);
      if (!url) return null;
      const resolved = { url, isCrop: resolvedIsCrop(url) };
      if (isNonEmptyString(record && record.alt)) resolved.altText = record.alt;
      if (isNonEmptyString(record && record.alt_text)) resolved.altText = record.alt_text;
      if (isNonEmptyString(record && record.name)) resolved.displayName = record.name;
      return resolved;
    })
    .filter(Boolean);
}

module.exports = {
  resolveImageUrl,
  resolveImageUrls,
  resolvedIsCrop,
  encodeImageUrl,
};
