'use strict';
const fs = require('node:fs');
const path = require('node:path');
function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(root, entry.name)) : /\.[cm]?js$/.test(entry.name) ? [path.join(root, entry.name)] : []);
}
// Blank only the file's header: whitespace, comments, a shebang and a 'use strict' directive
// (line comments end at any JS line terminator: LF, CR, U+2028, U+2029)
// before the first code token. Nothing can be open there, so this needs no guess about strings,
// templates or regex; comments after code are scanned as text like the code around them.
const LINE_END = /[\n\r\u2028\u2029]/g;
function lineEnd(text, from) { LINE_END.lastIndex = from; return LINE_END.exec(text)?.index ?? text.length; }
function blankHeaderComments(text) {
  let i = text.startsWith('#!') ? lineEnd(text, 0) : 0;
  for (;;) {
    const rest = text.slice(i), space = rest.match(/^\s+/), directive = rest.match(/^(['"])use strict\1;?/);
    if (space || directive) i += (space || directive)[0].length;
    else if (rest.startsWith('//')) i = lineEnd(text, i);
    else if (rest.startsWith('/*') && text.indexOf('*/', i + 2) >= 0) i = text.indexOf('*/', i + 2) + 2;
    else break;
  }
  return text.slice(0, i).replace(/[^\n\r\u2028\u2029]/g, ' ') + text.slice(i);
}

// Vendored shared code lives in two trees: src/lib (project-owned runtime files and flat toolkit
// copies) and src/resources, which mirrors the toolkit's resources/ so cross-resource relative
// requires (resources -> ../../../lib) resolve to the one src/lib copy (rp-import-codegen layout).
// From the toolkit, a src/resources file is trusted only while byte-identical to the toolkit
// file at the same path; a vendored copy of this module cannot see the toolkit and trusts the
// path, as it trusts src/lib. import-contract-verify always runs from the toolkit before writes.
const TOOLKIT_ROOT = path.resolve(__dirname, '..');
function vendoredResource(src, file) {
  const relative = path.relative(src, file);
  if (!/^resources[/\\]/.test(relative)) return null;
  if (!fs.existsSync(path.join(TOOLKIT_ROOT, 'SKILL.md'))) return 'unmodified';
  const toolkitFile = path.join(TOOLKIT_ROOT, relative);
  return fs.existsSync(toolkitFile) && fs.readFileSync(toolkitFile).equals(fs.readFileSync(file)) ? 'unmodified' : 'modified';
}
function verifyReadinessContract(projectDir, descriptor) {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8'));
  const expected = manifest.tasks.filter(task => task.kind === 'import').map(task => ({ taskId: task.id, edges: task.dependencyEdges.map(({ ref, mode }) => ({ ref, mode })).sort((a, b) => a.ref.localeCompare(b.ref)) })).sort((a, b) => a.taskId.localeCompare(b.taskId));
  const reported = descriptor.dependencyReadiness?.tasks?.map(task => ({ taskId: task.taskId, edges: task.edges.map(({ ref, mode }) => ({ ref, mode })).sort((a, b) => a.ref.localeCompare(b.ref)) })).sort((a, b) => a.taskId.localeCompare(b.taskId));
  const errors = [];
  if (JSON.stringify(expected) !== JSON.stringify(reported)) errors.push('dependency_readiness_descriptor_mismatch');
  const src = path.join(projectDir, 'src');
  for (const file of files(src).filter(file => !/^(?:lib|extract)[/\\]/.test(path.relative(src, file)))) {
    const relative = path.relative(projectDir, file), vendored = vendoredResource(src, file);
    if (vendored === 'unmodified') continue;
    const text = blankHeaderComments(fs.readFileSync(file, 'utf8')), hits = [];
    if (/\b(?:startSetupRun|bindSetupStep|startQuickRun|startDevProbe|createWixSetupExecutor)\b|execution-capability(?:\.js)?/.test(text)) hits.push('execution_capability_bypass');
    // Generated transforms must obtain references through gate-owned resolvers, not read local evidence.
    if (/crosswalk|loadCrosswalk|readEntityCrosswalk|local-state|data[\\/]source-extract/.test(text) && !/(?:^|\/)run-import\.[cm]?js$/.test(relative)) hits.push('dependency_reference_bypass');
    if (hits.length && vendored === 'modified') errors.push(`vendored_resource_modified:${relative}`);
    else for (const hit of hits) errors.push(`${hit}:${relative}`);
  }
  return { ok: errors.length === 0, errors };
}
module.exports = { verifyReadinessContract, files, blankHeaderComments };
