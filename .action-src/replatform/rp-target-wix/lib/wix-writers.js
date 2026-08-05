'use strict';

// rp-target-wix — verified-once Wix write primitives.
//
// The Wix API surface is identical for every migration regardless of source
// platform, so it is pre-built and verified HERE once rather than re-derived (and
// re-broken) by codegen on every run. `rp-import-codegen` vendors a copy of this
// module into the project (like the wp-http transport) and the generated writers
// call these primitives — they hold only per-project field maps, not API plumbing.
//
// Each call is split into a PURE request builder (`build*Request`, testable + usable
// by dry-runs) and an executor that sends it via the injected client.
//
// Endpoints + request shapes marked `// VERIFIED:` were validated by REAL CALLS against
// a live Wix site (not just docs — see SKILL.md "Validate by real call"). Shapes marked
// `// UNVERIFIED:` are docs-schema/MCP-derived bootstrap primitives. They must be
// surfaced in execution plans until a live contract call promotes them to VERIFIED.

const WIXAPIS = 'https://www.wixapis.com';

// --- client ----------------------------------------------------------------
// config: { authToken, siteId }. authToken is an OAuth access token / API key with
// scopes: Blog manage, Wix Data collections manage, media import, Members manage.
function createWixClient(config) {
  if (!config || !config.authToken) {
    throw new Error(
      'createWixClient: no Wix write credentials. Provide an OAuth access token / API ' +
        'key (scopes: BLOG.MANAGE-BLOG, WIX_DATA.DATA-COLLECTIONS-MANAGE, media import, ' +
        'Members manage). In an autonomous run this is injected at provisioning time.',
    );
  }
  const headers = {
    Authorization: config.authToken,
    'Content-Type': 'application/json',
    ...(config.siteId ? { 'wix-site-id': config.siteId } : {}),
  };
  return {
    async send({ method, url, body }) {
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
      return json;
    },
  };
}

// --- missing-writer bootstrap ---------------------------------------------
// Generated migrations use this when Wix has a native entity but rp-target-wix does not
// yet ship a dedicated writer primitive. This keeps the write path explicit and logged
// without pretending generic CMS is an acceptable substitute for a native Wix entity.
function buildDirectRestRequest({ method, path, url, body }) {
  if (!method) throw new Error('buildDirectRestRequest: method is required');
  if (!path && !url) throw new Error('buildDirectRestRequest: path or url is required');
  return {
    method,
    url: url || `${WIXAPIS}${path.startsWith('/') ? path : `/${path}`}`,
    body,
  };
}
async function sendDirectRest(wix, request) {
  return wix.send(buildDirectRestRequest(request));
}
async function notifyMissingWriter({ sourceEntity, wixEntity, method, path, reason }) {
  // NOOP for now. Replace with Slack/Jira/telemetry once the RePlatform team chooses a
  // destination. Keep the return value structured so callers can log/report it.
  return {
    notified: false,
    noop: true,
    sourceEntity,
    wixEntity,
    method,
    path,
    reason,
  };
}

// --- rich content: HTML → Ricos document -----------------------------------
// VERIFIED: POST /ricos/v1/ricos-document/convert/to-ricos with HTML input.
// VERIFIED-TRAP (FR-007): `options.plugins` enum values are UPPERCASE. The public
// docs example shows lowercase (["image","link"]); lowercase returns HTTP 400.
// VERIFIED-TRAP (FR-009): `source.html` is capped at 30000 chars (400 MAX_LENGTH).
// `convertHtmlToRichContent` transparently chunks larger HTML and merges the Ricos
// node arrays, so callers never have to think about the cap.
const RICOS_PLUGINS = ['IMAGE', 'LINK', 'VIDEO', 'AUDIO', 'HEADING', 'DIVIDER', 'CODE_BLOCK', 'TABLE', 'GALLERY'];
const RICOS_HTML_CAP = 30000; // FR-009 hard limit on source.html
const RICOS_CHUNK_TARGET = 28000; // headroom under the cap
function buildConvertToRicosRequest(html, plugins = RICOS_PLUGINS) {
  return { method: 'POST', url: `${WIXAPIS}/ricos/v1/ricos-document/convert/to-ricos`, body: { html, options: { plugins } } };
}
// FR-009: split HTML at block-level close tags so each chunk stays under the cap
// without slicing through an element. A single block bigger than `max` is hard-split
// as a last resort (rare; logged by the caller).
function splitHtmlIntoChunks(html, max = RICOS_CHUNK_TARGET) {
  if (html.length <= max) return [html];
  const parts = html.split(/(?<=<\/(?:p|div|section|article|h[1-6]|ul|ol|li|blockquote|pre|figure|table|tbody|thead|tr)>)/i);
  const chunks = [];
  let cur = '';
  for (const part of parts) {
    if (part.length > max) {
      if (cur) { chunks.push(cur); cur = ''; }
      for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + part.length > max) { chunks.push(cur); cur = ''; }
    cur += part;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
async function convertHtmlToRichContent(wix, html, { plugins, mediaBySourceUrl } = {}) {
  const chunks = splitHtmlIntoChunks(html || '');
  let merged = null;
  for (const chunk of chunks) {
    const { document } = await wix.send(buildConvertToRicosRequest(chunk, plugins));
    if (!merged) merged = document;
    else merged.nodes = (merged.nodes || []).concat(document.nodes || []);
  }
  return mediaBySourceUrl ? rewriteInlineMedia(merged, mediaBySourceUrl) : merged;
}
function rewriteInlineMedia(ricosDocument, mediaBySourceUrl) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const key of ['imageData', 'videoData', 'audioData']) {
      const src = node[key]?.media?.src?.url || node[key]?.src?.url;
      if (src && mediaBySourceUrl.has(src)) {
        const id = mediaBySourceUrl.get(src);
        if (node[key].media?.src) node[key].media.src = { id };
        else if (node[key].src) node[key].src = { id };
      }
    }
    (node.nodes || []).forEach(visit);
  };
  (ricosDocument?.nodes || []).forEach(visit);
  return ricosDocument;
}

