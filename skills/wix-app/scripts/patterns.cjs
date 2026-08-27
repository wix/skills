#!/usr/bin/env node
// Batch reader for the @wix/patterns component docs shipped at
// node_modules/@wix/patterns/dist/docs/ (165+ .md files + index.json).
//
// Exists so the agent never has to locate, list, or crawl node_modules itself:
// resolution (pnpm, Yarn PnP, workspaces, symlinks) is handled here, a whole
// component triad is one invocation instead of one read per file, and `types`
// answers the TypeScript questions the docs don't cover — otherwise the only
// way to answer them is the node_modules crawl the skill forbids.

const fs = require('fs');
const path = require('path');

const PKG = '@wix/patterns';
const MIN_VERSION = '1.367.0'; // first version that ships dist/docs/

// --- locating the docs ------------------------------------------------------

// Yarn Berry keeps packages in a zip-backed vfs; without this, require.resolve
// below cannot see them.
function tryEnablePnp() {
  let dir = process.cwd();
  for (;;) {
    const pnp = path.join(dir, '.pnp.cjs');
    if (fs.existsSync(pnp)) {
      try {
        require(pnp).setup();
      } catch {
        // A broken or already-installed PnP runtime is not fatal — fall through
        // to the other resolution strategies.
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function findPkgRoot() {
  tryEnablePnp();

  try {
    const manifest = require.resolve(`${PKG}/package.json`, { paths: [process.cwd()] });
    return path.dirname(manifest);
  } catch {
    // Not resolvable from cwd — fall back to walking up for node_modules.
  }

  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...PKG.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function fail(lines) {
  console.error(lines.join('\n'));
  process.exit(1);
}

const pkgRoot = findPkgRoot();
if (!pkgRoot) {
  fail([
    `Error: ${PKG} is not installed in this project.`,
    `Install it, then re-run this command:  npm install ${PKG}@^${MIN_VERSION}`,
  ]);
}

let installedVersion = 'unknown';
try {
  installedVersion = JSON.parse(
    fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'),
  ).version;
} catch {
  // Version is informational only; a missing/malformed manifest is not fatal.
}

const docsDir = path.join(pkgRoot, 'dist', 'docs');
const indexPath = path.join(docsDir, 'index.json');
if (!fs.existsSync(indexPath)) {
  fail([
    `Error: ${PKG}@${installedVersion} ships no dist/docs/ (needs >= ${MIN_VERSION}).`,
    `Upgrade it, then re-run this command:  npm install ${PKG}@^${MIN_VERSION}`,
  ]);
}

let index;
try {
  index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
} catch (e) {
  fail([`Error: could not parse ${indexPath}: ${e.message}`]);
}

const names = Object.keys(index);

// --- name resolution --------------------------------------------------------

const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));

function resolveName(input) {
  if (Object.prototype.hasOwnProperty.call(index, input)) return input;
  return byLower.get(input.toLowerCase()) || null;
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

function suggest(input) {
  const q = input.toLowerCase();
  const substring = names.filter((n) => n.toLowerCase().includes(q));
  if (substring.length) return substring.slice(0, 8);
  // Nothing contains the query — it is probably a typo, so fall back to near
  // matches rather than sending the agent off to browse the whole inventory.
  return names
    .map((n) => ({ n, d: editDistance(q, n.toLowerCase()) }))
    .filter(({ d }) => d <= Math.max(2, Math.floor(q.length / 4)))
    .sort((x, y) => x.d - y.d)
    .slice(0, 5)
    .map(({ n }) => n);
}

// --- commands ---------------------------------------------------------------

// Hints have to echo the path this script was actually invoked with. A bare
// "patterns.cjs docs ..." is not runnable from the project directory, and the
// agent has no reason to know where the skill was installed.
function self() {
  return `node ${process.argv[1]}`;
}

function cmdList() {
  const byCategory = new Map();
  for (const name of names) {
    // Full category paths are near-unique (78 for 167 names), so group on the
    // first two segments to get a browsable inventory rather than a flat list.
    const full = index[name].category || 'Uncategorized';
    const category = full.split('/').slice(0, 2).join('/');
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(name);
  }
  console.log(`${PKG}@${installedVersion} — ${names.length} documented names\n`);
  for (const category of [...byCategory.keys()].sort()) {
    console.log(`## ${category}`);
    console.log(`  ${byCategory.get(category).sort().join(', ')}`);
    console.log('');
  }
  console.log(`Read the docs you need in one call:`);
  console.log(`  ${self()} docs <Name1> <Name2> ...`);
  console.log(``);
  console.log(`For a TypeScript type rather than a component (RangeItem, CursorQuery, ...):`);
  console.log(`  ${self()} types <Name>`);
}

// Cross-references are Storybook links whose *text* is the component name —
// the href is a story path, not a filename, so the text is what maps back to
// index.json.
function crossRefs(markdown) {
  const found = new Set();
  for (const m of markdown.matchAll(/\[([^\]\n]+)\]\(\.\/\?path=[^)]*\)/g)) {
    const name = resolveName(m[1].trim());
    if (name) found.add(name);
  }
  return found;
}

// --- compact rendering ---------------------------------------------------
//
// Whole doc files are too large to hand back: Table.md is 1,083 lines with its
// props table at line 986, ToolbarFilters.md is 1,580 with the table at 1,554.
// An agent handed that output defends itself with `head`, which cuts off the
// one section it needed. So compact is the default: the import, the API table,
// and one usage example — about a tenth of the bytes, with the props intact.

const SECTION_RE = /^## /;

function splitSections(body) {
  const out = [];
  let current = { heading: null, lines: [] };
  for (const line of body.split('\n')) {
    if (SECTION_RE.test(line)) {
      out.push(current);
      current = { heading: line.trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  out.push(current);
  return out.filter((s) => s.heading !== null || s.lines.some((l) => l.trim()));
}

// Only 3 of 167 docs have an `## Import` heading, but 131 carry an import
// statement somewhere in a code fence — so match the statement, not a section.
function firstImport(body) {
  const m = body.match(/^import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+?)\s*from\s*'[^']+';?$/m);
  return m ? m[0] : null;
}

// The first fence in a doc is usually the import line, and some docs open with
// two of them — so pick the first fence that actually shows usage rather than
// re-printing imports the caller already has.
function firstUsageFence(text) {
  const fences = text.match(/```[\s\S]*?```/g) || [];
  for (const f of fences) {
    const inner = f
      .split('\n')
      .slice(1, -1)
      .filter((l) => l.trim() && !/^\s*import\s/.test(l) && !/^\s*}\s*from\s*'/.test(l));
    if (inner.length) return f;
  }
  return null;
}

const FALLBACK_CAP = 150;

function compactDoc(body, withExample) {
  const sections = splitSections(body);
  const api = sections.filter((s) => s.heading && s.heading.startsWith('## API'));

  // 26 of 167 docs carry their contract in prose rather than an API table.
  // There is nothing to extract, so hand back the body and cap the long ones.
  if (api.length === 0) {
    const all = body.split('\n');
    if (all.length <= FALLBACK_CAP) return { text: body, omitted: 0 };
    return {
      text: all.slice(0, FALLBACK_CAP).join('\n'),
      omitted: all.length - FALLBACK_CAP,
    };
  }

  const imp = firstImport(body);
  const parts = [];
  if (imp) parts.push('```tsx\n' + imp + '\n```');

  // API before the example, deliberately. The props table is the payload; if
  // anything downstream truncates this output, it has to lose the example.
  for (const s of api) parts.push(s.lines.join('\n').trim());

  if (withExample) {
    const example = firstUsageFence(body);
    if (example) parts.push(example);
  }

  const kept = parts.join('\n\n');
  const omitted = body.split('\n').length - kept.split('\n').length;
  return { text: kept, omitted: omitted > 0 ? omitted : 0 };
}

function cmdDocs(args) {
  const withRefs = args.includes('--refs');
  const full = args.includes('--full');
  const requested = args.filter((a) => a !== '--refs' && a !== '--full');
  if (requested.length === 0) {
    fail(['Error: docs needs at least one component name.', 'Usage: patterns.cjs docs <Name1> <Name2> ...']);
  }

  const queue = [];
  const seen = new Set();
  const missing = [];

  for (const input of requested) {
    const name = resolveName(input);
    if (!name) {
      missing.push(input);
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      queue.push(name);
    }
  }

  for (const input of missing) {
    const hits = suggest(input);
    console.error(
      hits.length
        ? `Skipped "${input}" — not a documented name. Did you mean: ${hits.join(', ')}`
        : `Skipped "${input}" — not a documented name. Run: ${self()} list`,
    );
  }

  if (queue.length === 0) {
    fail([`Error: none of the requested names are documented. Run: ${self()} list`]);
  }

  // Ref expansion is bounded to the names actually resolved from the request —
  // not `requested.length`, which still counts the ones that were skipped and
  // would buy the refs of refs an extra level of expansion.
  const rootCount = queue.length;

  // One or two names: show a usage example each. More than that and the examples
  // are what push a later component's props out of reach of anything reading
  // only the first N lines — so drop them and say so.
  // --refs grows the queue after this point, so a one-name --refs call would
  // otherwise keep examples for a dozen docs.
  const withExamples = !withRefs && queue.length <= 2;

  const pending = new Set();
  const printed = [];
  let omittedTotal = 0;

  // Output is buffered so the first line can state the total size. Whether to
  // pipe this through `head` is decided before any output exists, so a footer
  // saying "that was all of it" arrives too late to be read — a header survives
  // the pipe and tells the agent the next call needs no trimming.
  const chunks = [];
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i];
    const file = path.join(docsDir, index[name].file);
    let body;
    try {
      body = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.error(`Skipped "${name}" — could not read ${index[name].file}: ${e.message}`);
      continue;
    }

    const doc = full ? { text: body.trim(), omitted: 0 } : compactDoc(body, withExamples);
    omittedTotal += doc.omitted;

    chunks.push(
      `# ${name}  (${index[name].category}, ${index[name].file})\n\n${doc.text.trim()}`,
    );
    printed.push(name);

    for (const ref of crossRefs(body)) {
      if (seen.has(ref)) continue;
      if (withRefs && i < rootCount) {
        seen.add(ref);
        queue.push(ref);
      } else {
        pending.add(ref);
      }
    }
  }

  const bodyOut = chunks.join('\n\n---\n\n');
  const lineCount = bodyOut.split('\n').length;
  console.log(
    `<< ${printed.length} doc${printed.length === 1 ? '' : 's'}, ${lineCount} lines: import + API${withExamples && !full ? ' + example' : ''}. This is the whole answer — read it, don't pipe it through head. >>`,
  );
  console.log('');
  console.log(bodyOut);

  if (!full && omittedTotal > 0) {
    console.log('\n---\n');
    const what = withExamples
      ? `${omittedTotal} lines of design prose omitted.`
      : `${omittedTotal} lines omitted, including the usage examples — those are shown when you ask for one or two names at a time.`;
    console.log(what);
    console.log(`The whole file for one component: ${self()} docs ${printed[0]} --full`);
  }

  const remaining = [...pending].filter((n) => !printed.includes(n)).sort();
  if (remaining.length) {
    console.log('\n---\n');
    console.log(`Cross-referenced but not printed (${remaining.length}):`);
    console.log(`  ${remaining.join(', ')}`);
    console.log('');
    console.log(`Read the ones you actually need in one call:`);
    console.log(
      `  ${self()} docs ${remaining.slice(0, 4).map((n) => (n.includes(' ') ? `"${n}"` : n)).join(' ')}`,
    );
  }
}

// --- types ------------------------------------------------------------------
//
// The docs cover components, hooks and their props; they do not cover the
// TypeScript types those props are written in, and several of those types are
// re-exported from @wix/bex-core rather than declared here. Without this
// command the only way to answer "where does RangeItem come from" is to read
// node_modules by hand, which is exactly what the skill forbids.

const DECL_RE = (name) =>
  new RegExp(
    `^\\s*(?:export\\s+)?(?:declare\\s+)?(type|interface|class|enum|const|function)\\s+${name}\\b`,
  );

function walkDts(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDts(full, out);
    else if (e.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// A declaration runs to its balanced closing brace, or to the `;` that ends a
// one-line alias. Capped so a giant interface cannot flood the output.
function captureDecl(lines, startIdx, cap = 60) {
  const out = [];
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length && out.length < cap; i++) {
    const line = lines[i];
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth <= 0) break;
    if (!started && /;\s*$/.test(line)) break;
  }
  return out.join('\n');
}

function findDecls(typesDir, name) {
  const re = DECL_RE(name);
  const hits = [];
  for (const file of walkDts(typesDir)) {
    let body;
    try { body = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!body.includes(name)) continue;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (m) {
        hits.push({
          file: path.relative(typesDir, file),
          kind: m[1],
          decl: captureDecl(lines, i),
        });
        break;
      }
    }
    if (hits.length >= 3) break;
  }
  return hits;
}

// index.d.ts is the public surface. A name listed in an `export {...} from 'pkg'`
// is re-exported from another package — worth saying, because the import path
// the agent should write is still '@wix/patterns'.
function reExportSource(typesDir, name) {
  let body;
  try { body = fs.readFileSync(path.join(typesDir, 'index.d.ts'), 'utf8'); } catch { return null; }
  const re = new RegExp(`export\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*'([^']+)'`, 'g');
  for (const m of body.matchAll(re)) {
    const listed = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (listed.includes(name)) return m[2];
  }
  return null;
}

// A re-export can name a subpath ('@wix/bex-core/react'); the package root is
// what has a package.json, so resolve the package name and drop the rest.
function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function resolveSibling(spec) {
  const pkg = packageNameOf(spec);
  try {
    const manifest = require.resolve(`${pkg}/package.json`, { paths: [pkgRoot, process.cwd()] });
    return path.dirname(manifest);
  } catch {
    return null;
  }
}

function cmdTypes(args) {
  if (args.length === 0) {
    fail(['Error: types needs at least one name.', `Usage: ${self()} types <Name1> <Name2> ...`]);
  }
  const typesDir = path.join(pkgRoot, 'dist', 'types');
  if (!fs.existsSync(typesDir)) {
    fail([`Error: ${PKG}@${installedVersion} ships no dist/types/.`]);
  }

  let printed = 0;
  for (const name of args) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      console.error(`Skipped "${name}" — not a TypeScript identifier.`);
      continue;
    }
    if (printed) console.log('\n---\n');
    printed++;

    const external = reExportSource(typesDir, name);
    let hits = findDecls(typesDir, name);
    let declaredIn = PKG;

    if (hits.length === 0 && external) {
      const root = resolveSibling(external);
      const extTypes = root && [path.join(root, 'dist', 'types'), path.join(root, 'dist')].find((d) => fs.existsSync(d));
      if (extTypes) {
        hits = findDecls(extTypes, name);
        declaredIn = external;
      }
    }

    console.log(`# ${name}`);
    console.log('');
    if (external) {
      console.log(`Re-exported by ${PKG} from \`${external}\` — import it from '${PKG}', not from '${external}'.`);
    } else if (hits.length) {
      console.log(`Declared in ${declaredIn}, exported from '${PKG}'.`);
    }

    // Types get `import type`; functions, classes, consts and enums are values
    // at runtime, so a type-only import of them does not compile.
    if (external || hits.length) {
      const kind = hits.length ? hits[0].kind : 'type';
      const typeOnly = kind === 'type' || kind === 'interface';
      console.log('');
      console.log('```ts');
      console.log(`import ${typeOnly ? 'type ' : ''}{ ${name} } from '${PKG}';`);
      console.log('```');
    }

    if (hits.length === 0) {
      console.log('');
      console.log(`No declaration found for "${name}" under dist/types/. Check the spelling, or look for it in a component doc: ${self()} docs <Name>`);
      continue;
    }

    for (const h of hits) {
      console.log('');
      console.log(`## ${declaredIn} — ${h.file}`);
      console.log('');
      console.log('```ts');
      console.log(h.decl.trim());
      console.log('```');
    }
  }
}

function usage() {
  console.log(`@wix/patterns docs reader — ${PKG}@${installedVersion}
Docs found at: ${docsDir}

  ${self()} list                          Component inventory by category
  ${self()} docs <Name1> <Name2> ...      Import + API + one example, per name
  ${self()} docs <Name> --full            ...the whole doc file, design prose included
  ${self()} docs <Name> --refs            ...following cross-references one level
  ${self()} types <Name1> <Name2> ...     TypeScript types the props are written in

Names with spaces must be quoted (e.g. "AI Assistant").`);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'list':
    cmdList();
    break;
  case 'docs':
    cmdDocs(rest);
    break;
  case 'types':
    cmdTypes(rest);
    break;
  case undefined:
  case '--help':
  case '-h':
    usage();
    break;
  default:
    fail([`Error: unknown command "${cmd}".`, '', 'Run: patterns.cjs --help']);
}
