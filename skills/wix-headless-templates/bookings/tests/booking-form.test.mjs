// No live API calls or dependencies. Node >=22.13:
// node --experimental-vm-modules --test skills/wix-headless-templates/bookings/tests/*.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

// Run the real transports and DTO mappers, replacing only the network/auth and SDK boundary.
async function loadTransport(path, respond) {
  const requests = [];
  const request = async (path) => {
    const url = new URL(path, 'https://www.wixapis.com');
    requests.push(url);
    return respond(url);
  };
  const stub = (exports) => new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  });
  const mocks = {
    '@wix/bookings': stub(Object.fromEntries(['availabilityTimeSlots', 'eventTimeSlots', 'bookings', 'bookingsSettings', 'services'].map((name) => [name, {}]))),
    '@wix/auto_sdk_ecom_cart-v-2': stub({ createCart() {}, calculateCart() {}, placeOrder() {} }),
    '@wix/redirects': stub({ redirects: {} }),
    sdk: stub({ wixModule: (module) => module, wixFetch: async (path) => ({ ok: true, json: () => request(path) }) }),
    client: stub({ wixRequest: request }),
  };
  const modules = new Map();
  async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const source = stripTypeScriptTypes(await readFile(url, 'utf8'));
    const module = new SourceTextModule(source, { identifier: url.href });
    modules.set(url.href, module);
    await module.link((specifier, parent) => {
      if (mocks[specifier]) return mocks[specifier];
      if (specifier === '../sdk') return mocks.sdk;
      if (specifier.endsWith('/client.js')) return mocks.client;
      const file = specifier.replace(/\.js$/, '.ts');
      return load(new URL(file.endsWith('.ts') ? file : `${file}.ts`, parent.identifier));
    });
    return module;
  }
  const module = await load(new URL(path, import.meta.url));
  await module.evaluate();
  return { api: module.namespace, requests };
}

for (const path of ['../app/wix/bookings/booking.ts', '../rest/booking.ts', '../project/src/wix/bookings/booking.ts']) {
  test(`${path}: Get Form carries service context and summary remains unchanged`, async () => {
    const { api, requests } = await loadTransport(path, (url) => url.pathname.endsWith('/summary')
      ? { formSummary: { fields: [{ target: 'email', label: 'Email', type: 'EMAIL' }] } }
      : { form: { fields: [{ target: 'email', validation: { required: false } }] } });
    const fields = await api.fetchBookingForm('form/id', 'service + & id');
    const summary = requests.find((url) => url.pathname.endsWith('/summary'));
    const form = requests.find((url) => !url.pathname.endsWith('/summary'));
    assert.equal(form.pathname, '/form-schema-service/v4/forms/form%2Fid');
    assert.deepEqual(JSON.parse(form.searchParams.get('additionalMetadata')), { serviceIds: ['service + & id'] });
    assert.equal(summary.search, '');
    assert.equal(fields[0].target, 'email');
    assert.equal(fields[0].required, false);
  });

  test(`${path}: missing form and network failures still return contact basics`, async () => {
    const { api, requests } = await loadTransport(path, () => { throw new Error('unavailable'); });
    const fallback = await api.fetchBookingForm(null, 'service-id');
    assert.ok(fallback.length > 0);
    assert.equal(requests.length, 0);
    assert.deepEqual(await api.fetchBookingForm('form-id', 'service-id'), fallback);
  });
}
