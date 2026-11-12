'use strict';

// Product videos from WooCommerce product meta. Pure: product record in, video list
// out. Which meta keys hold videos is knowledge (../product-video-sources.json), not code.
//
// Kinds:
//   file    a video file URL (by extension). Wix Media can import it; the product gets it as
//           video media after its images (target writer attachStoresProductVideos).
//   youtube / vimeo / other
//           a link Wix product media cannot hold. Not sent; it becomes a product-video-manual
//           cutover item so the Cutover Operator adds it by hand.

const fs = require('node:fs');
const path = require('node:path');
const { phpUnserialize } = require('./wp-redirect-sources.js');

const SOURCES_PATH = path.join(__dirname, '..', 'product-video-sources.json');

function loadVideoSources(file = SOURCES_PATH) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc.schemaVersion !== 1 || !Array.isArray(doc.sources)) throw new Error(`${file}: expected schemaVersion 1 with sources[]`);
  for (const [index, source] of doc.sources.entries()) {
    if (!source || typeof source.key !== 'string' || !source.key || typeof source.origin !== 'string' || !source.origin) {
      throw new Error(`${file}: sources[${index}] needs key and origin`);
    }
    if (!['object', 'url-list'].includes(source.shape)) throw new Error(`${file}: sources[${index}].shape must be object or url-list`);
    if (source.shape === 'object' && (typeof source.url !== 'string' || !source.url)) throw new Error(`${file}: sources[${index}] shape object needs url`);
  }
  return doc;
}

function decode(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (/^(a|s):\d+:/.test(text)) {
    try { return phpUnserialize(text); } catch { return value; }
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    try { return JSON.parse(text); } catch { return value; }
  }
  return value;
}

function hostMatches(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function classifyVideoUrl(url, knowledge) {
  let parsed;
  try { parsed = new URL(url); } catch { return 'other'; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'other';
  const host = parsed.hostname.toLowerCase();
  for (const [kind, domains] of Object.entries(knowledge.embedHosts || {})) {
    if (hostMatches(host, domains)) return kind;
  }
  const extension = path.extname(decodeURIComponent(parsed.pathname)).slice(1).toLowerCase();
  return (knowledge.fileExtensions || []).includes(extension) ? 'file' : 'other';
}

function urlsOf(source, value) {
  const decoded = decode(value);
  if (source.shape === 'url-list') {
    const list = Array.isArray(decoded) ? decoded : (decoded && typeof decoded === 'object' ? Object.values(decoded) : [decoded]);
    return list.filter((entry) => typeof entry === 'string');
  }
  if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
    const url = decoded[source.url];
    return typeof url === 'string' ? [url] : [];
  }
  return [];
}

function recordOf(row) {
  return row && typeof row === 'object' && row.record && typeof row.record === 'object' ? row.record : row;
}

// One product -> [{ url, kind, origin, metaKey }], in source order, deduplicated by URL.
function extractProductVideos(product, knowledge = loadVideoSources()) {
  const record = recordOf(product);
  const meta = Array.isArray(record?.meta_data) ? record.meta_data : [];
  const out = [];
  const seen = new Set();
  for (const source of knowledge.sources) {
    for (const entry of meta.filter((item) => item && item.key === source.key)) {
      for (const raw of urlsOf(source, entry.value)) {
        const url = raw.trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({ url, kind: classifyVideoUrl(url, knowledge), origin: source.origin, metaKey: source.key });
      }
    }
  }
  return out;
}

// Products -> the deterministic plan the importer and the completion report share.
function planProductVideos(products, knowledge = loadVideoSources()) {
  const attach = [];
  const manual = [];
  for (const row of products) {
    const record = recordOf(row);
    if (!record || record.id === undefined || record.id === null) continue;
    const videos = extractProductVideos(record, knowledge);
    if (!videos.length) continue;
    const productSourceId = String(record.id);
    const name = typeof record.name === 'string' ? record.name : null;
    const files = videos.filter((video) => video.kind === 'file');
    if (files.length) attach.push({ productSourceId, name, videos: files.map(({ url, origin }) => ({ url, origin })) });
    for (const video of videos.filter((entry) => entry.kind !== 'file')) {
      manual.push({ productSourceId, name, url: video.url, kind: video.kind, origin: video.origin });
    }
  }
  return { attach, manual };
}

module.exports = { SOURCES_PATH, loadVideoSources, classifyVideoUrl, extractProductVideos, planProductVideos };
