'use strict';

// SEO tag rules for the seo/* writers : which tags an import may write, how a read is
// merged with what the import brings (every SEO write replaces in full, with no revision check),
// and how a read-back proves a write landed. Pure functions; the builders and executors are in
// wix-writers.js.
//
// robots is never written by an import, at site, pattern or item level. Indexing is a launch
// decision. A robots tag the target already has is kept verbatim, because leaving it out of a
// full-replacement write would change indexing just as surely as writing one.

const ITEM_SEO_ITEM_TYPES = Object.freeze(['BLOG_POST']);
// Bulk Set Item SEO Tags: 100 entries per call, but BLOG_POST is capped lower
// (BULK_CHUNK_SIZE_EXCEEDED names the limit; docs read 2026-10-27).
const ITEM_SEO_BULK_LIMITS = Object.freeze({ BLOG_POST: 20 });
const ITEM_SEO_MAX_TAGS = 100;
const ITEM_SEO_MAX_FOCUS_KEYWORDS = 5;
const TAG_TYPES = Object.freeze(['title', 'meta', 'script', 'link']);
const SITE_VERIFICATION_NAMES = Object.freeze(['google-site-verification', 'msvalidate.01', 'p:domain_verify', 'yandex-verification']);
const PATTERN_SOURCE_USER = 'PATTERN_SOURCE_USER';

function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
const lower = value => String(value || '').trim().toLowerCase();

// One identity per tag that a later write replaces: the title, a meta by name or property, a
// link by rel (and hreflang), a script by its type.
function tagIdentity(tag) {
  const props = (tag && tag.props) || {};
  switch (tag && tag.type) {
    case 'title': return 'title';
    case 'meta': return props.property ? `meta:property:${lower(props.property)}` : `meta:name:${lower(props.name)}`;
    case 'link': return `link:${lower(props.rel)}${props.hreflang ? `:${lower(props.hreflang)}` : ''}`;
    case 'script': return `script:${lower(props.type)}`;
    default: return null;
  }
}
function tagValue(tag) {
  if (!tag) return undefined;
  if (tag.type === 'title' || tag.type === 'script') return tag.children;
  if (tag.type === 'link') return tag.props && tag.props.href;
  return tag.props && tag.props.content;
}
const isRobots = tag => tagIdentity(tag) === 'meta:name:robots';
const isCanonical = tag => tagIdentity(tag) === 'link:canonical';
const isNoindex = tag => isRobots(tag) && /(^|[\s,])(noindex|none)($|[\s,])/i.test(String(tagValue(tag) || ''));
const sameTag = (a, b) => canonicalJson(a) === canonicalJson(b);
const keptFromTarget = (tag, preserved) => (preserved || []).some(p => sameTag(p, tag));

function assertTagShape(tag, where) {
  if (!tag || typeof tag !== 'object' || !TAG_TYPES.includes(tag.type)) throw new Error(`${where}: tag type must be one of ${TAG_TYPES.join(', ')}`);
  if (tag.type === 'title' && (typeof tag.children !== 'string' || !tag.children.trim())) throw new Error(`${where}: a title tag needs non-empty children`);
  if (tag.type === 'meta' && (!tag.props || !(tag.props.name || tag.props.property) || typeof tag.props.content !== 'string')) throw new Error(`${where}: a meta tag needs props.name or props.property and a string props.content`);
  if (tag.type === 'link' && (!tag.props || !tag.props.rel || typeof tag.props.href !== 'string')) throw new Error(`${where}: a link tag needs props.rel and props.href`);
  if (tag.type === 'script' && (!tag.props || !tag.props.type || typeof tag.children !== 'string')) throw new Error(`${where}: a script tag needs props.type and children`);
}

