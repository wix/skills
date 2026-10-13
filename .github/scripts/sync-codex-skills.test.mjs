// Run with node --test .github/scripts/sync-codex-skills.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

const scriptSource = path.join(import.meta.dirname, 'sync-codex-skills.sh');
const syncedSkills = [
  'wix-app',
  'wix-manage',
  'wix-design-system',
  'wix-docs',
  'wix-headless-kit',
  'wix-headless-templates',
];
const startHereBlock = [
  '## Start Here — Wix MCP',
  '',
  '### Call the `WixREADME` tool',
  'Must be read at the start of any flow. How to work with the Wix MCP: source-of-truth rules, the discovery-and-call flow, batching calls into one invocation, and loading site context.',
  '',
  '---',
].join('\n');
const wixManageSkill = [
  '---',
  'name: wix-manage',
  '---',
  '',
  '# Management Recipes Index',
  '',
  'Intro.',
  '',
  '```bash',
  '# not a heading',
  '```',
  '',
  '# Second Heading',
  '',
].join('\n');

let repoRoot;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-codex-skills-'));
  const scriptTarget = path.join(repoRoot, '.github/scripts/sync-codex-skills.sh');
  fs.mkdirSync(path.dirname(scriptTarget), { recursive: true });
  fs.copyFileSync(scriptSource, scriptTarget);
  for (const skill of syncedSkills) {
    writeFile(`skills/${skill}/SKILL.md`, `# ${skill}\n`);
    writeFile(`skills/${skill}/references/nested/ref.md`, `${skill} reference\n`);
  }
  writeFile('skills/wix-manage/SKILL.md', wixManageSkill);
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function writeFile(relativePath, content) {
  const target = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function runSync() {
  return spawnSync('bash', [path.join(repoRoot, '.github/scripts/sync-codex-skills.sh')], {
    encoding: 'utf8',
  });
}

function runSyncOrThrow() {
  const result = runSync();
  assert.equal(result.status, 0, result.stderr);
}

test('inserts the start-here block after the first # heading only', () => {
  runSyncOrThrow();

  const expected = wixManageSkill.replace(
    '# Management Recipes Index\n',
    `# Management Recipes Index\n\n${startHereBlock}\n`,
  );
  assert.equal(readFile('codex-skills/wix-manage/SKILL.md'), expected);
});

test('leaves the source wix-manage SKILL.md untouched', () => {
  runSyncOrThrow();

  assert.equal(readFile('skills/wix-manage/SKILL.md'), wixManageSkill);
});

test('copies every other synced skill byte for byte', () => {
  runSyncOrThrow();

  for (const skill of syncedSkills) {
    assert.equal(
      readFile(`codex-skills/${skill}/references/nested/ref.md`),
      `${skill} reference\n`,
    );
    if (skill !== 'wix-manage') {
      assert.equal(readFile(`codex-skills/${skill}/SKILL.md`), `# ${skill}\n`);
    }
  }
});

test('does not copy skills outside the list', () => {
  writeFile('skills/wix-vibe-headless/SKILL.md', '# wix-vibe-headless\n');

  runSyncOrThrow();

  assert.equal(exists('codex-skills/wix-vibe-headless'), false);
});

test('removes files that were deleted from the source', () => {
  runSyncOrThrow();
  fs.rmSync(path.join(repoRoot, 'skills/wix-docs/references/nested/ref.md'));

  runSyncOrThrow();

  assert.equal(exists('codex-skills/wix-docs/references/nested/ref.md'), false);
});

test('is idempotent', () => {
  runSyncOrThrow();
  const firstRun = readFile('codex-skills/wix-manage/SKILL.md');

  runSyncOrThrow();

  assert.equal(readFile('codex-skills/wix-manage/SKILL.md'), firstRun);
  assert.equal(readFile('codex-skills/wix-manage/SKILL.md').split('## Start Here').length, 2);
});

test('fails when wix-manage SKILL.md has no # heading', () => {
  writeFile('skills/wix-manage/SKILL.md', '## Only a subheading\n');

  const result = runSync();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no # heading found/);
  assert.equal(exists('codex-skills/wix-manage/SKILL.md.tmp'), false);
});