// --- media (import-from-URL) -----------------------------------------------
// VERIFIED: POST /site-media/v1/files/import. ASYNC — the response file has
// operationStatus PENDING; poll the descriptor (or listen for File Ready) before
// referencing it in content that must render immediately.
function buildImportMediaRequest({ sourceUrl, displayName, mimeType, mediaType, wpId }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/site-media/v1/files/import`,
    body: {
      url: sourceUrl,
      displayName,
      mimeType: mimeType || undefined,
      mediaType: mediaType ? String(mediaType).toUpperCase() : undefined, // IMAGE | AUDIO | VIDEO | DOCUMENT
      externalInfo: wpId != null ? { origin: 'wordpress', externalId: String(wpId) } : undefined,
    },
  };
}
async function importMedia(wix, payload) {
  const { file } = await wix.send(buildImportMediaRequest(payload));
  return file; // { id, url, operationStatus, ... }
}
// VERIFIED: GET /site-media/v1/files/{id} returns the descriptor; poll until ready.
async function waitUntilFileReady(wix, fileId, { tries = 10, delayMs = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await wix.send({ method: 'GET', url: `${WIXAPIS}/site-media/v1/files/${fileId}` });
    const status = r?.file?.operationStatus;
    if (status === 'READY') return r.file;
    if (status === 'FAILED') throw new Error(`media import failed for ${fileId}`);
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null; // caller decides whether to proceed with a still-PENDING file
}

// --- blog taxonomies -------------------------------------------------------
// VERIFIED: POST /blog/v3/categories with { category: { label, slug, description } }.
function buildCreateCategoryRequest({ label, slug, description }) {
  return { method: 'POST', url: `${WIXAPIS}/blog/v3/categories`, body: { category: { label, slug, description: description || '' } } };
}
async function createBlogCategory(wix, payload) {
  return (await wix.send(buildCreateCategoryRequest(payload))).category;
}
// VERIFIED: POST /blog/v3/tags. Body is TOP-LEVEL { label, language } — NOT
// { tag: { label, slug } }. `slug` is derived by Wix from the label.
function buildCreateTagRequest({ label, language = 'en' }) {
  return { method: 'POST', url: `${WIXAPIS}/blog/v3/tags`, body: { label, language } };
}
async function createBlogTag(wix, payload) {
  return (await wix.send(buildCreateTagRequest(payload))).tag;
}
// VERIFIED: GET /blog/v3/tags lists tags as { id, label, slug, ... }. Used to resolve a
// tag id after a 409 ALREADY_EXISTS (FR-011) so it can still be attached to a post.
async function listBlogTags(wix, { limit = 500 } = {}) {
  const r = await wix.send({ method: 'GET', url: `${WIXAPIS}/blog/v3/tags?paging.limit=${limit}` });
  return r.tags || [];
}

// --- blog posts ------------------------------------------------------------
// VERIFIED: POST /blog/v3/draft-posts then POST /blog/v3/draft-posts/{id}/publish.
// memberId is REQUIRED for 3rd-party app creates. Featured image goes in
// `heroImage.id` (a WixMedia GUID) — NOT `media.wixMedia.image.id`.
// VERIFIED (2026-06-10): tags attach via `tagIds` (array of tag GUIDs) on create — the
// builder must pass them or tags are created but never linked (postCount stays 0).
function buildCreateDraftPostRequest({ title, memberId, richContent, excerpt, slug, categoryIds, tagIds, firstPublishedDate, heroImageId }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/draft-posts`,
    body: {
      draftPost: {
        title,
        memberId, // REQUIRED
        richContent, // Ricos document
        excerpt: excerpt || undefined,
        slug,
        categoryIds: categoryIds || [],
        tagIds: tagIds && tagIds.length ? tagIds : undefined,
        firstPublishedDate: firstPublishedDate || undefined,
        heroImage: heroImageId ? { id: heroImageId } : undefined,
      },
    },
  };
}
async function createDraftPost(wix, payload) {
  return (await wix.send(buildCreateDraftPostRequest(payload))).draftPost;
}
async function publishDraftPost(wix, draftPostId) {
  return wix.send({ method: 'POST', url: `${WIXAPIS}/blog/v3/draft-posts/${draftPostId}/publish`, body: {} });
}

