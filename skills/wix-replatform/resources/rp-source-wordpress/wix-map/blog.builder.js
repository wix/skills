'use strict';

// WordPress blog post, blog category and blog tag -> Wix Blog, one export per fieldMappings row of
// post.json, category.json and tag.json. Each is `(record, { lookups, choices, args })` and returns
// `{ values: { <targetPath>: v } }`, `{ loopInput }` or `{ hold: { code } }` (lib/plan-builder.js).
// The post composite (Ricos conversion, featured media, author, publish) is fixed toolkit code; the
// rows here give it the post's fields. Lookups: lookups.ref('blog/category', 'category:<id>') and
// lookups.ref('blog/tag', 'tag:<id>') -> Wix id or undefined (not landed yet).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'", hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => (Object.hasOwn(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : m));
}
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const text = (v) => (blank(v) ? undefined : decodeEntities(v).trim() || undefined);
function decodeSlug(slug) {
  if (blank(slug)) return undefined;
  try { return decodeURIComponent(String(slug)); } catch { return String(slug); }
}
const PUBLISHED = ['publish'];

// post-title: the edit-context title, else the rendered one. Only published posts are imported
// (args.statuses, default publish): a draft never goes live on the new site.
function postTitle(record, { args } = {}) {
  const statuses = (args && Array.isArray(args.statuses)) ? args.statuses : PUBLISHED;
  if (!statuses.includes(record.status)) return { hold: { code: 'blog-post-not-published-at-source' } };
  const title = text(record.title && record.title.raw) || text(record.title && record.title.rendered);
  return title ? { values: { title } } : { hold: { code: 'blog-post-title-missing' } };
}
// post-content: the rendered HTML; the post composite converts it to Ricos and resolves images.
function postContent(record) {
  const html = record.content && typeof record.content.rendered === 'string' ? record.content.rendered : '';
  return { loopInput: { contentHtml: html } };
}
// post-excerpt: plain text (tags stripped, entities decoded).
function postExcerpt(record) {
  const raw = record.excerpt && (record.excerpt.rendered || record.excerpt.raw);
  const value = text(String(raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
  return value ? { values: { excerpt: value } } : undefined;
}
// post-slug: percent-decoded (non-Latin slugs arrive encoded).
function postSlug(record) {
  const slug = decodeSlug(record.slug);
  return slug ? { values: { seoSlug: slug } } : undefined;
}
// post-date: the original publish time, UTC.
function postDate(record) {
  if (blank(record.date_gmt)) return undefined;
  const at = Date.parse(`${String(record.date_gmt).replace(/Z$/, '')}Z`);
  return Number.isFinite(at) ? { values: { firstPublishedDate: new Date(at).toISOString() } } : { hold: { code: 'blog-post-date-invalid' } };
}
function refs(record, list, lookups, ref, prefix, code, field) {
  const resolve = typeof lookups?.ref === 'function' ? lookups.ref : () => undefined;
  const ids = [];
  for (const id of Array.isArray(list) ? list : []) {
    if (blank(id) || id === 0) continue;
    // The concrete target path (`tagIds[0]`): the loop's lookup checks it against the declared field.
    const wixId = resolve(ref, `${prefix}:${id}`, `${field}[${ids.length}]`);
    if (!wixId) return { hold: { code } };
    if (!ids.includes(wixId)) ids.push(wixId);
  }
  return ids;
}
// post-categories: Wix category ids in source order; a category not landed yet holds the post
// until it lands (the loop waits per record).
function postCategories(record, { lookups } = {}) {
  const ids = refs(record, record.categories, lookups, 'blog/category', 'category', 'blog-category-not-landed', 'categoryIds');
  return ids.hold ? ids : { values: { categoryIds: ids } };
}
// post-tags: the same for tags.
function postTags(record, { lookups } = {}) {
  const ids = refs(record, record.tags, lookups, 'blog/tag', 'tag', 'blog-tag-not-landed', 'tagIds');
  if (ids.hold) return ids;
  return ids.length ? { values: { tagIds: ids } } : undefined;
}
// post-featured-media: the composite imports the featured image as the hero image; this row
// names it so an operator can drop it.
function postFeaturedMedia(record) {
  return blank(record.featured_media) || record.featured_media === 0 ? undefined : { loopInput: { featuredMediaId: record.featured_media } };
}

// category-slug (blog category)
function blogCategorySlug(record) {
  const slug = decodeSlug(record.slug);
  return slug ? { values: { slug } } : undefined;
}
// category-description / tag: plain text description.
function blogDescription(record) {
  const value = text(String(record.description || '').replace(/<[^>]*>/g, ' '));
  return value ? { values: { description: value } } : undefined;
}

const ROW_EXPORTS = {
  post: {
    'post-title': 'postTitle', 'post-content': 'postContent', 'post-excerpt': 'postExcerpt', 'post-slug': 'postSlug',
    'post-date': 'postDate', 'post-categories': 'postCategories', 'post-tags': 'postTags', 'post-featured-media': 'postFeaturedMedia',
  },
  category: { 'category-slug': 'blogCategorySlug', 'category-description': 'blogDescription' },
};

module.exports = { postTitle, postContent, postExcerpt, postSlug, postDate, postCategories, postTags, postFeaturedMedia, blogCategorySlug, blogDescription, ROW_EXPORTS };
