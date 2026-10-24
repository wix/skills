// Component contracts only; hooks and checkout are stubbed, never Wix requests.
// Run with a project that already has typescript, react, react-dom and jsdom installed:
// DONATIONS_TEST_PROJECT=/path/to/project node --test <this-file>
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { createRequire } = require('node:module');
const dependencies = createRequire(join(resolve(process.env.DONATIONS_TEST_PROJECT || process.cwd()), 'package.json'));
const ts = dependencies('typescript');
const React = dependencies('react');
const { renderToStaticMarkup } = dependencies('react-dom/server');
const { JSDOM } = dependencies('jsdom');

const campaign = { id: 'campaign-id', options: {
  currency: 'USD', frequencies: [{ value: 'ONE_TIME', label: 'One-time' }, { value: 'MONTH', label: 'Monthly' }],
  presets: [{ amount: 25, label: '$25', impact: 'Care' }, { amount: 50, label: '$50', impact: 'Supplies' }],
  customAmount: { enabled: true, minLabel: '$5', maxLabel: '$1,000' },
  askCoverFee: true, commentsEnabled: true, commentMaxLength: 100,
} };
const state = overrides => ({
  available: true, frequency: 'ONE_TIME', presetAmount: 25, customMode: false, customAmount: '',
  coverFee: false, note: '', messages: {}, showErrors: false, valid: true, submitting: false,
  buttonLabel: 'Donate $25', selectPreset() {}, selectCustom() {}, setCustomAmount() {},
  setFrequency() {}, setCoverFee() {}, setNote() {}, donate: async () => {}, ...overrides,
});

function loadComponent(file, hook, value) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const result = { exports: {} };
  const requireStub = name => name.includes('/hooks/donations/') ? { [hook]: () => typeof value === 'function' ? value() : value } : dependencies(name);
  new Function('require', 'module', 'exports', compiled)(requireStub, result, result.exports);
  return result.exports.default;
}
function render(file, value, copies = 1) {
  const Form = loadComponent(file, 'useDonation', value);
  const html = renderToStaticMarkup(React.createElement('div', null,
    ...Array.from({ length: copies }, (_, key) => React.createElement(Form, { campaign, key }, 'Campaign closed'))));
  return new JSDOM(html).window.document;
}

for (const [name, path] of [['source', '../app/components/donations/'], ['project', '../project/src/components/donations/']]) {
  const file = resolve(__dirname, path, 'DonateForm.tsx');

  test(`${name}: choices are labelled native radio groups with separate frequency and amount names`, () => {
    const document = render(file, state());
    const groups = [...document.querySelectorAll('fieldset')];
    assert.deepEqual(groups.map(group => group.querySelector('legend').textContent), ['How often', 'Amount']);
    const frequency = [...groups[0].querySelectorAll('input[type=radio]')];
    const amounts = [...groups[1].querySelectorAll('input[type=radio]')];
    assert.equal(frequency.length, 2); assert.equal(amounts.length, 3);
    assert.ok([...frequency, ...amounts].every(input => input.labels.length === 1));
    assert.equal(new Set(frequency.map(input => input.name)).size, 1);
    assert.equal(new Set(amounts.map(input => input.name)).size, 1);
    assert.notEqual(frequency[0].name, amounts[0].name);
    frequency[1].click();
    assert.equal(frequency[1].checked, true); assert.equal(frequency[0].checked, false);
    assert.equal(amounts[0].checked, true);
  });

  test(`${name}: two forms for the same campaign do not share ids or radio-group names`, () => {
    const document = render(file, state({ customMode: true }), 2);
    const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
    assert.equal(new Set(ids).size, ids.length);
    const forms = document.querySelectorAll('form');
    assert.notEqual(forms[0].querySelector('input[type=radio]').name, forms[1].querySelector('input[type=radio]').name);
  });

  test(`${name}: invalid custom amount and note reference their actual error text`, () => {
    const document = render(file, state({ customMode: true, showErrors: true, valid: false,
      messages: { customAmount: 'Enter an amount.', note: 'Keep the note short.' } }));
    const amount = document.querySelector('input[inputmode=decimal]');
    assert.equal(amount.getAttribute('aria-invalid'), 'true');
    assert.equal(document.getElementById(amount.getAttribute('aria-describedby')).textContent, 'Enter an amount.');
    const note = document.querySelector('textarea');
    assert.equal(note.getAttribute('aria-invalid'), 'true');
    assert.ok(note.getAttribute('aria-describedby').split(' ').every(id => document.getElementById(id)));
  });

  test(`${name}: pending submission disables choices, fields and repeated submits`, () => {
    const document = render(file, state({ customMode: true, submitting: true }));
    assert.ok([...document.querySelectorAll('input,textarea,button')].every(el => el.matches(':disabled')));
    assert.equal(document.querySelector('button[type=submit]').getAttribute('aria-busy'), 'true');
  });

  test(`${name}: invalid submit focuses the field after rendering, including a repeated attempt`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
    const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
    const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const { createRoot } = dependencies('react-dom/client');
    const act = React.act || dependencies('react-dom/test-utils').act;
    const root = createRoot(dom.window.document.getElementById('root'));
    const Form = loadComponent(file, 'useDonation', () => {
      const [showErrors, setShowErrors] = React.useState(false);
      return state({ customMode: true, valid: false, showErrors, messages: { customAmount: 'Enter an amount.' },
        donate: async () => setShowErrors(true) });
    });
    try {
      await act(async () => root.render(React.createElement(Form, { campaign })));
      for (let attempt = 0; attempt < 2; attempt++) {
        dom.window.document.querySelector('button[type=submit]').focus();
        await act(async () => dom.window.document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
        await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
        assert.equal(dom.window.document.activeElement, dom.window.document.querySelector('input[inputmode=decimal]'));
      }
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });

  test(`${name}: a closed campaign has no donation controls`, () => {
    const document = render(file, state({ available: false }));
    assert.equal(document.querySelector('form'), null);
    assert.match(document.body.textContent, /Campaign closed/);
  });

  test(`${name}: direct or unreadable returns have a heading and next step without submission claims`, () => {
    const receiptFile = resolve(__dirname, path, 'DonationReceipt.tsx');
    for (const orderId of ['', 'unverified-order']) {
      const Receipt = loadComponent(receiptFile, 'useDonationReceipt', { orderId, loading: false, receipt: null });
      const document = new JSDOM(renderToStaticMarkup(React.createElement(Receipt))).window.document;
      assert.ok(document.querySelector('h1'));
      assert.ok(document.querySelector('a[href="/donate"]'));
      assert.doesNotMatch(document.body.textContent, /has been received|has been submitted|Thank you for your donation/);
      assert.match(document.body.textContent, /not a payment confirmation|could not be verified/);
    }
  });
}
