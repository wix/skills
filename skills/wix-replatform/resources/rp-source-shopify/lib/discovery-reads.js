'use strict';

// What discovery reads from a Shopify store: per entity one count (where the Admin API has one)
// and up to SAMPLE_LIMIT sample records, plus the shop singletons. Every operation is a named,
// read-only query so a call can be identified in logs and fixtures.
//
// Every count query passes `limit: null`: Shopify otherwise stops counting at 10,000 and answers
// `precision: AT_LEAST`. Discovery treats only `precision: EXACT` as a record count.
//
// Field selections are deliberately small: samples feed schema synthesis, not the import. A field
// the store's API version rejects comes back as a GraphQL error, which discovery records as a
// `capture-failed` coverage row for that entity -- never as an empty entity.

const SAMPLE_LIMIT = 3;

const DISCOUNT_FIELDS = 'title status startsAt endsAt';
const DISCOUNT_TYPES = [
  'DiscountCodeBasic', 'DiscountCodeBxgy', 'DiscountCodeFreeShipping',
  'DiscountAutomaticBasic', 'DiscountAutomaticBxgy', 'DiscountAutomaticFreeShipping',
];

const ENTITY_READS = Object.freeze([
  {
    entity: 'products',
    scopes: ['read_products'],
    count: 'query RpShopifyDiscoveryProductsCount { productsCount(limit: null) { count precision } }',
    countPath: ['productsCount'],
    sample: `query RpShopifyDiscoveryProducts($first: Int!) { products(first: $first) { nodes {
      id title handle status productType vendor tags createdAt updatedAt
      options { name values }
      variants(first: 3) { nodes { id title sku price compareAtPrice inventoryQuantity } }
    } } }`,
    samplePath: ['products'],
  },
  {
    entity: 'collections',
    scopes: ['read_products'],
    sample: `query RpShopifyDiscoveryCollections($first: Int!) { collections(first: $first) { nodes {
      id title handle updatedAt sortOrder ruleSet { appliedDisjunctively }
    } } }`,
    samplePath: ['collections'],
  },
  {
    entity: 'orders',
    scopes: ['read_orders', 'read_fulfillments'],
    count: 'query RpShopifyDiscoveryOrdersCount { ordersCount(limit: null) { count precision } }',
    countPath: ['ordersCount'],
    sample: `query RpShopifyDiscoveryOrders($first: Int!) { orders(first: $first) { nodes {
      id name createdAt processedAt cancelledAt currencyCode displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      refunds { id createdAt }
      fulfillments { id status createdAt }
    } } }`,
    samplePath: ['orders'],
  },
  {
    entity: 'customers',
    scopes: ['read_customers'],
    count: 'query RpShopifyDiscoveryCustomersCount { customersCount(limit: null) { count precision } }',
    countPath: ['customersCount'],
    sample: `query RpShopifyDiscoveryCustomers($first: Int!) { customers(first: $first) { nodes {
      id createdAt updatedAt tags numberOfOrders verifiedEmail
    } } }`,
    samplePath: ['customers'],
  },
  {
    entity: 'gift-cards',
    scopes: ['read_gift_cards'],
    count: 'query RpShopifyDiscoveryGiftCardsCount { giftCardsCount(limit: null) { count precision } }',
    countPath: ['giftCardsCount'],
    sample: `query RpShopifyDiscoveryGiftCards($first: Int!) { giftCards(first: $first) { nodes {
      id lastCharacters enabled createdAt expiresOn
      initialValue { amount currencyCode } balance { amount currencyCode }
    } } }`,
    samplePath: ['giftCards'],
  },
  {
    entity: 'discounts',
    scopes: ['read_discounts', 'read_price_rules'],
    sample: `query RpShopifyDiscoveryDiscounts($first: Int!) { discountNodes(first: $first) { nodes {
      id discount { __typename ${DISCOUNT_TYPES.map((type) => `... on ${type} { ${DISCOUNT_FIELDS} }`).join(' ')} }
    } } }`,
    samplePath: ['discountNodes'],
  },
  {
    entity: 'pages',
    scopes: ['read_content'],
    sample: 'query RpShopifyDiscoveryPages($first: Int!) { pages(first: $first) { nodes { id title handle isPublished createdAt updatedAt } } }',
    samplePath: ['pages'],
  },
  {
    entity: 'blogs',
    scopes: ['read_content'],
    sample: 'query RpShopifyDiscoveryBlogs($first: Int!) { blogs(first: $first) { nodes { id title handle createdAt updatedAt } } }',
    samplePath: ['blogs'],
  },
  {
    entity: 'articles',
    scopes: ['read_content'],
    sample: 'query RpShopifyDiscoveryArticles($first: Int!) { articles(first: $first) { nodes { id title handle tags publishedAt createdAt blog { id } } } }',
    samplePath: ['articles'],
  },
  {
    entity: 'menus',
    scopes: ['read_online_store_navigation'],
    sample: 'query RpShopifyDiscoveryMenus($first: Int!) { menus(first: $first) { nodes { id title handle items { title type url } } } }',
    samplePath: ['menus'],
  },
  {
    entity: 'locations',
    scopes: ['read_locations'],
    sample: 'query RpShopifyDiscoveryLocations($first: Int!) { locations(first: $first) { nodes { id name isActive address { city countryCode } } } }',
    samplePath: ['locations'],
  },
  {
    entity: 'inventory-items',
    scopes: ['read_inventory'],
    sample: 'query RpShopifyDiscoveryInventoryItems($first: Int!) { inventoryItems(first: $first) { nodes { id sku tracked createdAt updatedAt } } }',
    samplePath: ['inventoryItems'],
  },
  {
    entity: 'delivery-profiles',
    scopes: ['read_shipping'],
    sample: 'query RpShopifyDiscoveryDeliveryProfiles($first: Int!) { deliveryProfiles(first: $first) { nodes { id name default } } }',
    samplePath: ['deliveryProfiles'],
  },
  {
    // `metaobjects` needs a `type` argument, so discovery lists the definitions (each with its own
    // count); an extract reads each type's metaobjects from them.
    entity: 'metaobjects',
    scopes: ['read_metaobjects'],
    sample: 'query RpShopifyDiscoveryMetaobjectDefinitions($first: Int!) { metaobjectDefinitions(first: $first) { nodes { id type name metaobjectsCount } } }',
    samplePath: ['metaobjectDefinitions'],
  },
  {
    entity: 'files',
    scopes: ['read_files'],
    sample: 'query RpShopifyDiscoveryFiles($first: Int!) { files(first: $first) { nodes { __typename id alt createdAt fileStatus } } }',
    samplePath: ['files'],
  },
  {
    entity: 'url-redirects',
    scopes: ['read_online_store_navigation'],
    sample: 'query RpShopifyDiscoveryUrlRedirects($first: Int!) { urlRedirects(first: $first) { nodes { id path target } } }',
    samplePath: ['urlRedirects'],
  },
]);