// Item level (item 4): robots and canonical are never written by an import. A source canonical is
// either the page itself, which Wix generates, or an old-site URL, which is the redirect helper's job.
// `preserved` are tags the item already has in Wix, which a full-replacement write must keep.
function assertItemTags(tags, { preserved = [] } = {}) {
  if (!Array.isArray(tags)) throw new Error('item SEO tags: tags must be an array');
  if (tags.length > ITEM_SEO_MAX_TAGS) throw new Error(`item SEO tags: at most ${ITEM_SEO_MAX_TAGS} tags per item`);
  tags.forEach((tag, i) => {
    assertTagShape(tag, `item SEO tags[${i}]`);
    if ((isRobots(tag) || isCanonical(tag)) && !keptFromTarget(tag, preserved)) throw new Error(`item SEO tags[${i}]: ${isRobots(tag) ? 'robots' : 'canonical'} is never written by an import`);
  });
}
// What the executor takes out before a write, recorded as an exclusion rather than dropped.
function splitItemExclusions(tags) {
  const kept = [], exclusions = [];
  for (const tag of tags || []) {
    if (isRobots(tag)) exclusions.push({ reasonCode: 'item-robots-not-written', tag });
    else if (isCanonical(tag)) exclusions.push({ reasonCode: 'source-canonical-not-written', tag });
    else kept.push(tag);
  }
  return { tags: kept, exclusions };
}

