// Compose the same shared + vertical files that deploy.cjs copies. Network is always mocked.
// node --test skills/wix-vibe-headless/references/donations/tests/donations.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';

const transportSource = await readFile(new URL('../../shared/app/rest/wix-client.js', import.meta.url), 'utf8');
const donationSource = await readFile(new URL('../app/rest/wix-donations.js', import.meta.url), 'utf8');
const legacyTransportSource = transportSource
  .replace('export const WIX_API_SUPPORTS_STRICT_PAYMENT_ERRORS = true;\n', '')
  .replace(', throwOnPaymentRequired?: boolean', '')
  .replace(', throwOnPaymentRequired = false', '')
  .replace('res.status === 402 && !throwOnPaymentRequired', 'res.status === 402');

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
function helperWithTransport(source) {
  const standalone = source
    .replace('export { WIX_CLIENT_ID } from "./wix-config.js";', '')
    .replace('import { WIX_CLIENT_ID } from "./wix-config.js";', 'const WIX_CLIENT_ID = "public-test-client";');
  return import(moduleUrl(donationSource.replace("'./wix-client.js'", JSON.stringify(moduleUrl(standalone)))));
}

async function deployFixture(existingTransport, verticals = ['donations']) {
  const script = await readFile(new URL('../../../install/deploy.cjs', import.meta.url), 'utf8');
  const ref = '/app/.agents/skills/wix-vibe-headless/references';
  const files = new Map([
    [`${ref}/shared/app/rest/wix-client.js`, transportSource],
    [`${ref}/shared/app/rest/wix-config.js`, 'export const WIX_CLIENT_ID = "<YOUR-CLIENT-ID>";\nexport const WIX_METASITE_ID = "<YOUR-SITE-ID>";'],
    [`${ref}/donations/app/rest/wix-donations.js`, donationSource],
    [`${ref}/cms/app/rest/wix-cms.js`, 'export const fixture = true;'],
  ]);
  if (existingTransport !== undefined) files.set('/app/src/rest/wix-client.js', existingTransport);
  const copies = [];
  const writes = [];
  let result;
  const fs = {
    existsSync: path => files.has(path) || [...files.keys()].some(file => file.startsWith(`${path}/`)),
    cpSync: (from, to, options = {}) => {
      copies.push({ from, to, options });
      const entries = [...files].filter(([path]) => path === from || path.startsWith(`${from}/`));
      assert.ok(entries.length, `Missing copy source: ${from}`);
      for (const [path, source] of entries) {
        const destination = `${to}${path.slice(from.length)}`;
        if (!files.has(destination) || options.force !== false) files.set(destination, source);
      }
    },
    mkdirSync: () => {},
    writeFileSync: (path, source) => { writes.push(path); files.set(path, source); },
    readFileSync: path => { assert.ok(files.has(path), `Missing fixture file: ${path}`); return files.get(path); },
  };
  const process = { argv: ['node', 'deploy.cjs', ...verticals, '--client-id', 'test-client', '--metasite-id', 'test-site'], exitCode: 0 };
  runInNewContext(script, {
    require: name => {
      if (name === 'fs') return fs;
      assert.equal(name, 'crypto');
      return { createHash };
    },
    process,
    console: { log: value => { result = JSON.parse(value); } },
  });
  return { result, files, copies, writes, exitCode: process.exitCode };
}

const fixture = await mkdtemp(join(tmpdir(), 'wix-donation-contract-'));
await cp(new URL('../../shared/app/', import.meta.url), fixture, { recursive: true });
await cp(new URL('../app/', import.meta.url), fixture, { recursive: true });
await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
await writeFile(join(fixture, 'rest/wix-config.js'), 'export const WIX_CLIENT_ID = "public-test-client";');
const api = await import(pathToFileURL(join(fixture, 'rest/wix-donations.js')));
const transport = await import(pathToFileURL(join(fixture, 'rest/wix-client.js')));
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const storage = new Map();
globalThis.window = { location: { origin: 'https://donor.example.test' }, localStorage: {
  getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
} };
after(async () => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; await rm(fixture, { recursive: true, force: true }); });

const campaign = {
  id: 'campaign-id', status: 'COLLECTING', donationFrequencies: ['ONE_TIME', 'MONTH'],
  predefinedDonationAmounts: [{ id: 'preset-id', price: { amount: '25.00' } }],
  customAmountEnabled: true, customAmountOptions: { minimum: { amount: '5.00' }, maximum: { amount: '1000' } },
  askDonorCoverFee: true, commentsEnabled: true,
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function mockRequests(override = () => undefined) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, body, options });
    const overridden = override(path, body);
    if (overridden) return overridden;
    if (path === '/oauth2/token') return json({ access_token: 'visitor-test-token', refresh_token: 'test-refresh', expires_in: 3600 });
    if (path.endsWith('/campaign-id')) return json({ donationCampaign: campaign });
    if (path === '/ecom/v2/carts') return json({ cart: { id: 'cart-id' } });
    if (path === '/_api/redirects-api/v1/redirect-session') return json({ redirectSession: { fullUrl: 'https://checkout.example.test/session' } });
    throw new Error(`Unexpected test request: ${path}`);
  };
  return calls;
}

