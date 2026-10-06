#!/usr/bin/env node
// Resolves every @wix/patterns name a page needs in one call, from both doc indices.
//
//   node patterns-lookup.cjs Table useTableCollection stringsArrayFilter DateRangeFilter
//   node patterns-lookup.cjs --templates      # every page template, its files, and the guide choosing between them
//
// For each name it prints what WIX_PATTERNS_DOCS.md's discovery chain would have you look up
// by hand: the entry's summary, where to import it from, its examples, and the ONE file that
// answers "what props" — the .d.ts when the entry has a bundle, the doc's props table when it
// has none, never both. A bundle that stubs its parent says so, with the files that hold the
// rest.
//
// It exists because the chain was walked one probe at a time. Recorded runs wrote their own
// python3 one-liners against index.json, four and five times per run, a symbol or two each,
// and read a doc page and a bundle for the same component. Pass every name you plan to write;
// a name you add later is another call, which is the cost this replaces.
//
// Exits 1 when any name is in neither index, after printing the near misses. A wrong guess
// compiles and breaks at runtime, so a miss is not something to work around.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag >= 0 ? args.splice(rootFlag, 2)[1] : null;
const templates = args.includes('--templates');
const names = args.filter((a) => !a.startsWith('--'));
if (!names.length && !templates) {
  console.error('usage: patterns-lookup.cjs [--root <pkgRoot>] [--templates] [<name> …]');
  process.exit(2);
}

const pkgRoot = root ?? execFileSync(process.execPath, [path.join(__dirname, 'pkg-root.cjs'), '@wix/patterns'], { encoding: 'utf8' }).trim();
const readIndex = (rel) => {
  const file = path.join(pkgRoot, rel);
  if (!fs.existsSync(file)) {
    console.error(`${rel} is missing under ${pkgRoot} — this @wix/patterns predates the doc indices; upgrade it (WIX_PATTERNS_DOCS.md, Prerequisites)`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const docs = readIndex('dist/docs/index.json');
const types = readIndex('dist/dts-bundle/index.json');

// The docs index is keyed by Storybook title, so a name may be an alias under another key:
// `CollectionToolbarFilters` lives under `ToolbarFilters`.
const byAlias = new Map();
for (const [key, entry] of Object.entries(docs)) {
  for (const symbol of entry.symbols ?? []) if (!byAlias.has(symbol)) byAlias.set(symbol, key);
}

function find(name) {
  if (docs[name]) return { key: name, doc: docs[name] };
  if (byAlias.has(name)) return { key: byAlias.get(name), doc: docs[byAlias.get(name)], alias: true };
  if (types[name]) return { key: name, doc: null };
  return null;
}

function nearMisses(name) {
  const lower = name.toLowerCase();
  const all = [...new Set([...Object.keys(docs), ...byAlias.keys(), ...Object.keys(types)])];
  const exactCase = all.filter((k) => k.toLowerCase() === lower);
  if (exactCase.length) return exactCase;
  return all.filter((k) => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())).slice(0, 6);
}

const kb = (bytes) => (bytes == null ? '' : ` (${bytes.toLocaleString('en-US')} B)`);
let missing = 0;
const out = [];

if (templates) {
  // Templates are entries with category "Templates"; a guide lists them as relatedTemplates.
  const found = Object.entries(docs).filter(([, e]) => e.category === 'Templates');
  if (!found.length) {
    console.error('no Templates entries: this @wix/patterns predates page templates — upgrade it (DRAFT_TEMPLATE.md)');
    process.exit(1);
  }
  for (const [key, e] of found) {
    out.push(`## ${key} (template)`, `summary: ${String(e.summary ?? '').replace(/\s+/g, ' ').trim()}`,
      `files: ${[].concat(e.templateFiles ?? []).map((f) => `dist/templates/${f}`).join(' · ')}`, '');
  }
  for (const [key, e] of Object.entries(docs).filter(([, x]) => x.relatedTemplates)) {
    out.push(`## ${key} (guide) — chooses between: ${[].concat(e.relatedTemplates).join(', ')}`, `doc: dist/docs/${e.file}`, '');
  }
}

for (const name of names) {
  const hit = find(name);
  if (!hit) {
    missing += 1;
    const near = nearMisses(name);
    out.push(`## ${name} — NOT in either index${near.length ? `; did you mean: ${near.join(', ')}` : ''}`, '');
    continue;
  }
  const { key, doc, alias } = hit;
  // The bundle index carries the triage the docs index lacks — own against inherited props,
  // bytes, readWith — keyed by the symbol, so look it up by the name asked for first.
  const type = types[name] ?? types[key] ?? null;
  const status = doc?.status ?? type?.status;
  const statusMessage = doc?.statusMessage ?? type?.statusMessage;

  out.push(`## ${name}${alias ? ` (documented under ${key})` : ''}`);
  if (status === 'deprecated') out.push(`DEPRECATED — ${statusMessage ?? 'see its doc'}. Use what that names.`);
  const importPath = doc?.importPath ?? type?.importPath;
  out.push(`import: ${importPath ?? 'none — a guide, or documented but not exported'}${type?.kind ? ` · ${type.kind}` : ''}`);
  if (doc?.summary) out.push(`summary: ${doc.summary.replace(/\s+/g, ' ').trim()}`);

  const examples = (doc?.examples ?? []).map((e) => `dist/examples/${e}`);
  if (examples.length) out.push(`examples: ${examples.slice(0, 3).join(' · ')}${examples.length > 3 ? ` (+${examples.length - 3} more in the entry)` : ''}`);
  if (doc?.templateFiles) out.push(`template: ${[].concat(doc.templateFiles).map((f) => `dist/templates/${f}`).join(' · ')}`);

  // One props file, never two (WIX_PATTERNS_DOCS.md step 4).
  const bundle = doc?.bundle ?? type?.file;
  if (bundle) {
    const split = type?.ownProps != null && type?.inheritedProps ? ` — declares ${type.ownProps} of ${type.ownProps + type.inheritedProps} props` : '';
    const label = !type?.kind || type.kind === 'component' ? 'props' : 'declaration';
    out.push(`${label}: dist/dts-bundle/${bundle}${kb(type?.bytes)}${split}. The doc's "### Props" is only a pointer: don't read it as well.`);
    if (split && type.readWith?.length) {
      out.push(`  the rest: the parent the file's stub names, among ${type.readWith.map((f) => `dist/dts-bundle/${f}`).join(', ')} — read that one file, in the same call as anything else`);
    }
  } else if (doc?.file) {
    out.push(`props: the "### Props" table in dist/docs/${doc.file} (no bundle)`);
  }
  if (doc?.file) out.push(`doc: dist/docs/${doc.file} — for wiring, defaults and gotchas the summary does not answer`);
  for (const v of doc?.variants ?? type?.variants ?? []) {
    out.push(`variant: ${v.importPath} → dist/dts-bundle/${v.bundle ?? v.file}${v.doc ? ` (doc: dist/docs/${v.doc})` : ''}`);
  }
  out.push('');
}

process.stdout.write(`${out.join('\n').trim()}\n`);
process.exit(missing ? 1 : 0);
