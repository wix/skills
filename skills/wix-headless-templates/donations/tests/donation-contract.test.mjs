// Local contracts only; no Wix requests or financial transactions. Node >=22.12:
// node --experimental-strip-types --test skills/wix-headless-templates/donations/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as source from '../app/wix/donations/donations-core.ts';
import * as project from '../project/src/wix/donations/donations-core.ts';

for (const [name, api] of Object.entries({ source, project })) {
  test(`${name}: campaign decimal strings become numeric one-time cart options`, () => {
    const body = api.cartBody('campaign-id', { amount: '25.00', frequency: 'ONE_TIME', coverFee: false, note: '' });
    assert.deepEqual(body, {
      cart: { source: { channelType: 'WEB' } },
      catalogItems: [{ quantity: 1, catalogReference: {
        appId: '333b456e-dd48-4d6b-b32b-9fd48d74e163',
        catalogItemId: 'campaign-id', options: { amount: 25 },
      } }],
    });
    assert.equal(typeof JSON.parse(JSON.stringify(body)).catalogItems[0].catalogReference.options.amount, 'number');
  });

  for (const frequency of ['WEEK', 'MONTH', 'YEAR']) {
    test(`${name}: ${frequency} and optional fee flag survive without inflating base amount`, () => {
      const body = api.cartBody('campaign-id', { amount: 50, frequency, coverFee: true, note: 'In memory' });
      assert.deepEqual(body.catalogItems[0].catalogReference.options, { amount: 50, frequency, donorCoveringFees: true });
      assert.equal(body.cart.note, 'In memory');
    });
  }

  test(`${name}: invalid inputs cannot reach cart creation`, () => {
    for (const amount of ['', ' ', 'not-money', 0, -1, NaN, Infinity, null, true, {}]) {
      assert.throws(() => api.donationLineItem('campaign-id', { amount, frequency: 'ONE_TIME' }), /positive donation amount/);
    }
    assert.throws(() => api.donationLineItem('campaign-id', { amount: 25, frequency: 'QUARTER' }), /supported donation frequency/);
    assert.throws(() => api.donationLineItem('', { amount: 25, frequency: 'ONE_TIME' }), /campaign id/);
  });

  test(`${name}: Cart V2 id is passed directly to hosted checkout, with separate callbacks`, () => {
    const id = api.cartIdOf({ cart: { id: 'cart-id' } });
    assert.equal(api.cartIdOf({ _id: 'cart-id' }), id);
    assert.deepEqual(api.redirectBody(id, 'campaign-id', 'https://donor.example.test'), {
      ecomCheckout: { checkoutId: 'cart-id' },
      callbacks: { postFlowUrl: 'https://donor.example.test/donate/campaign-id', thankYouPageUrl: 'https://donor.example.test/donate/thank-you' },
    });
    assert.throws(() => api.cartIdOf({}), /no cart id/);
  });

  test(`${name}: payment-related API errors keep their actual cause, status and body`, () => {
    const error = Object.assign(new Error('Unsupported PAYMENT_METHOD'), { status: 400, body: { code: 'PAYMENT_METHOD_UNSUPPORTED' } });
    assert.equal(api.checkoutError(error), error);
    assert.equal(api.checkoutError(error, 'redirect', 'cart-id'), error);
    assert.equal(error.stage, 'redirect');
    assert.equal(error.cartId, 'cart-id');
    assert.deepEqual(error.body, { code: 'PAYMENT_METHOD_UNSUPPORTED' });
    assert.equal(api.checkoutError('network failure').cause, 'network failure');
  });

  test(`${name}: unavailable goal metrics differ from a verified zero and from an exceeded goal`, () => {
    const goal = { targetAmount: { amount: '100' } };
    assert.equal(api.toGoal(goal, null, 'USD').raised, '');
    assert.notEqual(api.toGoal(goal, [], 'USD').raised, '');
    const known = api.toGoal(goal, [{ currencyCode: 'USD', donationCount: 3, totalAmount: { amount: '125' } }], 'USD');
    assert.equal(known.percent, 125);
    assert.equal(known.donationCount, 3);
    assert.equal(api.toGoal(null, [], 'USD'), null);
  });
}

test('scaffold and deployable donation payloads remain identical', () => {
  const input = { amount: 37.5, frequency: 'MONTH', coverFee: true, note: 'A message' };
  assert.deepEqual(source.cartBody('campaign-id', input), project.cartBody('campaign-id', input));
});
