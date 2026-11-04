'use strict';
// Dry-run answers for writers that read back what they wrote.
//
// A dry run sends nothing, so a writer that verifies its own write (create, then read back; act,
// then re-read) needs the read to return what the dry run "wrote". This module keeps that state:
// one small site per dry run (project + site + run id), holding only what this dry run wrote.
// A write answers with the entity it sent plus a placeholder id, the way Wix answers with the
// created entity; a read by id or by an equality filter answers from that site. Nothing here
// knows the merchant's real site: a read of anything this dry run did not write answers empty
// (or an id-only placeholder), exactly like the generic dry-run shapes.
//
// `respond(request, context)` returns the response payload, or null when the endpoint is not one
// of the endpoints below (the generic shapes in wix-writers.js then apply).
const crypto = require('node:crypto');

const MAX_SITES = 16;
const sites = new Map();
function siteFor(scope) {
  let site = sites.get(scope);
  if (!site) {
    site = new Map();
    sites.set(scope, site);
    while (sites.size > MAX_SITES) sites.delete(sites.keys().next().value);
  }
  return site;
}
function table(site, kind) {
  if (!site.has(kind)) site.set(kind, new Map());
  return site.get(kind);
}
const clone = value => (value === undefined ? undefined : structuredClone(value));
// Every primitive in the filter equals the entity's value; `{ $eq: v }` counts as v.
function matching(rows, filter) {
  const wanted = Object.entries(filter || {}).map(([key, value]) => [key, value && typeof value === 'object' && '$eq' in value ? value.$eq : value])
    .filter(([, value]) => value === null || typeof value !== 'object');
  return rows.filter(row => wanted.every(([key, value]) => row[key] === value));
}
const nextRevision = revision => String(Number(revision || 0) + 1);