test('one-time flow uses one visitor, one standalone cart and one redirect; no V1 checkout', async () => {
  const calls = mockRequests();
  assert.equal(await api.donationCheckoutUrl('campaign-id', { amount: '25', frequency: 'ONE_TIME' }), 'https://checkout.example.test/session');
  const businessCalls = calls.filter(call => call.path !== '/oauth2/token');
  assert.deepEqual(businessCalls.map(call => call.path), [
    '/donation-campaigns/v2/donation-campaigns/campaign-id', '/ecom/v2/carts', '/_api/redirects-api/v1/redirect-session',
  ]);
  assert.ok(businessCalls.every(call => call.options.headers.Authorization === 'visitor-test-token'));
  assert.deepEqual(businessCalls[1].body.catalogItems[0].catalogReference.options, { amount: 25 });
  assert.deepEqual(businessCalls[2].body, { ecomCheckout: { checkoutId: 'cart-id' }, callbacks: {
    postFlowUrl: 'https://donor.example.test/donate/campaign-id', thankYouPageUrl: 'https://donor.example.test/donate/thank-you',
  } });
});

test('recurrence, fees and note preserve donor choices without double-charging the fee', () => {
  const body = api.donationCartBody(campaign, { amount: '37.50', frequency: 'MONTH', coverFee: true, note: ' A message ' });
  assert.deepEqual(body.catalogItems[0].catalogReference.options, { amount: 37.5, frequency: 'MONTH', donorCoveringFees: true });
  assert.equal(body.cart.note, 'A message');
});

test('selection validation respects campaign settings and permits correction', () => {
  for (const amount of ['', 'oops', 0, -1, Infinity, true, null, {}, 1, 1001]) {
    assert.throws(() => api.donationCartBody(campaign, { amount }));
  }
  assert.equal(api.donationCartBody(campaign, { amount: 10 }).catalogItems[0].catalogReference.options.amount, 10);
  assert.throws(() => api.donationCartBody(campaign, { amount: 25, frequency: 'YEAR' }), /offered/);
  assert.throws(() => api.donationCartBody({ ...campaign, customAmountEnabled: false }, { amount: 10 }), /suggested/);
  assert.throws(() => api.donationCartBody({ ...campaign, archived: true }, { amount: 25 }), /not accepting/);
  assert.throws(() => api.donationCartBody({ ...campaign, commentsEnabled: false }, { amount: 25, note: 'A note' }), /not enabled/);
  assert.throws(() => api.donationCartBody({ ...campaign, askDonorCoverFee: false }, { amount: 25, coverFee: true }), /not offered/);
});

test('bad cart options preserve the HTTP error and never attempt a redirect', async () => {
  const errorBody = { details: { applicationError: { code: 'ITEM_NOT_FOUND_IN_CATALOG' } } };
  const calls = mockRequests(path => path === '/ecom/v2/carts' ? json(errorBody, 400) : undefined);
  await assert.rejects(api.donationCheckoutUrl('campaign-id', { amount: 25 }), error => {
    assert.equal(error.status, 400); assert.deepEqual(error.body, errorBody); assert.equal(error.stage, 'cart'); return true;
  });
  assert.equal(calls.filter(call => call.path.includes('redirect-session')).length, 0);
});

test('redirect failure retains the known cart and does not silently create a second cart', async () => {
  const calls = mockRequests(path => path.includes('redirect-session') ? json({ message: 'Origin not allowed' }, 403) : undefined);
  await assert.rejects(api.donationCheckoutUrl('campaign-id', { amount: 25 }), error => {
    assert.equal(error.status, 403); assert.equal(error.stage, 'redirect'); assert.equal(error.cartId, 'cart-id'); return true;
  });
  assert.equal(calls.filter(call => call.path === '/ecom/v2/carts').length, 1);
});

test('Donations retains a payment-required error body instead of returning undefined', async () => {
  const errorBody = { message: 'Payment setup required', code: 'PAYMENT_REQUIRED' };
  mockRequests(() => json(errorBody, 402));
  await assert.rejects(transport.wixApiRequest('/a-test-read', { throwOnPaymentRequired: true }), error => {
    assert.equal(error.status, 402); assert.deepEqual(error.body, errorBody); return true;
  });
});

