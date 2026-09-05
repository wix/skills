const { test } = require('node:test');
const assert = require('node:assert/strict');
const seed = require('../skills/wix-vibe-headless/references/storefront/seed/seed-store.js');
const ctx = { token: 'test', siteId: 'test' };
const product = (name, code = '#123456') => ({ name, price: 10, quantity: 2,
  options: [{ name: 'Color', type: 'color', choices: [{ name: 'Green', colorCode: code }] }] });
const result = (index, id) => ({ itemMetadata: { originalIndex: index, success: true }, item: { id, slug: id, revision: '1' } });
function mockFetch(t, reply) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => reply };
  });
  return requests;
}
test('conflicting colors fail before setup or direct create sends any requests', async t => {
  const requests = mockFetch(t, {});
  const products = [product('Shirt'), product('Trousers', '#654321')];
  for (const run of [() => seed.setupStore(ctx, { products }), () => seed.bulkCreateProducts(ctx, products)]) {
    await assert.rejects(run, /Shirt.*#123456.*Trousers.*#654321/);
  }
  assert.equal(requests.length, 0);
});
test('consistent colors keep the one-request create path and restore response order', async t => {
  const requests = mockFetch(t, { productResults: { results: [result(1, 'two'), result(0, 'one')] } });
  const products = [product('Shirt'), product('Trousers', '#123456')];
  const created = await seed.bulkCreateProducts(ctx, products);
  assert.deepEqual(created.map(x => x.id), ['one', 'two']);
  assert.equal(requests.length, 1);
});
test('HTTP success with individual failure stops and retains IDs and the real error', async t => {
  const requests = mockFetch(t, { productResults: { results: [result(0, 'one'), {
    itemMetadata: { originalIndex: 1, success: false, error: { code: 'INVALID_ARGUMENT', description: 'Choice name green is not unique' } }, item: {}
  }] } });
  await assert.rejects(() => seed.bulkCreateProducts(ctx, [product('Shirt'), product('Trousers')]), error => {
    assert.deepEqual(error.createdProducts, [{ id: 'one', name: 'Shirt', index: 0 }]);
    assert.equal(error.failures[0].code, 'INVALID_ARGUMENT');
    assert.match(error.message, /Choice name green is not unique/);
    assert.match(error.message, /Do not rerun the full seed/);
    return true;
  });
  assert.equal(requests.length, 1, 'no retries or downstream requests');
});
test('absent bulk results report unknown creation status', async t => {
  const requests = mockFetch(t, {});
  await assert.rejects(() => seed.bulkCreateProducts(ctx, [product('Shirt')]), /creation status unknown/);
  assert.equal(requests.length, 1);
});
test('a nominally successful result without an ID is rejected', async t => {
  mockFetch(t, { productResults: { results: [result(0, undefined)] } });
  await assert.rejects(() => seed.bulkCreateProducts(ctx, [product('Shirt')]), /no product ID/);
});
test('image attachment rejects missing IDs before sending a query', async t => {
  const requests = mockFetch(t, {});
  await assert.rejects(() => seed.attachProductImages(ctx, [{ url: 'https://example.com/image.png' }]), /requires a product ID/);
  assert.equal(requests.length, 0);
});
