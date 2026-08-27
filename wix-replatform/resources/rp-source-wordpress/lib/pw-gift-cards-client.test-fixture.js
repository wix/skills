'use strict';

async function selfTest(extract) {
  const calls = [];
  const cards = Array.from({ length: 250 }, (_, index) => ({
    number: `CARD${String(index + 1).padStart(4, '0')}`,
    balance: (index + 0.5).toFixed(2),
  }));
  const httpClient = {
    async get(url, options) {
      calls.push({ url, options });
      const start = (options.params.page - 1) * options.params.per_page;
      return { cards: cards.slice(start, start + options.params.per_page), total: cards.length, page: options.params.page, per_page: options.params.per_page };
    },
  };
  const result = await extract({ httpClient, siteBaseUrl: 'https://example.test' });
  if (!result.reconciled || result.sourceCount !== 250 || Object.keys(result.remainingBalanceByCard).length !== 250) {
    throw new Error('fixture extraction did not reconcile all 250 cards');
  }
  if (calls.length !== 2 || calls[1].options.params.page !== 2) throw new Error('fixture extraction did not request page 2');
  if (result.remainingBalanceByCard.CARD0001 !== '0.50') throw new Error('fixture output shape does not match gift-card-build input');
  return true;
}

module.exports = selfTest;
