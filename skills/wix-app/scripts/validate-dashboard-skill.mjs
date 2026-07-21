#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, '..');
const referencesRoot = path.join(skillRoot, 'references');

const playbooks = [
  'DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md',
  'DASHBOARD_AUTO_PATTERNS_CHANGE_PLAYBOOK.md',
  'DASHBOARD_CUSTOM_TABLE_PLAYBOOK.md',
  'DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md',
  'DASHBOARD_ANALYTICS_PLAYBOOK.md',
  'DASHBOARD_MODAL_PLAYBOOK.md',
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

function lineCount(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
}

for (const playbook of playbooks) {
  const filePath = path.join(referencesRoot, playbook);
  if (!fs.existsSync(filePath)) {
    fail(`missing playbook: ${playbook}`);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (lineCount(filePath) > 140) fail(`${playbook} exceeds 140 lines`);
  if (!content.includes('## Required Documentation')) {
    fail(`${playbook} is missing Required Documentation`);
  }
  if (!content.includes('## Acceptance')) fail(`${playbook} is missing Acceptance`);
}

const skillPath = path.join(skillRoot, 'SKILL.md');
const routingPath = path.join(referencesRoot, 'DASHBOARD_ROUTING.md');
if (lineCount(skillPath) > 120) fail('SKILL.md exceeds 120 lines');
if (lineCount(routingPath) > 80) fail('DASHBOARD_ROUTING.md exceeds 80 lines');

const skillContent = fs.readFileSync(skillPath, 'utf8');
const frontmatter = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!frontmatter) {
  fail('SKILL.md is missing YAML frontmatter');
} else {
  const keys = [...frontmatter[1].matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((match) => match[1]);
  if (!keys.includes('name')) fail('SKILL.md frontmatter is missing name');
  if (!keys.includes('description')) fail('SKILL.md frontmatter is missing description');
  const unsupported = keys.filter((key) => !['name', 'description', 'compatibility'].includes(key));
  if (unsupported.length) fail(`SKILL.md has unsupported frontmatter keys: ${unsupported.join(', ')}`);
}

const routing = fs.readFileSync(routingPath, 'utf8');
if (/read\s+(?:all|every)\s+matching/i.test(routing)) {
  fail('dashboard routing still instructs the agent to read every matching reference');
}

const ruleOwners = new Map();
for (const playbook of playbooks) {
  const filePath = path.join(referencesRoot, playbook);
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const match of content.matchAll(/\*\*([A-Z]+-\d+):\*\*/g)) {
    const existing = ruleOwners.get(match[1]);
    if (existing) fail(`duplicate rule ${match[1]} in ${existing} and ${playbook}`);
    ruleOwners.set(match[1], playbook);
  }
}

for (const filePath of [skillPath, ...markdownFiles(referencesRoot)]) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(filePath), target);
    if (!fs.existsSync(resolved)) {
      fail(`broken link in ${path.relative(skillRoot, filePath)}: ${match[1]}`);
    }
  }
}

if (failures.length) {
  console.error('Dashboard skill validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Dashboard skill validation passed: ${playbooks.length} playbooks, ${ruleOwners.size} owned rules, links resolved.`,
);