// --- CMS items (Wix Data) --------------------------------------------------
// VERIFIED: POST /wix-data/v2/items with { dataCollectionId, dataItem: { data } }.
// Requires Wix Data enabled on the site (WDE0110 otherwise — see rp-execute-setup).
// `data` is project-specific (the generated writer supplies the field map).
function buildInsertItemRequest(collectionId, data) {
  return { method: 'POST', url: `${WIXAPIS}/wix-data/v2/items`, body: { dataCollectionId: collectionId, dataItem: { data } } };
}
async function insertDataItem(wix, collectionId, data) {
  return (await wix.send(buildInsertItemRequest(collectionId, data))).dataItem;
}
// VERIFIED: POST /wix-data/v2/items/query with { dataCollectionId, query }. Paginates via
// query.paging {limit,offset}; returns dataItems[] (we return their `.data`). Required for
// durable cross-run resume: seed the ImportCrosswalk back so a re-run skips done records
// (FR-010). Needs Wix Data enabled (rp-execute-setup installs app e593b0bd-…).
async function queryAllDataItems(wix, collectionId, { pageSize = 100 } = {}) {
  const out = [];
  let offset = 0;
  for (;;) {
    const r = await wix.send({ method: 'POST', url: `${WIXAPIS}/wix-data/v2/items/query`,
      body: { dataCollectionId: collectionId, query: { paging: { limit: pageSize, offset } } } });
    const items = (r.dataItems || []).map((d) => d.data);
    out.push(...items);
    if (items.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

// --- Stores catalog --------------------------------------------------------
// UNVERIFIED: docs-schema exposes wix.stores.catalog.v3.product with create/query common
// methods. Public REST examples and prior project artifacts point at /stores/v3/products.
// Promote to VERIFIED only after a sandbox create/query succeeds with the exact shape.
function buildCreateStoresProductRequest(product) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v3/products`, body: { product } };
}
async function createStoresProduct(wix, product) {
  if (isStoresCatalogV1Forced()) {
    console.warn('[unverified-native] Stores product Catalog V1 fallback via /stores/v1/products (FR-013)');
    return (await wix.send(buildCreateStoresProductV1Request(product))).product;
  }
  try {
    return (await wix.send(buildCreateStoresProductRequest(product))).product;
  } catch (error) {
    if (!isCatalogV1Error(error)) throw error;
    console.warn('[unverified-native] Stores product Catalog V1 fallback via /stores/v1/products (FR-013)');
    await notifyMissingWriter({
      sourceEntity: 'product',
      wixEntity: 'wix.stores.catalog.v1.product',
      method: 'POST',
      path: '/stores/v1/products',
      reason: 'Destination site is Stores Catalog V1; using temporary FR-013 native fallback until fresh Stores installs are always Catalog V3.',
    });
    return (await wix.send(buildCreateStoresProductV1Request(product))).product;
  }
}
function buildQueryStoresProductsRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v3/products/query`, body: { query } };
}
async function queryStoresProducts(wix, query) {
  if (isStoresCatalogV1Forced()) {
    console.warn('[unverified-native] Stores product Catalog V1 fallback via /stores/v1/products/query (FR-013)');
    return (await wix.send(buildQueryStoresProductsV1Request(query))).products || [];
  }
  try {
    return (await wix.send(buildQueryStoresProductsRequest(query))).products || [];
  } catch (error) {
    if (!isCatalogV1Error(error)) throw error;
    console.warn('[unverified-native] Stores product Catalog V1 fallback via /stores/v1/products/query (FR-013)');
    await notifyMissingWriter({
      sourceEntity: 'product',
      wixEntity: 'wix.stores.catalog.v1.product',
      method: 'POST',
      path: '/stores/v1/products/query',
      reason: 'Destination site is Stores Catalog V1; using temporary FR-013 native fallback until fresh Stores installs are always Catalog V3.',
    });
    return (await wix.send(buildQueryStoresProductsV1Request(query))).products || [];
  }
}

// TEMPORARY FR-013 FALLBACK — REMOVE AS A WHOLE WHEN FR-013 IS RESOLVED.
// Some fresh Wix Stores installs currently produce Catalog V1 even though RePlatform
// product imports target the native Stores product entity and prefer Catalog V3. Until
// Wix Stores guarantees fresh installs are Catalog V3, keep a native V1 REST fallback
// instead of routing products to CMS. This block is intentionally isolated.
// UNVERIFIED: docs-schema lookup found wix.stores.catalog.v1.product; the gateway failed
// before returning full action schemas in this run. Promote only after sandbox create/query.
function isCatalogV1Error(error) {
  return /CATALOG_V1|wrong catalog version/i.test(String(error && error.message));
}
function isStoresCatalogV1Forced() {
  return /^(1|true|yes|v1|catalog_v1)$/i.test(process.env.WIX_STORES_CATALOG_VERSION || '');
}
function buildCreateStoresProductV1Request(product) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v1/products`, body: { product: normalizeStoresProductV1(product) } };
}
function buildQueryStoresProductsV1Request(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v1/products/query`, body: { query } };
}
function normalizeStoresProductV1(product) {
  const price = product.priceData?.price;
  const salePrice = product.priceData?.salePrice;
  return {
    name: product.name,
    slug: product.slug,
    visible: product.visible,
    productType: product.productType ? String(product.productType).toLowerCase() : undefined,
    description: product.description,
    sku: product.sku,
    priceData: {
      price: price == null || price === '' ? undefined : Number(price),
      salePrice: salePrice == null || salePrice === '' ? undefined : Number(salePrice),
    },
    inventory: product.inventory,
    collectionIds: product.collectionIds || product.categoryIds,
  };
}

