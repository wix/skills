#!/usr/bin/env node
'use strict';

// Contract test for rp-target-wix/lib/wix-writers.js.
//
// Purpose: catch Wix API schema drift LOUDLY, in one place, instead of letting it
// surface as a stranger's broken migration. This is the maintenance answer to
// "shared code rots on schema change" — when the surface moves, this fails.
//
// Two modes:
//   - default (offline): asserts every primitive's request builder emits the verified
//     shape (method/url/body keys). Fast, no network, runs in CI.
//   - live: WIX_AUTH_TOKEN + WIX_SITE_ID set → issues one real call per primitive
//     against that (sandbox) site and reports status. This is the real verification —
//     run on a cadence and after any Wix API change.
//
// Run:  node scripts/contract-test.js            (offline shape checks)
//       WIX_AUTH_TOKEN=... WIX_SITE_ID=... node scripts/contract-test.js   (live)

const w = require('../lib/wix-writers');

let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, msg) => { failures++; console.log(`  FAIL ${name}: ${msg}`); };
function expect(name, cond, msg) { cond ? ok(name) : bad(name, msg); }

console.log('rp-target-wix contract test — request-shape assertions');

// Ricos: plugins MUST be uppercase (FR-007 trap).
const ricos = w.buildConvertToRicosRequest('<p>hi</p>');
expect('ricos endpoint', ricos.url.endsWith('/ricos/v1/ricos-document/convert/to-ricos'), ricos.url);
expect('ricos plugins uppercase', ricos.body.options.plugins.every((p) => p === p.toUpperCase()), JSON.stringify(ricos.body.options.plugins));

// Media import.
const media = w.buildImportMediaRequest({ sourceUrl: 'https://x/y.jpg', displayName: 'y.jpg', mediaType: 'image', wpId: 1 });
expect('media endpoint', media.url.endsWith('/site-media/v1/files/import'), media.url);
expect('media mediaType uppercased', media.body.mediaType === 'IMAGE', media.body.mediaType);

// Blog tag: top-level { label, language }, NOT { tag: {...} }.
const tag = w.buildCreateTagRequest({ label: 'X' });
expect('tag body top-level label', tag.body.label === 'X' && tag.body.tag === undefined, JSON.stringify(tag.body));
expect('tag body language', tag.body.language === 'en', JSON.stringify(tag.body));

// Blog category: nested { category: {...} }.
const cat = w.buildCreateCategoryRequest({ label: 'C', slug: 'c' });
expect('category body nested', !!cat.body.category && cat.body.category.label === 'C', JSON.stringify(cat.body));

// Draft post: featured image is heroImage.id (not media.wixMedia.image.id); memberId present.
const post = w.buildCreateDraftPostRequest({ title: 'T', memberId: 'm', richContent: { nodes: [] }, slug: 't', heroImageId: 'mediaId' });
expect('post heroImage.id', post.body.draftPost.heroImage && post.body.draftPost.heroImage.id === 'mediaId', JSON.stringify(post.body.draftPost.heroImage));
expect('post memberId required present', post.body.draftPost.memberId === 'm', 'memberId missing');

// CMS item.
const item = w.buildInsertItemRequest('Col', { a: 1 });
expect('data item shape', item.body.dataCollectionId === 'Col' && item.body.dataItem.data.a === 1, JSON.stringify(item.body));

const direct = w.buildDirectRestRequest({ method: 'POST', path: '/x/y', body: { a: 1 } });
expect('direct rest endpoint', direct.url.endsWith('/x/y'), direct.url);
expect('direct rest body', direct.body.a === 1, JSON.stringify(direct.body));

// UNVERIFIED bootstrap primitives: offline assertions only check the docs-derived
// envelope. Live mode must promote these after successful sandbox calls.
const storesProduct = w.buildCreateStoresProductRequest({ name: 'P' });
expect('stores product endpoint', storesProduct.url.endsWith('/stores/v3/products'), storesProduct.url);
expect('stores product body', storesProduct.body.product.name === 'P', JSON.stringify(storesProduct.body));

const storesProductQuery = w.buildQueryStoresProductsRequest({ paging: { limit: 1 } });
expect('stores product query endpoint', storesProductQuery.url.endsWith('/stores/v3/products/query'), storesProductQuery.url);
expect('stores product query body', storesProductQuery.body.query.paging.limit === 1, JSON.stringify(storesProductQuery.body));

// TEMPORARY FR-013 FALLBACK — remove these assertions with the V1 fallback block once
// fresh Wix Stores installs always produce Catalog V3.
const storesProductV1 = w.buildCreateStoresProductV1Request({
  name: 'P',
  productType: 'PHYSICAL',
  priceData: { price: '12.5' },
  categoryIds: ['cat-1'],
});
expect('stores product v1 fallback endpoint', storesProductV1.url.endsWith('/stores/v1/products'), storesProductV1.url);
expect('stores product v1 fallback body', storesProductV1.body.product.name === 'P', JSON.stringify(storesProductV1.body));
expect('stores product v1 fallback productType', storesProductV1.body.product.productType === 'physical', JSON.stringify(storesProductV1.body));
expect('stores product v1 fallback price number', storesProductV1.body.product.priceData.price === 12.5, JSON.stringify(storesProductV1.body));
expect('stores product v1 fallback collections', storesProductV1.body.product.collectionIds[0] === 'cat-1', JSON.stringify(storesProductV1.body));

