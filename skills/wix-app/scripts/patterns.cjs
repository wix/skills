#!/usr/bin/env node
// Batch reader for the @wix/patterns component docs shipped at
// node_modules/@wix/patterns/dist/docs/ (165+ .md files + index.json).
//
// Exists so the agent never has to locate, list, or crawl node_modules itself:
// resolution (pnpm, Yarn PnP, workspaces, symlinks) is handled here, and a whole
// component triad is one invocation instead of one read per file.

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
    `Do NOT install or upgrade it yourself — tell the user that dashboard page UI`,
    `needs ${PKG} >= ${MIN_VERSION} and let them decide.`,
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
    `Do NOT install or upgrade it yourself — report this to the user and stop.`,
    `Component docs are unavailable, so patterns components cannot be looked up.`,
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
  console.log(`Read the docs you need in one call: patterns.cjs docs <Name1> <Name2> ...`);
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

function cmdDocs(args) {
  const withRefs = args.includes('--refs');
  const requested = args.filter((a) => a !== '--refs');
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
        : `Skipped "${input}" — not a documented name. Run: patterns.cjs list`,
    );
  }

  if (queue.length === 0) {
    fail(['Error: none of the requested names are documented. Run: patterns.cjs list']);
  }

  const pending = new Set();
  const printed = [];

  // Index-order iteration so --refs pulls in one level of cross-references
  // (refs of refs are reported, not printed, to keep output bounded).
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

    if (printed.length) console.log('\n---\n');
    console.log(`# ${name}  (${index[name].category}, ${index[name].file})`);
    console.log('');
    console.log(body.trim());
    printed.push(name);

    for (const ref of crossRefs(body)) {
      if (seen.has(ref)) continue;
      if (withRefs && i < requested.length) {
        seen.add(ref);
        queue.push(ref);
      } else {
        pending.add(ref);
      }
    }
  }

  const remaining = [...pending].filter((n) => !printed.includes(n)).sort();
  if (remaining.length) {
    console.log('\n---\n');
    console.log(`Cross-referenced but not printed (${remaining.length}):`);
    console.log(`  ${remaining.join(', ')}`);
    console.log('');
    console.log(`Read the ones you actually need in one call:`);
    console.log(`  patterns.cjs docs ${remaining.slice(0, 4).map((n) => (n.includes(' ') ? `"${n}"` : n)).join(' ')}`);
  }
}

function usage() {
  console.log(`@wix/patterns docs reader — ${PKG}@${installedVersion}
Docs found at: ${docsDir}

  patterns.cjs list                          Component inventory by category
  patterns.cjs docs <Name1> <Name2> ...      Print those docs in ONE call
  patterns.cjs docs <Name> --refs            ...and follow cross-references one level

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
  case undefined:
  case '--help':
  case '-h':
    usage();
    break;
  default:
    fail([`Error: unknown command "${cmd}".`, '', 'Run: patterns.cjs --help']);
}
