'use strict';

const HANDLER_VERSION = '1.0.1';

function bodyOf(response) {
  return response && response.data !== undefined ? response.data : response;
}

function assertPage(body, requestedPage) {
  if (!body || !Array.isArray(body.cards)) throw new Error(`page ${requestedPage}: cards must be an array`);
  if (!Number.isInteger(body.total) || body.total < 0) throw new Error(`page ${requestedPage}: total must be a non-negative integer`);
  if (body.page !== undefined && Number(body.page) !== requestedPage) throw new Error(`page ${requestedPage}: response page does not match request`);
}

function normalizeBalance(value, cardNumber, page) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`page ${page}: balance for ${cardNumber} must be a decimal string or number`);
  }
  const decimal = typeof value === 'string' ? value.trim() : String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal) || !Number.isFinite(Number(decimal))) {
    throw new Error(`page ${page}: balance for ${cardNumber} must be finite, non-negative, and have at most 2 decimal places`);
  }
  return decimal;
}

async function extract({ httpClient, siteBaseUrl, auth, extractionRoute = '/wix-migration-helper/v1/pw-gift-cards' } = {}) {
  if (!httpClient || typeof httpClient.get !== 'function') throw new Error('httpClient.get is required');
  if (!siteBaseUrl || typeof siteBaseUrl !== 'string') throw new Error('siteBaseUrl is required');

  const perPage = 200;
  const base = siteBaseUrl.replace(/\/$/, '');
  const route = extractionRoute.startsWith('/') ? extractionRoute : `/${extractionRoute}`;
  const remainingBalanceByCard = {};
  let page = 1;
  let expectedTotal = null;
  let sourceCount = 0;

  while (expectedTotal === null || sourceCount < expectedTotal) {
    const response = await httpClient.get(`${base}/wp-json${route}`, {
      params: { page, per_page: perPage },
      auth,
    });
    const body = bodyOf(response);
    assertPage(body, page);
    if (expectedTotal === null) expectedTotal = body.total;
    if (body.total !== expectedTotal) throw new Error(`page ${page}: total changed during extraction`);
    if (body.cards.length === 0 && sourceCount < expectedTotal) throw new Error(`page ${page}: short read before total was reached`);

    for (const card of body.cards) {
      if (!card || typeof card.number !== 'string' || card.number.length === 0) throw new Error(`page ${page}: card number is required`);
      if (Object.prototype.hasOwnProperty.call(remainingBalanceByCard, card.number)) throw new Error(`page ${page}: duplicate card number ${card.number}`);
      remainingBalanceByCard[card.number] = normalizeBalance(card.balance, card.number, page);
    }
    sourceCount += body.cards.length;
    if (sourceCount > expectedTotal) throw new Error(`page ${page}: fetched more cards than total`);
    page += 1;
  }

  return {
    remainingBalanceByCard,
    sourceCount,
    expectedTotal: expectedTotal === null ? 0 : expectedTotal,
    reconciled: sourceCount === (expectedTotal === null ? 0 : expectedTotal),
  };
}

module.exports = { HANDLER_VERSION, extract, normalizeBalance };
