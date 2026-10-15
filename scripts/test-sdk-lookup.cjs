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

test('a builder that also takes a query object prints that form, with its own paging key', () => {
  const [r] = json('services', '--intent', 'read');
  const q = method(r.candidates[0], 'queryServices').queryForm;
  assert.deepEqual(q.params, ['query: ServiceQuery', 'options?: QueryServicesOptions']);
  assert.deepEqual(q.keys, ['paging', 'filter', 'sort']);
  const { out } = run('services', '--intent', 'read');
  assert.match(out, /or {6}services\.queryServices\(query: ServiceQuery, options\?: QueryServicesOptions\) → Promise<QueryServicesResponse>/);
  assert.match(out, /or one query object, services\.queryServices\(\{ paging, filter, sort \}\), whose filter also takes \$or/);
});

test('a query of another type in the namespace does not get the entity filter list', () => {
  const [r] = json('services', '--intent', 'read');
  assert.ok(method(r.candidates[0], 'queryServices').filterable, 'the builder keeps it');
  assert.equal(method(r.candidates[0], 'queryPolicies').filterable, undefined);
});

test('a builder with no filter sends the call to the query object, and an empty spec points to the docs', () => {
  const read = run('extendedBookings', '--intent', 'read').out;
  assert.match(read, /^shape extendedBookings\.queryExtendedBookings\(\{ cursorPaging, filter, sort \}\): the builder has no filter or sort, so pass one query object$/m);
  assert.match(read, /filter fields: not in the package \(the method docs page lists them\)/);
  assert.doesNotMatch(read, /closed list/);
  const search = run('extendedBookings', '--intent', 'search').out;
  assert.match(search, /^shape extendedBookings\.queryExtendedBookings\(\{ cursorPaging, filter, sort \}\): no search method, and the builder has no or\(\): pass one query object instead$/m);
  assert.doesNotMatch(search, /startsWith on ONE field/);
});

test('without free text, a search term goes in $startsWith on the string fields of the filter list, ids left out', () => {
  const [r] = json('members', '--intent', 'search');
  assert.deepEqual(method(r.candidates[0], 'queryMembers').textFields, ['loginEmail', 'contact.firstName'], 'a nested string field is followed; _id is left out');
});

test('a string field under operators * is a text field: it takes every operator, $startsWith too', () => {
  const [r] = json('services', '--intent', 'search');
  const m = method(r.candidates[0], 'queryServices');
  assert.deepEqual(m.textFields, []);
  assert.deepEqual(m.textFieldsAny, ['name']);
  const { out } = run('services', '--intent', 'search');
  assert.match(out, /^shape services\.queryServices\(\{ paging, filter, sort \}\): no search method, and the builder has no or\(\): pass one query object instead$/m);
  assert.match(out, /the term: filter: \{ \$or: \[\{ 'name': \{ \$startsWith: term \} \}\] \}$/m);
  assert.match(out, /text fields with operators '\*' \(every operator, \$startsWith too\): name$/m);
  assert.doesNotMatch(out, /exact \$eq/);
  assert.doesNotMatch(out, /no text match/);
});

test('free text in a query method\'s options is the search, with its field default named', () => {
  const [r] = json('members', '--intent', 'search');
  const q = method(r.candidates[0], 'queryMembers');
  assert.deepEqual(q.optionsSearch, {
    param: 'options',
    fields: ['loginEmail', 'contact.firstName', 'contact.lastName', 'profile.title', 'profile.nickname', 'profile.slug'],
    default: 'profile.nickname',
    max: 4,
  });
  const { out } = run('members', '--intent', 'search');
  assert.match(out, /^shape members\.queryMembers\(\{ search: \{ expression: term, fields \} \}\)\.find\(\): no search method; free text in its options\.search$/m);
  assert.match(out, /search\.fields defaults to profile\.nickname alone: name every field the term must match \(at most 4\)/);
  assert.doesNotMatch(out, /startsWith on ONE field/);
});

test('a filter list with no text field says the API cannot match a term, not to filter in the client', () => {
  const [r] = json('contacts', '--intent', 'search');
  const v4 = r.candidates.find((c) => c.namespace === 'contacts');
  assert.deepEqual(method(v4, 'queryContacts').textFields, []);
  assert.match(v4.shape[0], /^contacts\.queryContacts\(\): no text match in the package/);
  assert.ok(v4.shape.some((l) => /never match only the loaded page, or a capped or cached set/.test(l)));
  assert.ok(v4.shape.some((l) => /next: its docs page \(SearchWixSDKDocumentation "queryContacts"\), not the typings/.test(l)));
  assert.ok(!v4.shape.some((l) => /types search\.expression/.test(l)), 'a builder has no search argument');
});

test('when the package does not list the filter fields, the term line points to the docs page', () => {
  const [r] = json('extendedBookings', '--intent', 'search');
  assert.equal(method(r.candidates[0], 'queryExtendedBookings').textFields, undefined);
  const { out } = run('extendedBookings', '--intent', 'search');
  assert.match(out, /the term: filter \$or, one clause per text field — the package has no filter list for this method$/m);
  assert.match(out, /next: its docs page \(SearchWixSDKDocumentation "queryExtendedBookings filter"\), not the typings or the compiled JS/);
  assert.match(out, /\$contains where a field takes it/);
});

