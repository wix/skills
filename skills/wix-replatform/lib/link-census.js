'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { classifyNavigation, occurrenceId } = require('./internal-link-reconciliation.js');

const NAV_KEYS = new Set(['href', 'url', 'link', 'destination', 'targetUrl']);
const RESOURCE_KEYS = new Set(['src', 'srcset', 'image', 'media', 'download', 'backgroundImage']);
const IGNORED_SEGMENTS = new Set(['config', '.git', 'node_modules', 'secrets']);

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

function decodeHtmlEntities(value) {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|quot|apos|lt|gt);/gi, (_whole, entity) => {
    if (entity[0] === '#') {
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : _whole;
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity.toLowerCase()];
  });
}

// Tokenizes tags and quoted attributes. It does not treat arbitrary angle-bracket text as a
// successful parse: malformed markup produces an explicit unsupported disposition.
function htmlAttributes(html) {
  const found = [];
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) break;
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      if (close < 0) throw new Error('unterminated HTML comment');
      const comment = html.slice(open + 4, close).trim();
      if (comment.startsWith('wp:')) {
        const jsonStart = comment.indexOf('{');
        const jsonEnd = comment.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          try {
            for (const link of extractJson(JSON.parse(comment.slice(jsonStart, jsonEnd + 1)))) found.push({ ...link, location: `block:${open}:${link.location}` });
          } catch { throw new Error('unsupported WordPress block attributes'); }
        }
      }
      index = close + 3; continue;
    }
    let cursor = open + 1;
    if (!/[A-Za-z/!?]/.test(html[cursor] || '')) { index = cursor; continue; }
    let quote = null;
    for (; cursor < html.length; cursor += 1) {
      const char = html[cursor];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (cursor >= html.length) throw new Error('unterminated HTML tag');
    const tag = html.slice(open + 1, cursor);
    const attr = /(?:^|\s)(href|action|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let match;
    while ((match = attr.exec(tag))) found.push({ key: match[1].toLowerCase(), value: decodeHtmlEntities(match[2] ?? match[3] ?? match[4]), location: `char:${open + 1 + match.index + match[0].indexOf(match[1])}` });
    index = cursor + 1;
  }
  return found;
}

function countMetadataHrefs(value) {
  if (Array.isArray(value)) return value.reduce((count, item) => count + countMetadataHrefs(item), 0);
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((count, [key, child]) => count + (key === 'href' && typeof child === 'string' ? 1 : countMetadataHrefs(child)), 0);
}

function extractJson(value, location = '$', output = [], contentField = null, stats = null) {
  if (Array.isArray(value)) { value.forEach((item, index) => extractJson(item, `${location}[${index}]`, output, contentField, stats)); return output; }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === '_links' || key === '_embedded') {
      if (stats) stats.metadataHrefsSkipped = (stats.metadataHrefsSkipped || 0) + countMetadataHrefs(child);
      continue;
    }
    if (key === 'yoast_head' || key === 'yoast_head_json') {
      if (stats && key === 'yoast_head' && typeof child === 'string') {
        stats.metadataHrefsSkipped = (stats.metadataHrefsSkipped || 0) + (child.match(/(?:^|\s)href\s*=/gi) || []).length;
      }
      continue;
    }
    const next = `${location}.${key}`;
    const owningField = contentField || (['records', 'items', 'data', 'entities'].includes(key) ? null : key);
    if (typeof child === 'string') {
      const resourceContext = /(?:^|\.)(?:image|media|attachment|thumbnail|download|logo|icon|background)(?:\.|\[|$)/i.test(location);
      const navigationContext = /(?:^|\.)(?:content|body|description|button|menu|recommendation|link|anchor|action|richContent)(?:\.|\[|$)/i.test(location);
      if (RESOURCE_KEYS.has(key) || resourceContext && key === 'url') output.push({ key, value: child, location: next, contentField: owningField, resource: true });
      else if (NAV_KEYS.has(key) && (key === 'href' || key === 'targetUrl' || key === 'destination' || navigationContext)) output.push({ key, value: child, location: next, contentField: owningField });
      else if (/<[a-z][^>]*>/i.test(child)) for (const attr of htmlAttributes(child)) output.push({ ...attr, contentField: owningField, location: `${next}:${attr.location}` });
    } else extractJson(child, next, output, owningField, stats);
  }
  return output;
}

function extractFile(file, raw, stats = null) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') return extractJson(JSON.parse(raw), '$', [], null, stats);
  if (ext === '.html' || ext === '.htm') return htmlAttributes(raw);
  // CSS URLs are resources, not automatically navigational links.
  if (ext === '.css') return [];
  throw new Error('unsupported-format');
}

