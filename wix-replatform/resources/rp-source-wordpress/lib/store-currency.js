'use strict';

// Where a WooCommerce store's currency actually comes from.
//
// The `currency` field on an order is documented as an ISO 4217 code, and on a stock store it is
// one. It is not reliable: LIVE-FOUND 2026-09-05 on a real store, every order returned
// `currency: "&#8362;"` -- the HTML-encoded shekel SYMBOL -- because a plugin or theme filter had
// overridden the field. Passed through, that reaches the payment gate as a currency that matches
// nothing, and every payment record is refused as a currency mismatch. Passed through without a
// gate it would write amounts labelled with a symbol into the target.
//
// `/wc/v3/settings/general` -> `woocommerce_currency` is the store's own declared setting and is
// the authoritative answer. It is one request per run, not one per order.
//
// The per-order field is still worth reading: a store CAN legitimately hold orders in more than
// one currency (multi-currency plugins), and in that case the order's own value is the true one.
// So the rule is: trust the order's value when it is a plausible ISO code, fall back to the
// store's setting when it is not, and refuse when neither yields one. Never infer a code from a
// symbol -- "$" is at least a dozen different currencies.

const ISO_4217 = /^[A-Z]{3}$/;

// The symbols worth recognising -- not to RESOLVE a currency from, but to notice when the store's
// declared currency and the order's mangled field are talking about different money. A store set
// to ILS whose order says "$" is not an ILS order with a broken field; it is an order this code
// cannot read, and falling back would relabel dollars as shekels.
//
// Deliberately not a lookup table from symbol to code: "$" is USD, CAD, AUD, MXN, SGD and more,
// and picking one silently misstates money. This maps a code to the symbols it may legitimately
// appear as, and is used only to CORROBORATE a fallback, never to produce one.
const SYMBOLS_BY_CODE = {
  ILS: ['₪', '&#8362;', '&#x20AA;', 'NIS'],
  USD: ['$', '&#36;', 'US$'],
  EUR: ['€', '&#8364;', '&#x20AC;'],
  GBP: ['£', '&#163;', '&#xA3;'],
  JPY: ['¥', '&#165;', '&#xA5;'],
  AUD: ['$', 'A$', '&#36;'],
  CAD: ['$', 'C$', '&#36;'],
};

function readStoreCurrency(generalSettings) {
  if (!Array.isArray(generalSettings)) return null;
  const setting = generalSettings.find((entry) => entry && entry.id === 'woocommerce_currency');
  const value = setting && typeof setting.value === 'string' ? setting.value.trim().toUpperCase() : '';
  return ISO_4217.test(value) ? value : null;
}

// Shape is not proof. `ABC`, `XXX` and `ZZZ` all match /^[A-Z]{3}$/ and none of them is money the
// target can hold, so a code is accepted only if one of the two sides actually recognises it.
function plausibleCode(code, known) {
  if (!ISO_4217.test(code)) return false;
  return known.length === 0 || known.includes(code);
}

// `knownCurrencies` is the set the source or target actually supports -- WooCommerce publishes one
// at /wc/v3/data/currencies, and the target site declares its own. Pass it when you have it;
// with none, shape is all that is left and the caller is told so.
function resolveOrderCurrency(order, storeCurrency, { knownCurrencies = [] } = {}) {
  const known = (knownCurrencies || []).map((c) => String(c).toUpperCase());
  const declared = order && typeof order.currency === 'string' ? order.currency.trim() : '';
  const upper = declared.toUpperCase();

  if (ISO_4217.test(upper)) {
    if (plausibleCode(upper, known)) return { currency: upper, source: 'order' };
    return {
      currency: null,
      source: null,
      finding: { code: 'order-currency-unknown', declared, note: 'shaped like a code but not one this store or target supports' },
    };
  }

  // The order's field is not a code. Falling back to the store default is only safe when the
  // mangled value does not CONTRADICT it -- otherwise a "$" order in an ILS store becomes ILS.
  if (storeCurrency && ISO_4217.test(storeCurrency)) {
    const expected = SYMBOLS_BY_CODE[storeCurrency] || [];
    const agrees = declared.length === 0 || expected.some((symbol) => symbol.toUpperCase() === upper);
    if (!agrees) {
      return {
        currency: null,
        source: null,
        // The important one. This is money, and the two sources of truth disagree.
        finding: { code: 'order-currency-contradicts-store', declared, storeCurrency },
      };
    }
    return {
      currency: storeCurrency,
      source: 'store-settings',
      // Reported, not silent: a store that mangles this field is a store whose other
      // currency-bearing fields are suspect too.
      finding: { code: 'order-currency-not-iso', declared: declared || null, corroboratedBy: declared ? 'symbol-matches-store-currency' : 'field-empty' },
    };
  }

  return {
    currency: null,
    source: null,
    finding: { code: 'currency-unresolvable', declared: declared || null },
  };
}

module.exports = { ISO_4217, SYMBOLS_BY_CODE, readStoreCurrency, resolveOrderCurrency };