// UNVERIFIED: category support is destination/site dependent for this migration. Prior
// artifacts used /categories/v1/categories. Keep this generic and promote only after a
// live call confirms product-category semantics for Stores.
function buildCreateStoresCategoryRequest(category) {
  return { method: 'POST', url: `${WIXAPIS}/categories/v1/categories`, body: { category } };
}
async function createStoresCategory(wix, category) {
  if (isStoresCatalogV1Forced()) {
    console.warn('[unverified-native] Stores category Catalog V1 fallback via /stores/v1/collections (FR-013)');
    return (await wix.send(buildCreateStoresCollectionV1Request(category))).collection;
  }
  try {
    return (await wix.send(buildCreateStoresCategoryRequest(category))).category;
  } catch (error) {
    if (!isCatalogV1CategoryError(error)) throw error;
    console.warn('[unverified-native] Stores category Catalog V1 fallback via /stores/v1/collections (FR-013)');
    await notifyMissingWriter({
      sourceEntity: 'product_category',
      wixEntity: 'wix.stores.catalog.v1.collection',
      method: 'POST',
      path: '/stores/v1/collections',
      reason: 'Destination site uses Stores Catalog V1; using collections as the native product-category fallback until fresh Stores installs are always Catalog V3.',
    });
    return (await wix.send(buildCreateStoresCollectionV1Request(category))).collection;
  }
}
function isCatalogV1CategoryError(error) {
  return /CATALOG_V1|wrong catalog version|treeReference must not be empty|App with ID not installed/i.test(String(error && error.message));
}
function buildCreateStoresCollectionV1Request(category) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/stores/v1/collections`,
    body: {
      collection: {
        name: category.name,
        slug: category.slug,
        visible: category.visible !== false,
        description: category.description || undefined,
      },
    },
  };
}

// --- Contacts --------------------------------------------------------------
// VERIFIED (2026-06-16): POST /contacts/v4/contacts with Contacts V4 wrapper fields
// (`emails.items`, `phones.items`, `addresses.items`) succeeded in a live sample import.
// Query path was read-probed successfully. Keep array normalization so older generated
// transforms fail less sharply while codegen catches up.
function normalizeContactListWrapper(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.length ? { items: value } : undefined;
  if (Array.isArray(value.items)) return value.items.length ? value : undefined;
  return value;
}
function normalizeContactInfo(info = {}) {
  return {
    ...info,
    emails: normalizeContactListWrapper(info.emails),
    phones: normalizeContactListWrapper(info.phones),
    addresses: normalizeContactListWrapper(info.addresses),
  };
}
function buildCreateContactRequest({ info, allowDuplicates = false, language }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v4/contacts`,
    body: {
      info: normalizeContactInfo(info),
      allowDuplicates,
      language: language || undefined,
    },
  };
}
async function createContact(wix, payload) {
  return (await wix.send(buildCreateContactRequest(payload))).contact;
}
function buildQueryContactsRequest(query = { paging: { limit: 100, offset: 0 } }) {
  return { method: 'POST', url: `${WIXAPIS}/contacts/v4/contacts/query`, body: { query } };
}
async function queryContacts(wix, query) {
  return (await wix.send(buildQueryContactsRequest(query))).contacts || [];
}