test('a write method needs the revision', () => {
  const [r] = json('contacts', '--intent', 'write');
  assert.deepEqual(method(r.candidates[0], 'updateContact').required, ['revision']);
  assert.match(run('contacts', '--intent', 'write').out, /read the entity first/i);
});

test('a method prints its JSDoc notes, which say who may call it where the identity tag does not', () => {
  const [r] = json('members', '--intent', 'all');
  const m = method(r.candidates[0], 'getCurrentMember');
  assert.deepEqual(m.identities, ['APP']);
  assert.deepEqual(m.notes, ['This method requires visitor or member authentication.']);
  assert.match(run('members', '--intent', 'all').out, /^ {16}note {4}This method requires visitor or member authentication\.$/m);
});

// A project of its own, for package layouts the shared fixtures must not carry.
const scratchProject = (prefix, wrappers, body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const pkg = (name, files, pj = {}) => {
    const to = path.join(dir, 'node_modules', '@wix', name);
    fs.mkdirSync(path.join(to, 'build', 'cjs'), { recursive: true });
    fs.writeFileSync(path.join(to, 'package.json'), JSON.stringify({ name: `@wix/${name}`, ...pj }));
    for (const [f, src] of Object.entries(files)) fs.writeFileSync(path.join(to, 'build', 'cjs', f), src);
  };
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(wrappers.map((w) => [`@wix/${w}`, '1.0.0'])) }));
    return body(pkg, (...args) => spawnSync(process.execPath, [LOOKUP, ...args], { cwd: dir, encoding: 'utf8' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('an export form the lookup does not read exits 4 instead of labeling the package not exported', () => {
  scratchProject('sdk-lookup-odd-', ['odd'], (pkg, lookup) => {
    pkg('auto_sdk_odd_things', { 'index.typings.d.ts': '' });
    pkg('odd', { 'index.d.ts': "export * as things from '@wix/auto_sdk_odd_things';\n" }, { dependencies: { '@wix/auto_sdk_odd_things': '1.0.0' } });
    const r = lookup('things');
    assert.equal(r.status, 4);
    assert.match(r.stderr, /@wix\/odd exports @wix\/auto_sdk_odd_things in a form sdk-lookup does not read/);
  });
});

test('across packages that export one namespace, the module map package wins over a higher API version', () => {
  scratchProject('sdk-lookup-shared-', ['ecom', 'pricing-plans'], (pkg, lookup) => {
    const orders = (vertical, fqdn, doc) => {
      const auto = `auto_sdk_${vertical}_orders`;
      pkg(auto, { 'index.typings.d.ts': `${doc ? `/**\n * ${doc}\n *\n * More text.\n */\n` : ''}interface Order {\n    _id?: string | null;\n}\n` }, { wix: { sdkDependency: { fqdn } } });
      pkg(vertical, { 'index.d.ts': `import * as ${auto.replace(/-/g, '_')} from '@wix/${auto}';\nexport { ${auto.replace(/-/g, '_')} as orders };\n` }, { dependencies: { [`@wix/${auto}`]: '1.0.0' } });
    };
    orders('ecom', 'wix.ecom.v1.order', 'An order represents a completed purchase from a buyer. Orders are created through checkout.');
    orders('pricing-plans', 'wix.pricing_plans.v2.order', 'An order object includes all of the details related to the purchase of a Pricing Plan.');
    const r = lookup('orders');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^use {3}orders \(@wix\/ecom\) — fqdn v1 \(wix\.ecom\.v1\.order\); the module map package — "An order represents a completed purchase from a buyer\."$/m);
    assert.match(r.stdout, /^also {2}orders \(@wix\/pricing-plans\) — fqdn v2 [^\n]* — "An order object includes all of the details related to the purchase of a Pricing Plan\."$/m);
    assert.match(r.stdout, /several packages export this name/);
  });
});

test('with no module map row, the package named after the namespace wins, then one with a description', () => {
  const categories = (pkg, vertical, doc) => {
    const auto = `auto_sdk_${vertical}_categories`;
    const id = auto.replace(/-/g, '_');
    pkg(auto, { 'index.typings.d.ts': `${doc ? `/** ${doc} */\n` : ''}interface Category {\n    _id?: string | null;\n}\n` }, { wix: { sdkDependency: { fqdn: `wix.${vertical}.v1.category` } } });
    pkg(vertical, { 'index.d.ts': `import * as ${id} from '@wix/${auto}';\nexport { ${id} as categories };\n` }, { dependencies: { [`@wix/${auto}`]: '1.0.0' } });
  };
  scratchProject('sdk-lookup-namesake-', ['blog', 'categories', 'events'], (pkg, lookup) => {
    categories(pkg, 'blog', null);
    categories(pkg, 'categories', 'A category for organizing items into a hierarchical structure.');
    categories(pkg, 'events', 'A Category groups related events.');
    const out = lookup('categories').stdout;
    assert.match(out, /^use {3}categories \(@wix\/categories\) — [^\n]*the package named after it/m);
    assert.ok(out.indexOf('(@wix/events)') < out.indexOf('(@wix/blog)'), 'a package with a description comes before one without');
  });
});

test('one package with two namespaces gets no description line', () => {
  assert.doesNotMatch(run('contacts', '--intent', 'search').out, /several packages export this name|no description/);
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