function handlers() {
  // Helpers bound per call through `c`: c.body, c.query, c.id(), c.get/put/del/list(kind, ...).
  const create = (kind, field, extra = () => ({})) => c => {
    const entity = { ...clone((c.body && c.body[field]) || {}), id: c.id(), ...extra(c) };
    c.put(kind, entity.id, entity);
    return { [field]: entity };
  };
  const read = (kind, field) => (c, [, id]) => ({ [field]: c.get(kind, decodeURIComponent(id)) || { id: decodeURIComponent(id), _dryRunPlaceholder: true } });
  const update = (kind, field, change) => (c, [, id]) => {
    const key = decodeURIComponent(id), before = c.get(kind, key) || { id: key };
    const entity = { ...before, ...change(c, before), id: key, revision: nextRevision(before.revision) };
    c.put(kind, key, entity);
    return { [field]: entity };
  };
  const list = (kind, field, filterOf = c => c.body && c.body.query && c.body.query.filter, extra = {}) => c => ({ [field]: matching(c.list(kind), filterOf(c)), ...extra });
  const lastPage = { pagingMetadata: { hasNext: false } };
  const addOnGroupDetails = group => ({ groupId: group.id, name: group.name, addOns: group.addOnIds.map(addOnId => ({ addOnId })) });
  const noContactTags = id => ({ id, tags: { privateTags: { tagIds: [] } } });
  const ITEM_SEO_EMPTY = { tags: [], resolvedTags: [], focusKeywords: [] };
  return [
    // Events
    ['POST', /^\/events\/v1\/categories$/, create('event-category', 'category')],
    ['POST', /^\/events\/v1\/categories\/query$/, c => ({ categories: c.list('event-category') })],
    ['GET', /^\/events\/v1\/categories\/([^/]+)$/, (c, [, eventId]) => ({ categories: (c.get('event-categories', decodeURIComponent(eventId)) || []).map(id => c.get('event-category', id) || { id }) })],
    ['POST', /^\/events\/v1\/bulk\/categories\/events$/, c => {
      for (const eventId of c.body.eventId || []) c.put('event-categories', eventId, [...new Set([...(c.get('event-categories', eventId) || []), ...(c.body.categoryId || [])])]);
      return {};
    }],
    ['POST', /^\/events\/v3\/events$/, create('event', 'event', c => ({ status: c.body.draft ? 'DRAFT' : 'UPCOMING' }))],
    ['POST', /^\/events\/v3\/events\/query$/, c => ({ events: matching(c.list('event').filter(event => event.status !== 'DRAFT'), c.body.query && c.body.query.filter) })],
    ['GET', /^\/events\/v3\/events\/([^/]+)$/, read('event', 'event')],
    ['POST', /^\/events\/v3\/ticket-definitions$/, create('ticket-definition', 'ticketDefinition')],
    ['POST', /^\/events\/v3\/ticket-definitions\/query$/, list('ticket-definition', 'ticketDefinitions')],
    ['GET', /^\/events\/v3\/ticket-definitions\/([^/]+)$/, read('ticket-definition', 'ticketDefinition')],
    ['POST', /^\/events\/v2\/rsvps$/, create('rsvp', 'rsvp')],
    ['POST', /^\/events\/v2\/rsvps\/query$/, list('rsvp', 'rsvps', undefined, lastPage)],
    ['GET', /^\/events\/v2\/rsvps\/([^/]+)$/, read('rsvp', 'rsvp')],
    // Forms. An entry answers CONFIRMED: there is no spam pass to wait for in a dry run.
    ['POST', /^\/form-schema-service\/v4\/forms$/, create('form', 'form', () => ({ revision: '1' }))],
    ['POST', /^\/form-schema-service\/v4\/forms\/query$/, list('form', 'forms', undefined, lastPage)],
    ['POST', /^\/forms\/v4\/submissions$/, create('form-submission', 'submission', () => ({ status: 'CONFIRMED' }))],
    ['GET', /^\/forms\/v4\/submissions\/([^/]+)$/, read('form-submission', 'submission')],
    ['POST', /^\/form-spam-submission-report-service\/v4\/form-spam-submission-reports\/namespace\/query$/, () => ({ formSpamSubmissionReports: [], ...lastPage })],
    // Gift cards
    ['POST', /^\/gift-cards\/v1\/gift-cards$/, create('gift-card', 'giftCard')],
    ['POST', /^\/gift-cards\/v1\/gift-cards\/query$/, list('gift-card', 'giftCards')],
    ['POST', /^\/gift-cards\/v1\/gift-card-products$/, create('gift-card-product', 'giftCardProduct', () => ({ revision: '1' }))],
    ['POST', /^\/gift-cards\/v1\/gift-card-products\/query$/, c => ({ giftCardProducts: c.list('gift-card-product') })],
    ['PATCH', /^\/gift-cards\/v1\/gift-card-products\/([^/]+)$/, update('gift-card-product', 'giftCardProduct', c => clone(c.body.giftCardProduct || {}))],
    ['GET', /^\/gift-cards\/v1\/gift-card-products\/([^/]+)$/, read('gift-card-product', 'giftCardProduct')],
    // Bookings add-ons and their service groups. These group paths sit under /bookings/v2/services,
    // so they must be answered here, before the generic Bookings service shape.
    ['POST', /^\/addons\/v1\/add-ons$/, create('add-on', 'addOn')],
    ['POST', /^\/addons\/v1\/add-ons\/query$/, list('add-on', 'addOns')],
    ['GET', /^\/addons\/v1\/add-ons\/([^/]+)$/, read('add-on', 'addOn')],
    ['DELETE', /^\/addons\/v1\/add-ons\/([^/]+)$/, (c, [, id]) => { c.del('add-on', decodeURIComponent(id)); return {}; }],
    ['POST', /^\/bookings\/v2\/services\/add-on-groups\/create$/, c => {
      const group = { id: c.id(), serviceId: c.body.serviceId, name: c.body.addOnGroup && c.body.addOnGroup.name, addOnIds: [...((c.body.addOnGroup && c.body.addOnGroup.addOnIds) || [])] };
      c.put('add-on-group', group.id, group);
      return { addOnGroup: { id: group.id, name: group.name, addOnIds: [...group.addOnIds] } };
    }],
    ['POST', /^\/bookings\/v2\/services\/add-on-groups\/set-add-ons-for-group$/, c => {
      const group = { ...(c.get('add-on-group', c.body.groupId) || { id: c.body.groupId, serviceId: c.body.serviceId }), addOnIds: [...(c.body.addOnIds || [])] };
      c.put('add-on-group', group.id, group);
      return { addOnGroup: { id: group.id, name: group.name, addOnIds: [...group.addOnIds] } };
    }],
    ['POST', /^\/bookings\/v2\/services\/add-on-groups\/list-add-on-groups-by-service-id$/, c => ({ addOnGroupsDetails: c.list('add-on-group').filter(group => group.serviceId === c.body.serviceId).map(addOnGroupDetails) })],
    ['POST', /^\/bookings\/v2\/services\/add-on-groups\/delete$/, c => { c.del('add-on-group', c.body.addOnGroupId); return {}; }],
    // Bookings: create, confirm, cancel, and Query Extended Bookings (the only read).
    ['POST', /^\/bookings\/bookings-reader\/v2\/extended-bookings\/query$/, c => ({ extendedBookings: matching(c.list('booking'), c.body.query && c.body.query.filter).map(booking => ({ booking })) })],
    ['POST', /^\/bookings\/v2\/bookings$/, create('booking', 'booking', () => ({ revision: '1' }))],
    ['POST', /^\/bookings\/v2\/bookings\/([^/]+)\/confirm$/, update('booking', 'booking', c => ({ status: 'CONFIRMED', ...(c.body.paymentStatus ? { paymentStatus: c.body.paymentStatus } : {}) }))],
    ['POST', /^\/bookings\/v2\/bookings\/([^/]+)\/cancel$/, update('booking', 'booking', () => ({ status: 'CANCELED' }))],
    // Pricing Plans orders. The create answers settled (no DRAFT): there is nothing to wait for.
    ['POST', /^\/pricing-plans\/v2\/checkout\/orders\/offline$/, c => {
      const id = c.id(), { planId, memberId, startDate, paid } = c.body;
      const order = { id, planId, buyer: { memberId }, startDate, subscriptionId: `${id}-subscription`, status: Date.parse(startDate) > Date.now() ? 'PENDING' : 'ACTIVE', lastPaymentStatus: paid ? 'PAID' : 'UNPAID' };
      c.put('plan-order', id, order);
      return { order };
    }],
    ['GET', /^\/pricing-plans\/v2\/orders$/, c => ({ orders: c.list('plan-order').filter(order => order.buyer.memberId === c.query.get('buyerIds') && order.planId === c.query.get('planIds')) })],
    ['GET', /^\/pricing-plans\/v2\/orders\/([^/]+)$/, read('plan-order', 'order')],
    ['POST', /^\/pricing-plans\/v2\/orders\/([^/]+)\/pause$/, (c, match) => { update('plan-order', 'order', () => ({ status: 'PAUSED' }))(c, match); return {}; }],
    // Contact labels (find-or-create by name) and labels on a contact.
    ['POST', /^\/contacts\/v4\/labels$/, c => {
      const displayName = String(c.body.displayName || '');
      const key = `custom.${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'label'}`;
      const existing = c.get('label', key);
      if (existing) return { label: existing, newLabel: false };
      const label = { key, tagId: crypto.createHash('sha256').update(`${c.scope}:${key}`).digest('hex').slice(0, 5), displayName, labelType: 'USER_DEFINED' };
      c.put('label', key, label);
      return { label, newLabel: true };
    }],
    ['GET', /^\/contacts\/v4\/labels\/([^/]+)$/, (c, [, key]) => ({ label: c.get('label', decodeURIComponent(key)) || { key: decodeURIComponent(key), _dryRunPlaceholder: true } })],
    ['POST', /^\/contacts\/v5\/contacts\/([^/]+)\/update-tags$/, (c, [, id]) => {
      const contactId = decodeURIComponent(id), contact = c.get('contact-tags', contactId) || noContactTags(contactId);
      const add = (c.body.assignTags && c.body.assignTags.privateTags && c.body.assignTags.privateTags.tagIds) || [];
      contact.tags.privateTags.tagIds = [...new Set([...contact.tags.privateTags.tagIds, ...add])];
      c.put('contact-tags', contactId, contact);
      return { contact };
    }],
    ['GET', /^\/contacts\/v5\/contacts\/([^/]+)$/, (c, [, id]) => (String(c.query.get('fields') || '').split(',').includes('TAGS')
      ? { contact: c.get('contact-tags', decodeURIComponent(id)) || noContactTags(decodeURIComponent(id)) } : null)],
    // Member About
    ['POST', /^\/members\/v2\/abouts\/query$/, list('member-about', 'memberAbouts')],
    ['POST', /^\/members\/v2\/abouts$/, create('member-about', 'memberAbout', () => ({ revision: '1' }))],
    ['PATCH', /^\/members\/v2\/abouts\/([^/]+)$/, update('member-about', 'memberAbout', c => clone(c.body.memberAbout || {}))],
    ['GET', /^\/members\/v2\/abouts\/([^/]+)$/, read('member-about', 'memberAbout')],
    // SEO (Promote SEO V1). Product SEO keeps the generic shape: it reads STORES_PRODUCT items
    // that this module never writes.
    ['GET', /^\/promote\/seo\/v1\/item-seo-tags\/([^/]+)\/([^/]+)$/, (c, [, itemType, itemId]) => (decodeURIComponent(itemType) === 'STORES_PRODUCT' ? null
      : { itemSeoTags: c.get('item-seo-tags', `${decodeURIComponent(itemType)}/${decodeURIComponent(itemId)}`) || clone(ITEM_SEO_EMPTY) })],
    ['POST', /^\/promote\/seo\/v1\/bulk\/item-seo-tags\/set$/, c => {
      const results = (c.body.entries || []).map((entry, originalIndex) => {
        const key = `${c.body.itemType}/${entry.itemId}`, stored = c.get('item-seo-tags', key) || clone(ITEM_SEO_EMPTY);
        const mask = String(entry.fieldMask || '').split(',');
        if (mask.includes('tags')) Object.assign(stored, { tags: clone(entry.itemSeoTags.tags || []), resolvedTags: (entry.itemSeoTags.tags || []).map(tag => ({ tag: clone(tag), source: 'TAG_SOURCE_ITEM' })) });
        if (mask.includes('focusKeywords')) stored.focusKeywords = clone(entry.itemSeoTags.focusKeywords || []);
        c.put('item-seo-tags', key, stored);
        return { itemMetadata: { id: entry.itemId, originalIndex, success: true } };
      });
      return { results, bulkActionMetadata: { totalSuccesses: results.length, totalFailures: 0, undetailedFailures: 0 } };
    }],
    // The site's allowed pattern variables are unknown without a live read: the answer says so.
    ['GET', /^\/promote\/seo\/v1\/seo-patterns\/([^/]+)\/variables$/, () => ({ variables: [], stateKnown: false, kind: 'wix_call_skipped' })],
    ['GET', /^\/promote\/seo\/v1\/seo-patterns\/([^/]+)$/, (c, [, pageType]) => ({ seoPattern: c.get('seo-pattern', decodeURIComponent(pageType)) || {} })],
    ...['POST', 'PATCH'].map(method => [method, /^\/promote\/seo\/v1\/seo-patterns\/([^/]+)$/, (c, [, pageType]) => {
      const key = decodeURIComponent(pageType), before = c.get('seo-pattern', key) || {};
      const seoPattern = { ...before, source: 'PATTERN_SOURCE_USER', pattern: clone((c.body.seoPattern && c.body.seoPattern.pattern) || {}) };
      c.put('seo-pattern', key, seoPattern);
      return { seoPattern };
    }]),
    ['GET', /^\/promote\/seo\/v1\/site-seo-tags$/, c => ({ siteSeoTags: c.get('site-seo-tags', 'site') || { tags: [] } })],
    ['PATCH', /^\/promote\/seo\/v1\/site-seo-tags$/, c => {
      const siteSeoTags = { tags: clone((c.body.siteSeoTags && c.body.siteSeoTags.tags) || []) };
      c.put('site-seo-tags', 'site', siteSeoTags);
      return { siteSeoTags };
    }],
  ];
}
const HANDLERS = handlers();

function locate(request) {
  let url;
  try { url = new URL(String(request.url || '')); } catch { return null; }
  const method = String(request.method || '').toUpperCase(), pathname = url.pathname.replace(/\/+$/, '');
  for (const [verb, pattern, answer] of HANDLERS) {
    if (verb !== method) continue;
    const match = pattern.exec(pathname);
    if (match) return { answer, match, query: url.searchParams };
  }
  return null;
}
// `scope` names one dry run's site; `placeholderId()` mints the id a create answers with.
function respond(request, { scope, placeholderId }) {
  const found = locate(request);
  if (!found) return null;
  const site = siteFor(String(scope));
  const c = {
    scope: String(scope),
    body: request.body || {},
    query: found.query,
    id: placeholderId,
    get: (kind, key) => clone(table(site, kind).get(key)),
    put: (kind, key, value) => { table(site, kind).set(key, clone(value)); },
    del: (kind, key) => { table(site, kind).delete(key); },
    list: kind => [...table(site, kind).values()].map(clone),
  };
  const answer = found.answer(c, found.match);
  return answer ? clone(answer) : null;
}

module.exports = { respond };