function containingRecord(file, location, containingPages) {
  const config = containingPages[file];
  if (typeof config === 'string') return { url: config, recordId: null };
  if (!config || typeof config !== 'object') return null;
  const prefix = Object.keys(config).filter((key) => location.startsWith(key)).sort((a, b) => b.length - a.length)[0];
  if (!prefix) return null;
  const row = config[prefix];
  return typeof row === 'string' ? { url: row, recordId: null } : row;
}

async function walk(root, relative = '') {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (IGNORED_SEGMENTS.has(entry.name) || entry.name.startsWith('.')) continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

async function census({ capturedRoots, expectedFiles = [], sourceHosts, destinationHosts, containingPages = {}, previous = null }) {
  if (!Array.isArray(capturedRoots) || !capturedRoots.length) throw new Error('capturedRoots required');
  const started = Date.now();
  const manifest = [];
  const occurrences = [];
  for (const root of capturedRoots) {
    const files = await walk(root);
    for (const relative of files) {
      const file = path.join(root, relative);
      let raw;
      try { raw = await fs.readFile(file); }
      catch (error) { manifest.push({ file, disposition: 'unreadable', reason: error.code || 'read-error' }); continue; }
      const digest = hash(raw);
      const base = { file, bytes: raw.length, sha256: digest };
      const old = previous && previous.censusVersion === 4 && previous.manifest && previous.manifest.find((row) => row.file === file && row.sha256 === digest);
      if (old && previous.occurrences) {
        manifest.push({ ...base, disposition: old.disposition, reason: old.reason || null, metadataHrefsSkipped: old.metadataHrefsSkipped || 0 });
        occurrences.push(...previous.occurrences.filter((row) => row.sourceFile === file));
        continue;
      }
      let links;
      const scanStats = {};
      try { links = extractFile(file, raw.toString('utf8'), scanStats); }
      catch (error) { manifest.push({ ...base, disposition: 'unsupported', reason: error.message }); continue; }
      const possibleUnparsedLink = !links.length && /https?:\/\/|href\s*=|location\.href/i.test(raw.toString('utf8')) && !scanStats.metadataHrefsSkipped;
      manifest.push({ ...base, disposition: links.length ? 'scanned-links' : possibleUnparsedLink ? 'unsupported-construct' : 'scanned-no-links', metadataHrefsSkipped: scanStats.metadataHrefsSkipped || 0 });
      for (const link of links) {
        if (link.resource || RESOURCE_KEYS.has(link.key)) continue;
        const containing = containingRecord(file, link.location, containingPages);
        const containingUrl = containing && containing.url;
        if (!containingUrl) {
          // An absolute off-site URL needs no containing page to classify it.
          if (/^https?:\/\//i.test(link.value) || /^\/\//.test(link.value)) {
            const absolute = classifyNavigation(link.value, 'https://link-audit.invalid/', { sourceHosts, destinationHosts });
            if (absolute.kind === 'external') continue;
          }
          occurrences.push({ id: occurrenceId({ sourceFile: file, field: link.key, location: link.location, original: link.value }), sourceFile: file, field: link.key, location: link.location, original: link.value, classification: 'missing-containing-page' });
          continue;
        }
        const classification = classifyNavigation(link.value, containingUrl, { sourceHosts, destinationHosts });
        if (classification.kind !== 'internal' && classification.kind !== 'stateful') continue;
        occurrences.push({
          id: occurrenceId({ sourceFile: file, field: link.key, location: link.location, original: link.value }),
          sourceFile: file, sourceRecordId: containing.recordId || null, targetRecordId: containing.targetRecordId || null,
          recordType: containing.recordType || null, targetContentRevision: containing.targetContentRevision || null,
          field: containing.contentField || link.contentField || link.key, location: link.location, containingUrl,
          original: link.value, classification: classification.kind === 'stateful' ? 'stateful-navigation' : 'internal-navigation',
          originalPath: classification.path, ...(classification.fragmentOnly ? { fragmentOnly: true } : {}),
        });
      }
    }
  }
  const scannedFiles = new Set(manifest.map((row) => row.file));
  for (const file of expectedFiles) if (!scannedFiles.has(file)) manifest.push({ file, disposition: 'missing', reason: 'capture-file-absent' });
  return { manifest, occurrences, counts: {
    files: manifest.length, bytes: manifest.reduce((sum, row) => sum + (row.bytes || 0), 0),
    internalOccurrences: occurrences.filter((row) => ['internal-navigation', 'stateful-navigation'].includes(row.classification)).length,
    distinctInternalDestinations: new Set(occurrences.filter((row) => row.originalPath).map((row) => row.originalPath)).size,
    unsupportedFiles: manifest.filter((row) => ['unsupported', 'unsupported-construct', 'unreadable', 'missing'].includes(row.disposition)).length,
    metadataHrefsSkipped: manifest.reduce((sum, row) => sum + (row.metadataHrefsSkipped || 0), 0),
    scanMs: Date.now() - started,
  } };
}

module.exports = { decodeHtmlEntities, htmlAttributes, extractJson, extractFile, census };