// Site level: only the default share image and search-engine verification tags.
function assertSiteTags(tags, { preserved = [] } = {}) {
  if (!Array.isArray(tags)) throw new Error('site SEO tags: tags must be an array');
  const providers = new Set();
  tags.forEach((tag, i) => {
    const where = `site SEO tags[${i}]`;
    if (keptFromTarget(tag, preserved)) return;
    if (isRobots(tag)) throw new Error(`${where}: site-noindex-refused: robots is never written by an import (indexing is a launch decision)`);
    assertTagShape(tag, where);
    if (tag.type !== 'meta') throw new Error(`${where}: site SEO tags accept meta tags only`);
    const id = tagIdentity(tag);
    if (id === 'meta:property:og:image') {
      if (!/^https:\/\/static\.wixstatic\.com\//.test(tag.props.content)) throw new Error(`${where}: og:image must be a Wix media URL (https://static.wixstatic.com/...)`);
      return;
    }
    const name = lower(tag.props.name);
    if (!SITE_VERIFICATION_NAMES.includes(name)) throw new Error(`${where}: only og:image and verification tags (${SITE_VERIFICATION_NAMES.join(', ')}) are imported at site level`);
    if (providers.has(name)) throw new Error(`${where}: one ${name} tag per site`);
    providers.add(name);
  });
}
// An og:image tag passed in `tags` is never written: the share image comes only through
// setSiteSeoTags' shareImage (the granted media id), so a URL from the mapping is never sent.
const isShareImage = tag => { try { return tagIdentity(tag) === 'meta:property:og:image'; } catch { return false; } };
function splitSiteExclusions(tags) {
  const kept = [], exclusions = [];
  for (const tag of tags || []) {
    if (isRobots(tag)) exclusions.push({ reasonCode: 'site-noindex-refused', noindex: isNoindex(tag), tag });
    else if (isShareImage(tag)) exclusions.push({ reasonCode: 'site-og-image-not-written', tag });
    else kept.push(tag);
  }
  return { tags: kept, exclusions };
}

// Patterns: robots is refused like everywhere else; any other tag shape Wix accepts.
function assertPatternTags(tags, { preserved = [] } = {}) {
  if (!Array.isArray(tags) || !tags.length) throw new Error('SEO pattern: at least one tag is required');
  tags.forEach((tag, i) => {
    assertTagShape(tag, `SEO pattern tags[${i}]`);
    if (isRobots(tag) && !keptFromTarget(tag, preserved)) throw new Error(`SEO pattern tags[${i}]: robots is never written by an import (indexing is a launch decision)`);
  });
}
function splitPatternExclusions(tags) {
  const kept = [], exclusions = [];
  for (const tag of tags || []) (isRobots(tag) ? exclusions.push({ reasonCode: 'pattern-robots-not-written', tag }) : kept.push(tag));
  return { tags: kept, exclusions };
}

// A full-replacement write: keep every current tag whose identity the import does not bring, and
// replace the identities it does. Robots on the target are always kept as they are.
function mergeTags(current, incoming) {
  const replaced = new Set((incoming || []).filter(tag => !isRobots(tag)).map(tagIdentity));
  return [...(current || []).filter(tag => isRobots(tag) || !replaced.has(tagIdentity(tag))), ...(incoming || []).filter(tag => !isRobots(tag))];
}
const preservedRobots = current => (current || []).filter(isRobots);
const tagsEqual = (a, b) => canonicalJson([...(a || [])].sort((x, y) => canonicalJson(x).localeCompare(canonicalJson(y)))) === canonicalJson([...(b || [])].sort((x, y) => canonicalJson(x).localeCompare(canonicalJson(y))));

// Item read-back: each written tag must resolve from the item itself with the written value.
// A success response proves nothing (2026-08-27: per-entry success, nothing persisted).
function checkItemReadBack(itemSeoTags, written, focusKeywords) {
  const failures = [];
  const resolved = (itemSeoTags && itemSeoTags.resolvedTags) || [];
  for (const tag of written || []) {
    const id = tagIdentity(tag), matches = resolved.filter(entry => tagIdentity(entry && entry.tag) === id);
    if (!matches.some(entry => entry.source === 'TAG_SOURCE_ITEM' && tagValue(entry.tag) === tagValue(tag))) failures.push({ identity: id, resolvedSource: matches[0] ? matches[0].source : null });
  }
  if (focusKeywords) {
    const terms = new Set(((itemSeoTags && itemSeoTags.focusKeywords) || []).map(k => k && k.term));
    for (const keyword of focusKeywords) if (!terms.has(keyword.term)) failures.push({ identity: `focusKeyword:${keyword.term}`, resolvedSource: null });
  }
  return failures;
}
function checkStoredTags(stored, written) {
  return (written || []).filter(tag => !(stored || []).some(s => tagIdentity(s) === tagIdentity(tag) && tagValue(s) === tagValue(tag))).map(tag => ({ identity: tagIdentity(tag) }));
}

// {{variable}} names a pattern uses, and the ones List SEO Pattern Variables allows.
function patternVariables(tags) {
  const out = new Set();
  for (const value of JSON.stringify(tags || []).matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) out.add(value[1]);
  return [...out];
}
function allowedVariables(response) {
  const names = new Set();
  for (const v of [...((response && response.variables) || []), ...((response && response.structuredDataVariables) || [])]) {
    const name = typeof v === 'string' ? v : v && (v.name || v.key || v.variable || v.value);
    if (name) names.add(String(name).replace(/^\{\{\s*|\s*\}\}$/g, ''));
  }
  return names;
}

// Cutover hand-off: the completion report's structured operatorActions[] rows
// for what the SEO writers returned. Pass `{ site, patterns, items }` (each the executor's return
// value or a list of them, or nothing); the generated importer calls it on every run and appends
// the rows to the completion input.
// Per-record write failures are not repeated here: they are journal rows and failed_* counts.
function seoOperatorActions({ site = [], patterns = [], items = [] } = {}) {
  const list = value => (Array.isArray(value) ? value : value ? [value] : []);
  const sites = list(site), pats = list(patterns), itemRows = list(items).flatMap(r => r.results || []);
  const rows = [];
  // Every run, whatever was written: indexing is a launch decision. High when the source asked for
  // noindex/none at any level (site, pattern or item) and the import left it out.
  {
    const excluded = [...sites, ...pats, ...itemRows].flatMap(r => r.exclusions || []);
    const refused = excluded.some(e => e.noindex === true || isNoindex(e.tag));
    rows.push({ actionId: 'seo:site-indexing-launch-decision', code: 'site-indexing-launch-decision', severity: refused ? 'high' : 'medium', role: 'cutover-operator', entity: 'seo/site-seo-tags', affectedCount: 1,
      action: `Decide in Business Manager > Marketing & SEO > SEO settings whether search engines may index the site.${refused ? ' The source asked for noindex; the import did not apply it.' : ''} The import never changes indexing.`,
      deadlineReason: 'Indexing is a launch decision; settle it before the DNS switch.', resolutionEvidence: 'Operator confirmation in the cutover checklist.' });
  }
  const replaced = pats.filter(r => r.previousSitePattern && ['verified', 'unverified-after-success', 'unknown'].includes(r.outcome));
  if (replaced.length) rows.push({ actionId: 'seo:site-pattern-replaced', code: 'site-pattern-replaced', severity: 'low', role: 'cutover-operator', entity: 'seo/seo-pattern', affectedCount: replaced.length, affectedIds: replaced.map(r => r.pageType),
    action: 'The source SEO pattern replaced a pattern the site already had. Keep it, or restore the previous pattern (in the import result) in Business Manager.', deadlineReason: 'Before go-live sign-off.', resolutionEvidence: 'Operator confirmation in the cutover checklist.' });
  const manual = pats.filter(r => ['invalid-variable', 'setup-missing-app', 'unsupported-page-type'].includes(r.outcome));
  if (manual.length) rows.push({ actionId: 'seo:pattern-not-written', code: 'seo-pattern-not-written', severity: 'medium', role: 'cutover-operator', entity: 'seo/seo-pattern', affectedCount: manual.length, affectedIds: manual.map(r => `${r.pageType}:${r.outcome}`),
    action: 'These source SEO patterns were not written (unknown template variable, missing app, or unsupported page type). Set them by hand in Business Manager, or accept the Wix default.', deadlineReason: 'Before go-live sign-off.', resolutionEvidence: 'Pattern read in Business Manager, or operator acceptance.' });
  const shareImages = sites.flatMap(r => r.exclusions || []).filter(e => e.reasonCode === 'site-og-image-not-written');
  if (shareImages.length) rows.push({ actionId: 'seo:site-share-image-not-written', code: 'site-share-image-not-written', severity: 'low', role: 'cutover-operator', entity: 'seo/site-seo-tags', affectedCount: shareImages.length,
    affectedIds: [...new Set(shareImages.map(e => String(e.tag?.props?.content || '')).filter(Boolean))],
    action: `The source default social share image (og:image) was not written (${[...new Set(shareImages.map(e => e.cause || 'not-imported'))].sort().join(', ')}): its own image did not import, or the write did not read back. Set it in Business Manager > Marketing & SEO > SEO settings (social share image), using the source image listed here, or accept the Wix default.`,
    deadlineReason: 'Before go-live sign-off: shared links show the Wix default image until then.', resolutionEvidence: 'Share image shown in Business Manager SEO settings, or operator acceptance.' });
  const notWritten = [...sites.flatMap(r => r.exclusions || []).filter(e => e.reasonCode !== 'site-og-image-not-written'), ...pats.flatMap(r => r.exclusions || []), ...itemRows.flatMap(r => r.exclusions || [])];
  if (notWritten.length) {
    const codes = [...new Set(notWritten.map(e => e.reasonCode))].sort();
    rows.push({ actionId: 'seo:tags-not-written', code: 'seo-tags-not-written', severity: 'low', role: 'site-owner', entity: 'seo/item-seo-tags', affectedCount: notWritten.length, affectedIds: codes,
      action: 'Source robots and canonical tags were not carried over; Wix defaults apply. Old-URL redirects are handled separately (the redirect helper).', deadlineReason: 'Informational; no action needed before go-live.', resolutionEvidence: 'None required.' });
  }
  return rows;
}

module.exports = {
  ITEM_SEO_ITEM_TYPES, ITEM_SEO_BULK_LIMITS, ITEM_SEO_MAX_TAGS, ITEM_SEO_MAX_FOCUS_KEYWORDS,
  SITE_VERIFICATION_NAMES, PATTERN_SOURCE_USER,
  tagIdentity, tagValue, isRobots, isNoindex, isCanonical,
  assertItemTags, splitItemExclusions, assertSiteTags, splitSiteExclusions, assertPatternTags, splitPatternExclusions,
  mergeTags, preservedRobots, tagsEqual, checkItemReadBack, checkStoredTags, patternVariables, allowedVariables, seoOperatorActions,
};