const SINGLETON_READS = Object.freeze([
  {
    entity: 'shop',
    scopes: [],
    sample: 'query RpShopifyDiscoveryShop { shop { id name myshopifyDomain currencyCode ianaTimezone primaryDomain { host } } }',
    samplePath: ['shop'],
  },
  {
    // `shopPolicies` returns ShopPolicy objects, which require read_legal_policies.
    entity: 'shop-policies',
    scopes: ['read_legal_policies'],
    sample: 'query RpShopifyDiscoveryShopPolicies { shop { shopPolicies { type title url } } }',
    samplePath: ['shop', 'shopPolicies'],
  },
]);

const ALL_READS = Object.freeze([...ENTITY_READS, ...SINGLETON_READS]);

// The order-window step: the shop's creation time, and -- only for a store younger
// than the window -- the visible order with the earliest `processedAt`, which shows whether
// back-dated (imported) orders exist. Not entity captures: they never become capture rows.
const ORDER_WINDOW_READS = Object.freeze([
  {
    entity: 'shop-created-at',
    scopes: [],
    query: 'query RpShopifyDiscoveryShopCreatedAt { shop { id createdAt } }',
  },
  {
    entity: 'oldest-processed-order',
    scopes: ['read_orders'],
    query: 'query RpShopifyDiscoveryOldestProcessedOrder { orders(first: 1, sortKey: PROCESSED_AT) { nodes { id processedAt } } }',
  },
]);

function operationName(query) {
  const match = /\bquery\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(String(query || ''));
  return match ? match[1] : null;
}

function at(object, pathParts) {
  return pathParts.reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
}

module.exports = {
  SAMPLE_LIMIT,
  ENTITY_READS,
  SINGLETON_READS,
  ALL_READS,
  ORDER_WINDOW_READS,
  operationName,
  at,
};
