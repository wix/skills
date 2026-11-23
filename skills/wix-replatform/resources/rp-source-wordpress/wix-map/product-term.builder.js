'use strict';

// WooCommerce product category / product tag name -> Wix name (product-category.json category-name,
// product-tag.json tag-name). `(record, { args })` returns `{ values }` (lib/plan-builder.js).
// Import everything: a term with no name is written, never omitted or held. Its name falls back to
// the decoded slug, else "<args.label> <source id>", and a finding carries the grouped cutover
// task (the loop records a finding that has an action on the landed record: import-task-runner).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'" };
function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => (Object.hasOwn(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : m));
}
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
function decodeSlug(slug) {
  if (blank(slug)) return undefined;
  let out;
  try { out = decodeURIComponent(String(slug)); } catch { out = String(slug); }
  return out.trim() || undefined;
}

const TASKS = {
  'product-category': { code: 'product-category-name-missing', label: 'Category' },
  'product-tag': { code: 'product-tag-name-missing', label: 'Tag' },
};

function termName(record, { args = {} } = {}) {
  const name = blank(record.name) ? undefined : decodeEntities(record.name).trim();
  if (name) return { values: { name } };
  const task = TASKS[args.sourceEntity] || TASKS['product-category'];
  const fallback = decodeSlug(record.slug) || `${args.label || task.label} ${record.id}`;
  return {
    values: { name: fallback },
    findings: [{
      code: task.code,
      action: `These ${args.sourceEntity === 'product-tag' ? 'tags' : 'categories'} have no name in the source, so each was imported with a fallback name (its slug, else "${args.label || task.label} <source id>"; each record lists it). Rename them in Business Manager > Store Products, or keep the fallback.`,
      operatorRole: 'Cutover Operator',
      severity: 'low',
      fallbackName: fallback,
    }],
  };
}

module.exports = { termName, TASKS };
