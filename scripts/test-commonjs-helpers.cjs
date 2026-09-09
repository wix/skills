// Run with node scripts/test-commonjs-helpers.cjs. No Wix API calls are made.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wix-commonjs-'));
const helpers = [
  ...['storefront/seed-store', 'bookings/seed-bookings', 'bookings/seed-rentals',
    'blog/seed-blog', 'events/seed-events', 'portfolio/seed-portfolio',
    'pricing-plans/seed-pricing-plans', 'restaurants/seed-restaurants'].map(entry => {
    const [vertical, name] = entry.split('/');
    return `wix-vibe-headless/references/${vertical}/seed/${name}.cjs`;
  }),
  'wix-base44-connector/scripts/utils.cjs',
];

try {
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  for (const relative of helpers) {
    const source = path.join(root, 'skills', relative);
    const target = path.join(temp, '.agents/skills', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    // Match exec_tool's fresh node -e process inside an ESM application.
    const output = execFileSync(process.execPath, ['-e', `
      const helper = require(${JSON.stringify(target)});
      const entries = Object.entries(helper).map(([key, value]) => [key, typeof value]);
      process.stdout.write(JSON.stringify(entries));
    `], { cwd: temp, encoding: 'utf8' });
    const entries = JSON.parse(output);
    assert.ok(entries.length > 0, `${relative}: empty exports`);
    const expected = Object.entries(require(source)).map(([key, value]) => [key, typeof value]);
    assert.deepEqual(entries, expected, `${relative}: exports changed in ESM app`);
    assert.ok(entries.some(([, type]) => type === 'function'), `${relative}: no functions`);
    if (relative.endsWith('seed-store.cjs')) {
      assert.ok(entries.some(([name]) => name === 'setupStore'));
    }
    console.log(`${relative}: ${entries.length} exports`);
  }

  // Execute the actual connector loading example, including its first-touch path.
  const guide = fs.readFileSync(path.join(root, 'skills/wix-base44-connector/SKILL.md'), 'utf8');
  const section = guide.slice(guide.indexOf('## The helpers'));
  const snippet = section.match(/```js\n([\s\S]*?)```/)[1];
  for (const cached of [false, true]) {
    const output = execFileSync(process.execPath, ['-e', `
      (async () => {
        global.fetch = async url => {
          if (${cached}) throw new Error('Cached loader unexpectedly fetched');
          if (!url.endsWith('/scripts/utils.cjs')) throw new Error('Wrong download path');
          return { text: async () => require('node:fs').readFileSync(
            ${JSON.stringify(path.join(root, 'skills/wix-base44-connector/scripts/utils.cjs'))}, 'utf8') };
        };
        ${snippet}
        process.stdout.write(JSON.stringify(Object.keys(wx)));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd: temp, encoding: 'utf8' });
    assert.ok(JSON.parse(output).includes('search'));
  }
  console.log('Connector guide: first-touch download and cached require both passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
