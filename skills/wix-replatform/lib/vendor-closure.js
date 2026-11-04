'use strict';
// The vendored toolkit in a project's src/ mirrors the skill's own layout (src/lib <-> lib,
// src/resources/<r> <-> resources/<r>; rp-import-codegen "Vendoring mirrors the skill's layout").
// Copying it by hand misses files: the 2026-11-02 run vendored rp-source-wordpress piecemeal, a new
// lib (plugin-data-presence.js) was not copied, and the import crashed with MODULE_NOT_FOUND hours
// in. This derives the list from the code itself, following what will actually load:
// - project-owned files (generated code: anything in src/ that is not a byte-identical copy of the
//   toolkit file at its mirrored path) are roots, and every relative require() /
//   require.resolve() / path.join(__dirname, '<literal>', ...) they make is followed;
// - from a vendored toolkit file only its top-level (column 0) requires are followed: those load
//   with it. Its lazy requires (indented, inside functions) belong to code paths the project may
//   never take (completion-report's Shopify gift cards in a WordPress project).
// A reached target that is missing while the mirrored toolkit file exists is a gap. vendorClosure
// copies those (and what they reach) to a fixed point; import-contract-verify refuses a project
// that still has a gap. A missing target with no toolkit counterpart is not reported.
const fs = require('node:fs');
const path = require('node:path');

const TOOLKIT_ROOT = path.resolve(__dirname, '..');
const CODE = /\.[cm]?js$/;
const REQUIRE = /\brequire(?:\.resolve)?\(\s*(['"])(\.{1,2}\/[^'"\n]+)\1\s*\)/g;
const JOIN = /\bpath\.join\(\s*__dirname((?:\s*,\s*(['"])[^'"\n]+\2)+)\s*\)/g;

function codeFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? (entry.name === 'node_modules' ? [] : codeFiles(path.join(dir, entry.name)))
    : CODE.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
// Node's own resolution for a relative specifier: the exact file, then the extensions, then index.
function resolved(target) {
  for (const candidate of [target, `${target}.js`, `${target}.cjs`, `${target}.json`, path.join(target, 'index.js')]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}
// The toolkit file a src/ path mirrors, if the skill has one.
function counterpart(src, target, toolkitRoot) {
  const relative = path.relative(src, target);
  if (!/^(?:lib|resources)[/\\]/.test(relative)) return null;
  return resolved(path.join(toolkitRoot, relative));
}
// Relative references in one file: { specifier, topLevel } (topLevel: the statement starts at column 0).
function references(text) {
  const out = [], lineStart = index => text.lastIndexOf('\n', index - 1) + 1;
  const topLevel = index => !/\s/.test(text[lineStart(index)] || '');
  for (const match of text.matchAll(REQUIRE)) out.push({ specifier: match[2], topLevel: topLevel(match.index) });
  for (const match of text.matchAll(JOIN)) out.push({ specifier: path.join(...[...match[1].matchAll(/(['"])([^'"\n]+)\1/g)].map(part => part[2])), topLevel: topLevel(match.index) });
  return out;
}
const slash = value => value.split(path.sep).join('/');
// A src/ file that is a byte-identical copy of the toolkit file at its mirrored path.
function vendoredCopy(src, file, toolkitRoot) {
  const toolkitFile = counterpart(src, file, toolkitRoot);
  return Boolean(toolkitFile) && fs.readFileSync(toolkitFile).equals(fs.readFileSync(file));
}
// Gaps: { file (src-relative requirer), specifier, target (project-relative), toolkitFile (skill-relative) }.
function vendorGaps(projectDir, { toolkitRoot = TOOLKIT_ROOT } = {}) {
  const src = path.join(path.resolve(projectDir), 'src'), gaps = [], seen = new Set();
  const queue = codeFiles(src).filter(file => !vendoredCopy(src, file, toolkitRoot));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const owned = !vendoredCopy(src, file, toolkitRoot);
    for (const { specifier, topLevel } of references(fs.readFileSync(file, 'utf8'))) {
      if (!owned && !topLevel) continue;
      const target = path.resolve(path.dirname(file), specifier);
      if (!target.startsWith(src + path.sep)) continue;
      const present = resolved(target);
      if (present) { if (CODE.test(present)) queue.push(present); continue; }
      const source = counterpart(src, target, toolkitRoot);
      if (!source) continue;
      const toolkitFile = slash(path.relative(toolkitRoot, source));
      gaps.push({ file: slash(path.relative(src, file)), specifier, target: `src/${toolkitFile}`, toolkitFile });
    }
  }
  return gaps.sort((a, b) => (a.target + a.file).localeCompare(b.target + b.file));
}
// Copies every gap's toolkit file byte-identical to its mirrored src/ path, then rescans the copies,
// until no gap is left. Never overwrites an existing file.
function vendorClosure(projectDir, { toolkitRoot = TOOLKIT_ROOT } = {}) {
  const src = path.join(path.resolve(projectDir), 'src'), copied = [];
  for (let round = 0; round < 1000; round++) {
    const gaps = vendorGaps(projectDir, { toolkitRoot });
    const pending = [...new Set(gaps.map(gap => gap.toolkitFile))];
    const todo = pending.filter(relative => !fs.existsSync(path.join(src, relative)));
    if (!todo.length) return { copied, gaps };
    for (const relative of todo) {
      const destination = path.join(src, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(toolkitRoot, relative), destination);
      copied.push(relative);
    }
  }
  throw new Error('vendor closure did not converge');
}
module.exports = { vendorGaps, vendorClosure, references, TOOLKIT_ROOT };
