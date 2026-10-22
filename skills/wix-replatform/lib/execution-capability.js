'use strict';

// Authority is object identity, never serialized fields or request metadata.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const registry = new WeakMap();
const clients = new WeakMap();
const projects = new Map();
const finishedRuns = new WeakMap();
let processMark;
const adapters = Object.freeze({
  'quick-woocommerce': '../resources/rp-quick-woocommerce/quick-mode.json',
  'quick-shopify': '../resources/rp-quick-shopify/quick-mode.json',
});
function fail(code) { throw Object.assign(new Error(code), { code }); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function read(projectDir, name) { return JSON.parse(fs.readFileSync(path.join(projectDir, name), 'utf8')); }
function readIfPresent(projectDir, name) { try { return read(projectDir, name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function enter(mark) {
  if (processMark && processMark !== mark) fail('CAPABILITY_MARK_CONFLICT');
  processMark = mark;
}
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
function issue(kind, context, extra = {}) {
  const capability = Object.freeze({ kind, siteId: context.siteId, runId: context.runId,
    projectDir: context.projectDir, dryRun: context.dryRun, ...extra });
  registry.set(capability, deepFreeze({ ...context, ...extra, kind }));
  if (context.projectDir) projects.set(path.resolve(context.projectDir), capability);
  return capability;
}
function context(input) {
  if (!input || typeof input.siteId !== 'string' || !input.siteId.trim()) fail('CAPABILITY_SITE_REQUIRED');
  if (!input.projectDir) fail('CAPABILITY_PROJECT_REQUIRED');
  return { projectDir: path.resolve(input.projectDir), siteId: input.siteId,
    runId: input.runId || crypto.randomUUID(), dryRun: input.dryRun === true };
}
function inspect(capability) { return registry.get(capability) || null; }
function requireKind(capability, kind) {
  const value = inspect(capability);
  if (!value || value.kind !== kind) fail('EXECUTION_CAPABILITY_REQUIRED');
  return value;
}
function startSetupRun(input) {
  const ctx = context(input);
  const bytes = fs.readFileSync(path.join(ctx.projectDir, 'setup/setup-plan.json'));
  const plan = JSON.parse(bytes);
  if (!require('./setup-verification').validatePlanShape(plan).ok) fail('SETUP_PLAN_INVALID');
  const importRefs = new Set((readIfPresent(ctx.projectDir, 'execution/execution-manifest.json')?.tasks || []).filter(task => task.kind === 'import').flatMap(task => task.entityRefs || []));
  const forbidden = new Set(['ecom/order', 'stores/product', 'crm/contact', 'stores/coupon', 'gift-cards/gift-card', 'gift-cards/gift-card-product']);
  for (const step of plan.steps) if ((step.entityRefs || []).some(ref => forbidden.has(ref) || importRefs.has(ref))) fail('SETUP_IMPORT_ENTITY_REFUSED');
  enter('setup');
  return issue('setup-run', { ...ctx, plan, planDigest: digest(bytes) });
}
function bindSetupStep(run, stepId) {
  const ctx = requireKind(run, 'setup-run');
  if (digest(fs.readFileSync(path.join(ctx.projectDir, 'setup/setup-plan.json'))) !== ctx.planDigest) fail('SETUP_PLAN_CHANGED');
  const step = ctx.plan.steps.find(item => item.id === stepId);
  if (!step) fail('SETUP_STEP_UNKNOWN');
  return issue('setup-step', ctx, { stepId, step });
}
function validateQuickContract(contract) {
  const ids = new Set((contract.entities || []).map(entity => entity.id));
  if (ids.size !== contract.entities?.length) fail('quick_contract_invalid');
  for (const entity of contract.entities) {
    if ((entity.dependsOn || []).some(id => !ids.has(id))) fail(`quick_contract_dependency_external:${entity.id}`);
    if (entity.auxiliaryTargets && (contract.id !== 'quick-shopify' || entity.id !== 'product' ||
      JSON.stringify(entity.auxiliaryTargets) !== JSON.stringify(['stores/product-tag', 'stores/inventory-item']))) fail('quick_contract_auxiliary_invalid');
  }
  return contract;
}
function startQuickRun(input) {
  if (!input || input.contract || !Object.hasOwn(adapters, input.adapterId)) fail('QUICK_ADAPTER_UNREGISTERED');
  const ctx = context(input);
  const contract = validateQuickContract(JSON.parse(fs.readFileSync(path.resolve(__dirname, adapters[input.adapterId]), 'utf8')));
  enter('quick');
  const run = issue('quick-run', { ...ctx, adapterId: input.adapterId, contract });
  finishedRuns.set(run, new Set()); return run;
}
function bindQuickEntity(run, entityId) {
  const ctx = requireKind(run, 'quick-run');
  const entity = ctx.contract.entities.find(row => row.id === entityId);
  if (!entity) fail('CAPABILITY_ENTITY_MISMATCH');
  if (entity.dependsOn.some(id => !finishedRuns.get(run).has(id))) fail('QUICK_DEPENDENCY_NOT_FINISHED');
  return issue('quick-entity', ctx, { entityId, target: entity.target, auxiliaryTargets: entity.auxiliaryTargets || [] });
}
function finishQuickEntity(run, entityId) {
  const ctx = requireKind(run, 'quick-run');
  if (!ctx.contract.entities.some(row => row.id === entityId)) fail('CAPABILITY_ENTITY_MISMATCH');
  finishedRuns.get(run).add(entityId);
}
function bindQuickSetup(run, operation) {
  const ctx = requireKind(run, 'quick-run');
  if (!(ctx.contract.setupOperations || []).includes(operation)) fail('CAPABILITY_ENTITY_MISMATCH');
  return issue('quick-setup', ctx, { operation });
}
function startDevProbe({ siteId, confirmation, dryRun = false } = {}) {
  if (confirmation !== 'i-own-this-site') fail('DEV_PROBE_CONFIRMATION_REQUIRED');
  if (typeof siteId !== 'string' || !siteId.trim()) fail('CAPABILITY_SITE_REQUIRED');
  enter('probe');
  return issue('dev-probe', { siteId, runId: crypto.randomUUID(), dryRun: dryRun === true });
}
function startImportRun(input) {
  const ctx = context(input);
  const inputs = require('./dependency-readiness').validateImportInputs(ctx.projectDir);
  enter('import');
  return issue('import-run', { ...ctx, ...inputs });
}
function bindTask({ runCapability, taskId }) {
  const ctx = requireKind(runCapability, 'import-run');
  const task = ctx.manifest.tasks.find(row => row.id === taskId && row.kind === 'import');
  if (!task) fail('DEPENDENCY_TASK_MISMATCH');
  return issue('import-task', ctx, { taskId, task });
}
function registerClient(client, capability) { clients.set(client, inspect(capability)); }
function clientContext(client) { return clients.get(client) || null; }
function projectContext(projectDir) { return inspect(projects.get(path.resolve(projectDir))); }
module.exports = { startSetupRun, bindSetupStep, startQuickRun, bindQuickEntity, finishQuickEntity,
  bindQuickSetup, startDevProbe, startImportRun, bindTask, inspect, requireKind, fail, digest,
  registerClient, clientContext, projectContext, validateQuickContract };
