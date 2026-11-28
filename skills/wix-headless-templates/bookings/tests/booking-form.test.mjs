// No live API calls or dependencies. Node >=22.13:
// node --experimental-vm-modules --test skills/wix-headless-templates/bookings/tests/*.test.mjs
// Set WIX_FORM_LIVE=<clientId>:<formId>:<serviceId> to also run fetchBookingForm against a real site.
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

const decodeR = (url) => JSON.parse(Buffer.from(url.searchParams.get('.r'), 'base64').toString('utf8'));

const SUMMARY = { formSummary: { fields: [
  { target: 'first_name', label: 'First Name', type: 'STRING' },
  { target: 'email', label: 'Email', type: 'EMAIL' },
  { target: 'phone', label: 'Phone', type: 'PHONE' },
  { target: 'notes', label: 'Notes', type: 'STRING' },
] } };
const FORM = { form: { fields: [
  { target: 'first_name', validation: { required: true } },
  { target: 'email', validation: { required: true } },
  { target: 'phone', validation: { required: false } },
  { target: 'notes', hidden: true, validation: { required: false } },
] } };

for (const path of ['../app/wix/bookings/booking.ts', '../rest/booking.ts', '../project/src/wix/bookings/booking.ts']) {
  test(`${path}: Get Form names the service in .r; the summary request is unchanged`, async () => {
    const { api, requests } = await loadTransport(path, (url) => (url.pathname.endsWith('/summary') ? SUMMARY : FORM));
    await api.fetchBookingForm('form/id', 'service-1');
    const summary = requests.find((url) => url.pathname.endsWith('/summary'));
    const form = requests.find((url) => !url.pathname.endsWith('/summary'));
    assert.equal(form.pathname, '/form-schema-service/v4/forms/form%2Fid');
    assert.deepEqual(decodeR(form), { formId: 'form/id', additionalMetadata: { serviceIds: ['service-1'] } });
    assert.equal(form.searchParams.has('additionalMetadata'), false);
    assert.equal(summary.search, '');
  });

  test(`${path}: fields the schema hides are dropped; required comes from the schema`, async () => {
    const { api } = await loadTransport(path, (url) => (url.pathname.endsWith('/summary') ? SUMMARY : FORM));
    const fields = await api.fetchBookingForm('form-id', 'service-1');
    assert.deepEqual(fields.map((f) => [f.target, f.required]), [['first_name', true], ['email', true], ['phone', false]]);
  });

  test(`${path}: without a service id the request carries no query`, async () => {
    const { api, requests } = await loadTransport(path, (url) => (url.pathname.endsWith('/summary') ? SUMMARY : FORM));
    await api.fetchBookingForm('form-id');
    assert.ok(requests.every((url) => url.search === ''));
  });

  test(`${path}: missing form and network failures still return contact basics`, async () => {
    const { api, requests } = await loadTransport(path, () => { throw new Error('unavailable'); });
    const fallback = await api.fetchBookingForm(null, 'service-id');
    assert.ok(fallback.length > 0);
    assert.equal(requests.length, 0);
    assert.deepEqual(await api.fetchBookingForm('form-id', 'service-id'), fallback);
  });
}

// The booking form's address field as Get Form returns it (legacy `fields[]` entry).
const ADDRESS_SCHEMA = {
  target: 'address',
  hidden: false,
  validation: {
    required: true,
    predefined: { format: 'MULTILINE_ADDRESS', multilineAddressOptions: { allowedCountries: [], fields: {
      country: { required: true }, subdivision: { required: true }, city: { required: true }, postalCode: { required: true },
      streetName: { required: true }, streetNumber: { required: true }, addressLine: { required: true }, addressLine2: { required: true },
    } } },
  },
  view: { label: 'Address', fieldSettings: { addressLine2: { show: false } } },
};
const SUMMARY_WITH_ADDRESS = { formSummary: { fields: [...SUMMARY.formSummary.fields, { target: 'address', label: 'Address', type: 'MULTILINE_ADDRESS' }] } };

for (const path of ['../app/wix/bookings/booking.ts', '../rest/booking.ts']) {
  test(`${path}: an address the schema shows becomes an ADDRESS field with parts`, async () => {
    const { api } = await loadTransport(path, (url) => (url.pathname.endsWith('/summary')
      ? SUMMARY_WITH_ADDRESS
      : { form: { fields: [...FORM.form.fields, ADDRESS_SCHEMA] } }));
    const address = (await api.fetchBookingForm('form-id', 'service-1')).find((f) => f.target === 'address');
    assert.equal(address.type, 'ADDRESS');
    assert.equal(address.required, true);
    assert.equal(address.addressParts[0].sub, 'country');
    assert.ok(address.addressParts[0].choices.length > 100);
  });

  test(`${path}: an address the schema hides, or no schema at all, is left out`, async () => {
    for (const form of [{ form: { fields: [...FORM.form.fields, { ...ADDRESS_SCHEMA, hidden: true }] } }, null]) {
      const { api } = await loadTransport(path, (url) => {
        if (url.pathname.endsWith('/summary')) return SUMMARY_WITH_ADDRESS;
        if (!form) throw new Error('unavailable');
        return form;
      });
      const fields = await api.fetchBookingForm('form-id', 'service-1');
      assert.equal(fields.some((f) => f.target === 'address'), false);
    }
  });
}