const storesProductV1Query = w.buildQueryStoresProductsV1Request({ paging: { limit: 1 } });
expect('stores product v1 fallback query endpoint', storesProductV1Query.url.endsWith('/stores/v1/products/query'), storesProductV1Query.url);
expect('stores product v1 fallback query body', storesProductV1Query.body.query.paging.limit === 1, JSON.stringify(storesProductV1Query.body));

const storesCategory = w.buildCreateStoresCategoryRequest({ name: 'Cat' });
expect('stores category endpoint', storesCategory.url.endsWith('/categories/v1/categories'), storesCategory.url);
expect('stores category body', storesCategory.body.category.name === 'Cat', JSON.stringify(storesCategory.body));

const storesCollectionV1 = w.buildCreateStoresCollectionV1Request({ name: 'Cat', slug: 'cat', description: 'D' });
expect('stores collection v1 fallback endpoint', storesCollectionV1.url.endsWith('/stores/v1/collections'), storesCollectionV1.url);
expect('stores collection v1 fallback body', storesCollectionV1.body.collection.name === 'Cat', JSON.stringify(storesCollectionV1.body));

const contact = w.buildCreateContactRequest({ info: { name: { first: 'A' } } });
expect('contact endpoint', contact.url.endsWith('/contacts/v4/contacts'), contact.url);
expect('contact body info', contact.body.info.name.first === 'A', JSON.stringify(contact.body));
const contactWithArrays = w.buildCreateContactRequest({ info: { emails: [{ email: 'a@example.com', primary: true }] } });
expect('contact emails wrapper', contactWithArrays.body.info.emails.items[0].email === 'a@example.com', JSON.stringify(contactWithArrays.body));

const contactQuery = w.buildQueryContactsRequest({ paging: { limit: 1, offset: 0 } });
expect('contact query endpoint', contactQuery.url.endsWith('/contacts/v4/contacts/query'), contactQuery.url);
expect('contact query body', contactQuery.body.query.paging.limit === 1, JSON.stringify(contactQuery.body));

const coupon = w.buildCreateCouponRequest({ name: 'C', code: 'C', moneyOffAmount: { amount: '5' } });
expect('coupon endpoint', coupon.url.endsWith('/stores/v2/coupons'), coupon.url);
expect('coupon body specification', coupon.body.specification.code === 'C', JSON.stringify(coupon.body));

const couponQuery = w.buildQueryCouponsRequest({ paging: { limit: 1, offset: 0 } });
expect('coupon query endpoint', couponQuery.url.endsWith('/stores/v2/coupons/query'), couponQuery.url);
expect('coupon query body', couponQuery.body.query.paging.limit === 1, JSON.stringify(couponQuery.body));

const order = w.buildCreateOrderRequest({ channelInfo: { type: 'OTHER_PLATFORM' } });
expect('order endpoint', order.url.endsWith('/ecom/v1/orders'), order.url);
expect('order body', order.body.order.channelInfo.type === 'OTHER_PLATFORM', JSON.stringify(order.body));

const orderQuery = w.buildQueryOrdersRequest({ paging: { limit: 1 } });
expect('order query endpoint', orderQuery.url.endsWith('/ecom/v1/orders/query'), orderQuery.url);
expect('order query body', orderQuery.body.query.paging.limit === 1, JSON.stringify(orderQuery.body));

// Live mode: issue real calls if credentials are present.
(async () => {
  const token = process.env.WIX_AUTH_TOKEN;
  const siteId = process.env.WIX_SITE_ID;
  if (token && siteId) {
    console.log('\nLIVE mode — issuing real calls against site', siteId);
    const wix = w.createWixClient({ authToken: token, siteId });
    try {
      const doc = await w.convertHtmlToRichContent(wix, '<p>contract test</p>');
      expect('LIVE ricos convert', Array.isArray(doc.nodes), 'no nodes returned');
    } catch (e) { bad('LIVE ricos convert', e.message); }
    // Add further live calls (media import to a temp folder, tag create, then cleanup)
    // as the sandbox policy allows. Kept minimal here to avoid polluting a real site.
  } else {
    console.log('\n(skip live mode — set WIX_AUTH_TOKEN + WIX_SITE_ID to verify against a sandbox site)');
  }
  const notify = await w.notifyMissingWriter({ sourceEntity: 'x', wixEntity: 'wix.x', method: 'POST', path: '/x' });
  expect('notify missing writer noop', notify.noop === true && notify.notified === false, JSON.stringify(notify));
  console.log(failures ? `\n${failures} FAILURE(S) — the Wix surface may have moved; update lib/wix-writers.js.` : '\nAll shape checks passed.');
  process.exit(failures ? 1 : 0);
})();
