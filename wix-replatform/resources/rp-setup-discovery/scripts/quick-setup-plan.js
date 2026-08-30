#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function envValue(text, key) { const match = text.match(new RegExp(`^${key}=(.*)$`, 'm')); return match ? match[1].trim() : null; }
async function siteStrategy(projectDir) { try { return envValue(await fs.readFile(path.join(projectDir, 'config', 'wix.env'), 'utf8'), 'WIX_SITE_STRATEGY'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function requirementsFor(plan, strategy) {
  const capabilities = new Set(plan.requiredWixCapabilities || []);
  const hasPosts = (plan.entities || []).some((entity) => entity.id === 'post');
  const result = [];
  if (strategy === 'new') result.push({ id: 'mute-site-notifications', order: 10, severity: 'blocker', automation: 'automatable', expected: 'site notifications are muted', verification: 'getSiteMuteState returns muted=true' });
  if (capabilities.has('stores')) result.push({ id: 'wix-stores', order: 20, severity: 'blocker', automation: 'automatable', expected: 'Wix Stores is installed', verification: 'app installation state is enabled' });
  if (capabilities.has('stores') && strategy === 'existing') result.push({ id: 'stores-catalog-v3', order: 30, severity: 'blocker', automation: 'automatable', expected: 'catalogVersion is V3_CATALOG', verification: 'GET /stores/v3/provision/version' });
  if (capabilities.has('blog')) result.push({ id: 'wix-blog', order: 40, severity: 'blocker', automation: 'automatable', expected: 'Wix Blog is installed', verification: 'app installation state is enabled' });
  if (hasPosts) result.push({ id: 'blog-fallback-author', order: 50, severity: 'blocker', automation: 'automatable', expected: 'dedicated fallback Blog member exists and WIX_BLOG_FALLBACK_MEMBER_ID is persisted', verification: 'member lookup and config key status' });
  return result;
}
async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  if (!projectDir) throw new Error('Usage: quick-setup-plan.js <projectDir>');
  const plan = await readJson(path.join(projectDir, 'quick-mode', 'plan.json'));
  if (plan.managementImportMode !== 'quick' || !plan.adapter || !Array.isArray(plan.entities)) throw new Error('quick-mode/plan.json is not a valid quick plan');
  const strategy = await siteStrategy(projectDir);
  if (!strategy) throw new Error('WIX_SITE_STRATEGY is required before quick setup discovery');
  const requirements = requirementsFor(plan, strategy);
  const generatedAt = new Date().toISOString();
  const common = { schemaVersion: 1, generatedAt, managementImportMode: 'quick', adapter: plan.adapter, sourcePlan: 'quick-mode/plan.json', siteStrategy: strategy, requirements };
  await writeJson(path.join(projectDir, 'setup', 'setup-plan.json'), { ...common, steps: requirements.map((requirement) => ({ ...requirement, action: requirement.id })) });
  await writeJson(path.join(projectDir, 'setup', 'setup-requirements.json'), common);
  // setup-blockers.json is no longer seeded here: execute-setup.js is the sole writer of
  // real blocker content (empty on full success, populated on a genuine failure), so a
  // permanent blockers:[] stub written before setup ever runs would otherwise let a stale
  // "no blockers" file survive a later failure. Its absence before setup runs is itself the
  // correct "setup hasn't run yet" signal.
  await writeJson(path.join(projectDir, 'setup', 'llm-handoff.json'), { schemaVersion: 1, generatedAt, needsLlm: false, reason: 'Quick setup requirements are derived from the adapter contract.' });
  await fs.mkdir(path.join(projectDir, 'setup', 'review'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'setup', 'review', 'setup-summary.md'), `# Quick setup summary\n\n${requirements.map((item) => `- ${item.id}: ${item.expected}`).join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, requirements: requirements.map((item) => item.id) }));
}
main().catch((error) => { console.error(error.message); process.exit(1); });