test('the shared transport keeps its existing 402 behavior for other verticals', async () => {
  mockRequests(() => json({ message: 'Payment setup required' }, 402));
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = message => warnings.push(message);
  try {
    assert.equal(await transport.wixApiRequest('/a-test-read'), undefined);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('query errors do not become empty campaigns; nextCursor is returned on success', async () => {
  mockRequests(path => path.endsWith('/query') ? json({ message: 'Permission denied' }, 403) : undefined);
  await assert.rejects(api.queryDonationCampaigns(), error => error.status === 403);
  mockRequests(path => path.endsWith('/query') ? json({ donationCampaigns: [campaign], pagingMetadata: { cursors: { next: 'next-page' } } }) : undefined);
  assert.deepEqual(await api.queryDonationCampaigns(), { campaigns: [campaign], nextCursor: 'next-page' });
});

test('absent campaigns differ from denied access; unavailable metrics stay errors', async () => {
  mockRequests(() => json({ message: 'Missing' }, 404));
  assert.equal(await api.getDonationCampaign('missing-id'), null);
  mockRequests(() => json({ message: 'Permission denied' }, 403));
  await assert.rejects(api.getDonationCampaign('campaign-id'), error => error.status === 403);
  await assert.rejects(api.getDonationCampaignMetrics('campaign-id'), error => error.status === 403);
});

test('platform deploy copies the new donation helper alongside the shared transport', async () => {
  const { result, files, copies, exitCode } = await deployFixture();
  assert.deepEqual(result.verticals, ['donations']);
  assert.equal(result.error, undefined);
  assert.equal(exitCode, 0);
  assert.equal(result.donationsTransport, 'from_shared_tree');
  assert.ok(copies.some(copy => copy.from.endsWith('/shared/app') && copy.to === '/app/src'));
  assert.ok(copies.some(copy => copy.from.endsWith('/donations/app') && copy.to === '/app/src'));
  assert.equal(files.get('/app/src/rest/wix-client.js'), transportSource);
  assert.equal(files.get('/app/src/rest/wix-donations.js'), donationSource);
  assert.equal(result.wixConfig, 'written');
});

test('incremental deployment upgrades only the exact shipped legacy transport and preserves 402 details', async () => {
  assert.equal(createHash('sha256').update(legacyTransportSource).digest('hex'), '10d53e5e06ac3da62f93d41cfd618b6169c5bb1a5ba07fb58ec7700aad42889e');
  const { result, files, copies, exitCode } = await deployFixture(legacyTransportSource);
  assert.equal(exitCode, 0);
  assert.equal(result.donationsTransport, 'upgraded_unmodified_legacy');
  assert.equal(files.get('/app/src/rest/wix-client.js'), transportSource);
  assert.equal(copies.filter(copy => copy.to === '/app/src/rest/wix-client.js' && copy.options.force === true).length, 1);
  const upgraded = await helperWithTransport(files.get('/app/src/rest/wix-client.js'));
  const errorBody = { code: 'PAYMENT_REQUIRED', message: 'Payment setup required' };
  mockRequests(() => json(errorBody, 402));
  await assert.rejects(upgraded.queryDonationCampaigns(), error => error.status === 402 && error.body.code === errorBody.code);
});

test('customized incompatible transport fails deployment preflight without any writes', async () => {
  const customized = `${legacyTransportSource}\n// User-owned customization.\n`;
  const { result, files, copies, writes, exitCode } = await deployFixture(customized);
  assert.equal(exitCode, 1);
  assert.deepEqual(result.verticals, []);
  assert.match(result.error, /customized or incompatible.*left unchanged.*Merge strict payment-error support/);
  assert.equal(files.get('/app/src/rest/wix-client.js'), customized);
  assert.equal(files.has('/app/src/rest/wix-donations.js'), false);
  assert.equal(copies.length, 0);
  assert.equal(writes.length, 0);
});

test('compatible customized transport is kept byte-for-byte on a Donations deploy', async () => {
  const customized = `${transportSource}\n// User-owned customization.\n`;
  const { result, files, copies, exitCode } = await deployFixture(customized);
  assert.equal(exitCode, 0);
  assert.equal(result.donationsTransport, 'already_supported');
  assert.equal(files.get('/app/src/rest/wix-client.js'), customized);
  assert.equal(copies.some(copy => copy.to === '/app/src/rest/wix-client.js'), false);
});

test('non-Donations deployment leaves the legacy transport untouched', async () => {
  const { result, files, copies, exitCode } = await deployFixture(legacyTransportSource, ['cms']);
  assert.equal(exitCode, 0);
  assert.deepEqual(result.verticals, ['cms']);
  assert.equal(result.donationsTransport, undefined);
  assert.equal(files.get('/app/src/rest/wix-client.js'), legacyTransportSource);
  assert.equal(copies.some(copy => copy.to === '/app/src/rest/wix-client.js'), false);
});

test('manual copying with a legacy transport fails actionably before making a network request', async () => {
  const incompatible = await helperWithTransport(legacyTransportSource);
  const calls = mockRequests();
  await assert.rejects(incompatible.queryDonationCampaigns(), error => {
    assert.equal(error.code, 'DONATIONS_TRANSPORT_UPGRADE_REQUIRED');
    assert.match(error.message, /Re-run the Donations deploy step.*customized src\/rest\/wix-client\.js/);
    return true;
  });
  assert.equal(calls.length, 0);
});
