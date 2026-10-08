// Tests skills/wix-app/scripts/sdk-lookup.cjs against trimmed copies of real SDK
// packages (@wix/crm 1.0.1648 and refunds). Run: node --test scripts/test-sdk-lookup.cjs
//
// The fixtures live under scripts/fixtures/sdk-lookup/@wix/<name>/typings/*.fixture
// (the suffix keeps tools from reading them as source); each test run installs them
// into a temporary project as node_modules/@wix/<name>/build/cjs/.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOOKUP = path.join(__dirname, '..', 'skills', 'wix-app', 'scripts', 'sdk-lookup.cjs');
const FIXTURES = path.join(__dirname, 'fixtures', 'sdk-lookup', '@wix');
let project;

before(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-lookup-'));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: { '@wix/crm': '1.0.1648' } }));
  for (const name of fs.readdirSync(FIXTURES)) {
    const to = path.join(project, 'node_modules', '@wix', name);
    fs.mkdirSync(path.join(to, 'build', 'cjs'), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, name, 'package.json'), path.join(to, 'package.json'));
    const typings = path.join(FIXTURES, name, 'typings');
    for (const file of fs.readdirSync(typings)) {
      fs.copyFileSync(path.join(typings, file), path.join(to, 'build', 'cjs', file.replace(/\.fixture$/, '')));
    }
  }
});

after(() => fs.rmSync(project, { recursive: true, force: true }));

const run = (...args) => {
  const r = spawnSync(process.execPath, [LOOKUP, ...args], { cwd: project, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const json = (...args) => JSON.parse(run(...args, '--json').out);
const method = (candidate, name) => candidate.record.methods.find((m) => m.name === name);

test('a contacts search picks contactsV5, the namespace with a search method and the higher version', () => {
  const [r] = json('contacts', '--intent', 'search');
  assert.equal(r.status, 'found');
  assert.equal(r.candidates[0].namespace, 'contactsV5');
  assert.equal(r.candidates[0].from, '@wix/crm');
  assert.ok(r.candidates.some((c) => c.namespace === 'contacts'), 'V4 is listed as the other namespace');
});

test('the shape line is one search call with the term in search.expression', () => {
  const { code, out } = run('contacts', '--intent', 'search');
  assert.equal(code, 0);
  assert.match(out, /^shape contactsV5\.searchContacts\(\{ search: \{ expression: term \} \}\): one call; the term matches [^\n]*name\.full/m);
});

test('a method shows its public parameters, not the REST request type', () => {
  const [r] = json('contacts', '--intent', 'search');
  assert.deepEqual(method(r.candidates[0], 'searchContacts').params, ['search: ContactSearch', 'options?: SearchContactsOptions']);
  assert.match(run('contacts', '--intent', 'search').out, /contactsV5\.searchContacts\(search: ContactSearch, options\?: SearchContactsOptions\)/);
});

test('a search method prints the keys of its argument and response, past the empty placeholder', () => {
  const { out } = run('contacts', '--intent', 'search');
  assert.match(out, /arg {5}search: \{ cursorPaging: \{ limit, cursor \}, filter, sort: \[\{ fieldName, order \}\], search: \{ mode, expression \} \}/);
  assert.match(out, /returns \{ contacts: Contact\[\], pagingMetadata: \{ count, cursors: \{ next, prev \}, hasNext \} \}/);
});

test('the search spec gives the closed filter list, with no line for a free-text-only field', () => {
  const { out } = run('contacts', '--intent', 'search');
  assert.match(out, /free text: company\.name, email\.email, name\.full, phone\.phone/);
  assert.match(out, /filter \$eq \$exists \$in \$ne \$nin \$startsWith: company\.name, email\.email, phone\.phone, name\.first/);
  assert.doesNotMatch(out, /filter :/);
  assert.match(out, /closed list/);
});

test('a query builder lists the fields per operator', () => {
  const [r] = json('contacts', '--intent', 'read');
  assert.deepEqual(method(r.candidates[0], 'queryContacts').builder.gt, ['_createdDate', '_updatedDate']);
});

test('a write method needs the revision', () => {
  const [r] = json('contacts', '--intent', 'write');
  assert.deepEqual(method(r.candidates[0], 'updateContact').required, ['revision']);
  assert.match(run('contacts', '--intent', 'write').out, /read the entity first/i);
});

test('the scope says where to find it, the other methods say how to see them, the package is named', () => {
  const { out } = run('contacts', '--intent', 'search');
  assert.match(out, /scope: not in the package \(the method docs page lists it\)/);
  assert.match(out, /other methods \(params, permission, scope: run again with --intent write \(or all\)\): [^\n]*updateContact/);
  assert.match(out, /^ {2}package @wix\/auto_sdk_crm_contacts-v-5@1\.0\.22$/m);
  assert.doesNotMatch(out, /sdk-index/);
});

test('an event shows its scope IDs, and a package whose wrapper is not installed gets the install command', () => {
  const { code, out } = run('refunds', '--intent', 'event');
  assert.equal(code, 0);
  assert.match(out, /refunds\.onRefundCreated\(handler\) · scope SCOPE\.DC-PAYMENTS\.MANAGE-REFUNDS \| SCOPE\.DC-PAYMENTS\.READ-REFUNDS/);
  assert.match(out, /npm i @wix\/payments/);
});

test('one call answers several entities', () => {
  const results = json('contacts', 'refunds', '--intent', 'all');
  assert.deepEqual(results.map((r) => r.status), ['found', 'found']);
});

test('an unknown name exits 1 with near matches', () => {
  const { code, out } = run('contcts');
  assert.equal(code, 1);
  assert.match(out, /near: [^\n]*contacts/);
});

test('an entity whose package is not installed exits 3 with the install command', () => {
  const { code, out } = run('bookings');
  assert.equal(code, 3);
  assert.match(out, /npm i @wix\/bookings/);
});