test('address parts follow the country; the submission carries only those parts', async () => {
  const { api: core } = await loadTransport('../app/wix/bookings/booking-address-core.ts', () => ({}));
  const parts = core.addressFieldParts(ADDRESS_SCHEMA, true);
  const de = core.addressPartsForCountry('DE', parts.addressOverrides, true).map((p) => p.sub);
  const us = core.addressPartsForCountry('US', parts.addressOverrides, true).map((p) => p.sub);
  assert.deepEqual(de.slice(0, 1), ['country']);
  assert.ok(de.includes('streetName') && de.includes('streetNumber') && !de.includes('addressLine'));
  assert.ok(us.includes('addressLine') && !us.includes('streetName'));
  const states = core.addressPartsForCountry('DE', parts.addressOverrides, true).find((p) => p.sub === 'subdivision').choices;
  assert.ok(states.some((c) => c.value === 'BE'));

  const field = { target: 'address', label: 'Address', type: 'ADDRESS', required: true,
    addressParts: core.addressPartsForCountry('DE', parts.addressOverrides, true), addressOverrides: parts.addressOverrides };
  const full = { country: 'DE', streetName: 'Invalidenstrasse', streetNumber: '1', city: 'Berlin', postalCode: '10115', subdivision: 'BE', addressLine: 'stale' };
  assert.equal(core.addressComplete(field, { country: 'DE' }), false);
  assert.equal(core.addressComplete(field, full), true);
  const submission = core.formSubmissionOf([field], { first_name: 'A' }, { address: full });
  assert.equal(submission.first_name, 'A');
  assert.equal(submission.address.addressLine, undefined);
  assert.equal(submission.address.streetName, 'Invalidenstrasse');
  assert.deepEqual(core.formSubmissionOf([{ ...field, required: false }], {}, {}), {});
});

// WIX_FORM_LIVE=<clientId>:<formId>:<serviceId>; WIX_FORM_LIVE_BOOK=<slot JSON> also creates a booking.
const live = process.env.WIX_FORM_LIVE;
test('live: fetchBookingForm against a real site, with and without the service', { skip: !live }, async () => {
  const [clientId, formId, serviceId] = live.split(':');
  const token = (await (await fetch('https://www.wixapis.com/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }),
  })).json()).access_token;
  const respond = async (url) => {
    const r = await fetch(url, { headers: { authorization: token } });
    if (!r.ok) throw new Error(`${r.status} ${url.pathname}`);
    return r.json();
  };
  for (const path of ['../app/wix/bookings/booking.ts', '../rest/booking.ts']) {
    const { api } = await loadTransport(path, respond);
    const plain = await api.fetchBookingForm(formId);
    const forService = await api.fetchBookingForm(formId, serviceId);
    const show = (fields) => JSON.stringify(fields.map((f) => [f.target, f.type, f.required, ...(f.addressParts ? [f.addressParts.map((p) => p.sub)] : [])]));
    console.log(path, '\n  no service:', show(plain), '\n  service:   ', show(forService));
  }
  const slot = process.env.WIX_FORM_LIVE_BOOK && JSON.parse(process.env.WIX_FORM_LIVE_BOOK);
  if (!slot) return;
  const { api } = await loadTransport('../rest/booking.ts', respond);
  const { api: core } = await loadTransport('../app/wix/bookings/booking-address-core.ts', () => ({}));
  let fields = await api.fetchBookingForm(formId, serviceId);
  const values = { first_name: 'Form', last_name: 'Test', email: 'form-test@example.com' };
  const addresses = {};
  fields = fields.map((f) => {
    if (f.type !== 'ADDRESS') return f;
    addresses[f.target] = { country: 'DE', streetName: 'Invalidenstrasse', streetNumber: '1', city: 'Berlin', postalCode: '10115', subdivision: 'BE' };
    return { ...f, addressParts: core.addressPartsForCountry('DE', f.addressOverrides, f.required) };
  });
  const formSubmission = core.formSubmissionOf(fields, values, addresses);
  const r = await fetch('https://www.wixapis.com/bookings/v2/bookings', {
    method: 'POST', headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ booking: slot, formSubmission }),
  });
  const body = await r.json();
  console.log('  create booking:', r.status, body.booking?.id ?? JSON.stringify(body).slice(0, 300), JSON.stringify(formSubmission));
  assert.equal(r.status, 200);
});
