'use strict';
const fs = require('node:fs');
const path = require('node:path');
function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(root, entry.name)) : /\.[cm]?js$/.test(entry.name) ? [path.join(root, entry.name)] : []);
}
function verifyReadinessContract(projectDir, descriptor) {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8'));
  const expected = manifest.tasks.filter(task => task.kind === 'import').map(task => ({ taskId: task.id, edges: task.dependencyEdges.map(({ ref, mode }) => ({ ref, mode })).sort((a, b) => a.ref.localeCompare(b.ref)) })).sort((a, b) => a.taskId.localeCompare(b.taskId));
  const reported = descriptor.dependencyReadiness?.tasks?.map(task => ({ taskId: task.taskId, edges: task.edges.map(({ ref, mode }) => ({ ref, mode })).sort((a, b) => a.ref.localeCompare(b.ref)) })).sort((a, b) => a.taskId.localeCompare(b.taskId));
  const errors = [];
  if (JSON.stringify(expected) !== JSON.stringify(reported)) errors.push('dependency_readiness_descriptor_mismatch');
  for (const file of files(path.join(projectDir, 'src')).filter(file => !/^(?:lib|extract)[/\\]/.test(path.relative(path.join(projectDir, 'src'), file)))) {
    const text = fs.readFileSync(file, 'utf8'), relative = path.relative(projectDir, file);
    if (/\b(?:startSetupRun|bindSetupStep|startQuickRun|startDevProbe|createWixSetupExecutor)\b|execution-capability(?:\.js)?/.test(text)) errors.push(`execution_capability_bypass:${relative}`);
    // Vendored shared libraries live outside the generated transform directory. Generated
    // transforms must obtain references through gate-owned resolvers, not read local evidence.
    if (/crosswalk|loadCrosswalk|readEntityCrosswalk|local-state|data[\\/]source-extract/.test(text) && !/(?:^|\/)run-import\.[cm]?js$/.test(relative)) errors.push(`dependency_reference_bypass:${relative}`);
  }
  return { ok: errors.length === 0, errors };
}
module.exports = { verifyReadinessContract, files };