// --- Coupons ---------------------------------------------------------------
// UNVERIFIED: read-only probe showed /stores/v2/coupons/query reaches the Coupons service
// but returned app-not-installed/unauthorized on the target site. The specification must
// contain exactly one coupon type; generated code must decide per source coupon whether
// native Wix Coupons can represent the source coupon exactly. CMS is not a fallback for a
// missing writer; it is only for coupons whose semantics do not fit Wix Coupons.
function buildCreateCouponRequest(specification) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v2/coupons`, body: { specification } };
}
async function createCoupon(wix, specification) {
  return (await wix.send(buildCreateCouponRequest(specification))).coupon;
}
function buildQueryCouponsRequest(query = { paging: { limit: 100, offset: 0 } }) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v2/coupons/query`, body: { query } };
}
async function queryCoupons(wix, query) {
  return (await wix.send(buildQueryCouponsRequest(query))).coupons || [];
}

// --- eCom orders -----------------------------------------------------------
// UNVERIFIED: docs-schema exposes wix.ecom.v1.order create/query common methods. Creating
// native orders may trigger commerce side effects; generated migrations must use the
// native path only when setup verification proves it is safe and faithful. CMS archival is
// for that fidelity/side-effect decision, not for a missing writer.
function buildCreateOrderRequest(order) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/orders`, body: { order } };
}
async function createOrder(wix, order) {
  return (await wix.send(buildCreateOrderRequest(order))).order;
}
function buildQueryOrdersRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/orders/query`, body: { query } };
}
async function queryOrders(wix, query) {
  return (await wix.send(buildQueryOrdersRequest(query))).orders || [];
}

// --- members ---------------------------------------------------------------
// VERIFIED: GET /members/v1/members (reconcile), POST /members/v1/members (create).
// Dedup by loginEmail — gated PII; null email cannot dedup/create (use a fallback).
async function listMembers(wix, { limit = 50 } = {}) {
  return wix.send({ method: 'GET', url: `${WIXAPIS}/members/v1/members?paging.limit=${limit}` });
}
async function createMember(wix, { email, name, slug }) {
  if (!email) return { skipped: true, reason: 'no email — gated PII; authenticated source re-run required' };
  return (await wix.send({
    method: 'POST',
    url: `${WIXAPIS}/members/v1/members`,
    body: { member: { loginEmail: email, contact: { firstName: name }, profile: { nickname: name, slug } } },
  })).member;
}

module.exports = {
  WIXAPIS,
  RICOS_PLUGINS,
  RICOS_HTML_CAP,
  createWixClient,
  buildDirectRestRequest,
  sendDirectRest,
  notifyMissingWriter,
  buildConvertToRicosRequest,
  splitHtmlIntoChunks,
  convertHtmlToRichContent,
  rewriteInlineMedia,
  buildImportMediaRequest,
  importMedia,
  waitUntilFileReady,
  buildCreateCategoryRequest,
  createBlogCategory,
  buildCreateTagRequest,
  createBlogTag,
  listBlogTags,
  buildCreateDraftPostRequest,
  createDraftPost,
  publishDraftPost,
  buildInsertItemRequest,
  insertDataItem,
  queryAllDataItems,
  buildCreateStoresProductRequest,
  createStoresProduct,
  buildQueryStoresProductsRequest,
  queryStoresProducts,
  buildCreateStoresProductV1Request,
  buildQueryStoresProductsV1Request,
  buildCreateStoresCategoryRequest,
  createStoresCategory,
  buildCreateStoresCollectionV1Request,
  buildCreateContactRequest,
  createContact,
  buildQueryContactsRequest,
  queryContacts,
  buildCreateCouponRequest,
  createCoupon,
  buildQueryCouponsRequest,
  queryCoupons,
  buildCreateOrderRequest,
  createOrder,
  buildQueryOrdersRequest,
  queryOrders,
  listMembers,
  createMember,
};
