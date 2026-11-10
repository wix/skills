---
name: "Black Friday Readiness Checks"
description: "Data source, verified request shape and pass rule for each of the 28 checks in the Black Friday Readiness Review, with the two JavaScript probe functions it runs: a read-only probe over catalog, inventory, categories, coupons, discount rules, shipping, checkout policies, marketing tags, automations, email campaigns, gift card product, cookie banner, site properties, pages, orders and the live homepage, and a test-cart function that prices temporary carts per region and coupon and deletes them. Also the browser pass over the live site and its fallback checklist. Loaded by the review recipe, not an entry point on its own."
---

# Black Friday Readiness: Checks

Every endpoint and field below was verified against a live Wix Stores (Catalog V3) site. Use them as written. For anything not here, confirm the method in the Wix REST docs first.

All calls are site-scoped (the site's `siteId` on the call that runs the function) except the homepage fetch, which is `scope: "account"` against the public site URL: that one request is signed with the account's credentials rather than the site's, so a reader making the calls one by one uses an account-level token for it and the site token for everything else.

## Probe 1 — read everything (no mutations)

Run once. Each probe is independent; a failure is returned as `{ ok: false, error }` for that probe only. Replace the three placeholders from the site context.

```javascript
async function() {
  const SITE_URL = "<site URL from the site context>";
  const SITE_CREATED = "<site created date from the site context, ISO>";
  const probe = async (name, opts) => {
    try { const r = await wix.request(opts); return [name, { ok: true, data: r.data }]; }
    catch (e) { return [name, { ok: false, error: String(e && e.message || e).slice(0, 300) }]; }
  };
  const safe = async (name, fn) => { try { return [name, { ok: true, data: await fn() }]; } catch (e) { return [name, { ok: false, error: String(e && e.message || e).slice(0, 300) }]; } };
  const now = new Date();
  const iso = (d) => d.toISOString();
  const d30 = new Date(now.getTime() - 30 * 864e5);
  const lastYear = now.getUTCFullYear() - 1;
  const bfcmStart = new Date(Date.UTC(lastYear, 10, 20));   // Nov 20 last year
  const bfcmEnd = new Date(Date.UTC(lastYear, 11, 3));      // Dec 3 last year
  const storeExistedLastBfcm = new Date(SITE_CREATED) < bfcmStart;

  const ORDERS = "https://www.wixapis.com/ecom/v1/orders/search";
  const searchOrders = async (from, to) => {
    const items = []; let cursor;
    for (let i = 0; i < 20; i++) {
      const body = cursor
        ? { search: { cursorPaging: { limit: 100, cursor } } }
        : { search: { filter: { $and: [{ purchasedDate: { $gte: iso(from) } }, { purchasedDate: { $lt: iso(to) } }] }, cursorPaging: { limit: 100 } } };
      const r = await wix.request({ method: "POST", url: ORDERS, body });
      items.push(...(r.data.orders || []));
      cursor = r.data.metadata && r.data.metadata.hasNext ? r.data.metadata.cursors.next : null;
      if (!cursor) break;
    }
    return items;
  };
  const listCampaigns = async () => {
    const items = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await wix.request({ method: "GET", url: `https://www.wixapis.com/email-marketing/v1/campaigns?paging.limit=100&paging.offset=${offset}` });
      const page = r.data.campaigns || [];
      items.push(...page);
      if (page.length < 100) break;
    }
    return items;
  };
  const PRODUCT_FIELDS = ["PLAIN_DESCRIPTION", "URL", "MERCHANT_DATA", "DIRECT_CATEGORIES_INFO"];
  const listProducts = async () => {
    const items = []; let cursor;
    for (let i = 0; i < 50; i++) {
      const r = await wix.request({ method: "POST", url: "https://www.wixapis.com/stores/v3/products/query",
        body: { fields: PRODUCT_FIELDS, query: { cursorPaging: cursor ? { limit: 100, cursor } : { limit: 100 } } } });
      items.push(...r.data.products);
      cursor = r.data.pagingMetadata.hasNext ? r.data.pagingMetadata.cursors.next : null;
      if (!cursor) break;
    }
    return items;
  };

  const results = Object.fromEntries(await Promise.all([
    safe("products", listProducts),
    probe("inventory", { method: "POST", url: "https://www.wixapis.com/stores/v3/inventory-items/query", body: { query: { cursorPaging: { limit: 1000 } } } }),
    probe("categories", { method: "POST", url: "https://www.wixapis.com/categories/v1/categories/query",
      body: { treeReference: { appNamespace: "@wix/stores" }, returnNonVisibleCategories: true, query: { cursorPaging: { limit: 1000 } } } }),
    probe("coupons", { method: "POST", url: "https://www.wixapis.com/stores/v2/coupons/query", body: { query: { paging: { limit: 100 } } } }),
    probe("discountRules", { method: "POST", url: "https://www.wixapis.com/ecom/v1/discount-rules/query", body: { query: { cursorPaging: { limit: 100 } } } }),
    probe("shippingOptions", { method: "POST", url: "https://www.wixapis.com/ecom/v1/shipping-options/query", body: { query: { cursorPaging: { limit: 100 } } } }),
    probe("deliveryProfiles", { method: "POST", url: "https://www.wixapis.com/ecom/v1/delivery-profiles/query", body: {} }),
    probe("checkoutSettings", { method: "GET", url: "https://www.wixapis.com/ecom/v1/checkout-settings" }),
    probe("marketingTags", { method: "GET", url: "https://www.wixapis.com/marketing/v1/tags" }),
    probe("automations", { method: "POST", url: "https://www.wixapis.com/automations-service/v2/automations/query", body: { query: { cursorPaging: { limit: 100 } } } }),
    safe("campaigns", listCampaigns),
    probe("giftCardProducts", { method: "POST", url: "https://www.wixapis.com/gift-cards/v1/gift-card-products/query", body: { query: { cursorPaging: { limit: 10 } } } }),
    probe("cookieBanner", { method: "GET", url: "https://www.wixapis.com/wixpress/cookie-banner-settings/v1/cookie-banner-settings" }),
    probe("siteProps", { method: "GET", url: "https://www.wixapis.com/site-properties/v4/properties" }),
    probe("staticPages", { method: "POST", url: "https://www.wixapis.com/ricos/v1/site-context/static-pages/list", body: {} }),
    probe("homepage", { scope: "account", method: "GET", url: SITE_URL }),
    safe("orders30d", () => searchOrders(d30, now)),
    storeExistedLastBfcm ? safe("ordersLastBfcm", () => searchOrders(bfcmStart, bfcmEnd))
                         : Promise.resolve(["ordersLastBfcm", { ok: true, skipped: "store created after last Black Friday", data: [] }]),
  ]));

  // Two more public pages for the no-browser fallback: the sale category page and one discounted product page.
  // Their URLs are taken from the homepage's own links (a headless site's routes differ from the catalog's url field); the catalog URL is the fallback.
  const homeHtml = results.homepage.ok ? String(results.homepage.data) : "";
  const hrefs = [...homeHtml.matchAll(/href="([^"#?]+)/g)].map(m => m[1]);
  const hrefFor = (slug) => { if (!slug) return null; const h = hrefs.find(x => x.endsWith(`/${slug}`) || x.includes(`/${slug}/`)); return h ? new URL(h, SITE_URL).href : null; };
  const pageText = async (url) => { try { const r = await wix.request({ scope: "account", method: "GET", url }); return { ok: true, url, html: String(r.data) }; } catch (e) { return { ok: false, url, error: String(e.message || e).slice(0, 200) }; } };
  const saleCategory = results.categories.ok ? results.categories.data.categories.find(c => /sale|black friday|cyber|holiday|deal|gift/i.test(c.name)) : null;
  const discounted = results.products.ok ? results.products.data.find(p => p.compareAtPriceRange) : null;
  const saleCategoryUrl = saleCategory ? hrefFor(saleCategory.slug) : null;
  const discountedUrl = discounted ? (hrefFor(discounted.slug) || (discounted.url && discounted.url.url)) : null;
  const extraPages = await Promise.all([
    saleCategoryUrl ? pageText(saleCategoryUrl) : Promise.resolve(null),
    discountedUrl ? pageText(discountedUrl) : Promise.resolve(null),
  ]);

  // Compact the big ones so the result stays readable. Keep raw for the rest.
  const strip = (html) => String(html || "").replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const out = {};
  if (results.products.ok) {
    out.products = results.products.data.map(p => ({
      id: p.id, name: p.name, nameChars: p.name.length, slug: p.slug, visible: p.visible, type: p.productType,
      hasImage: !!(p.media && p.media.main), price: Number(p.actualPriceRange && p.actualPriceRange.minValue && p.actualPriceRange.minValue.amount),
      compareAt: p.compareAtPriceRange ? Number(p.compareAtPriceRange.minValue.amount) : null,
      descriptionChars: strip(p.plainDescription).length, brand: p.brand && p.brand.name || null,
      cost: p.costRange ? Number(p.costRange.minValue.amount) : null,
      ribbon: p.ribbon && p.ribbon.name, availability: p.inventory && p.inventory.availabilityStatus,
      variants: p.variantSummary && p.variantSummary.variantCount, url: p.url && p.url.url, categoryIds: p.directCategoriesInfo && p.directCategoriesInfo.categories ? p.directCategoriesInfo.categories.map(c => c.id) : [] }));
  } else out.products = results.products;
  if (results.inventory.ok) {
    out.inventory = results.inventory.data.inventoryItems.map(i => ({ productId: i.productId, variantId: i.variantId, name: i.product && i.product.name,
      variant: i.product && i.product.variantName, tracked: i.trackQuantity, quantity: i.quantity, inStock: i.inStock, status: i.availabilityStatus, categoryIds: i.product && i.product.directCategoryIds || [] }));
  } else out.inventory = results.inventory;
  if (results.categories.ok) {
    out.categories = results.categories.data.categories.map(c => ({ id: c.id, name: c.name, slug: c.slug, visible: c.visible, items: c.itemCounter, parent: c.parentCategory && c.parentCategory.id }));
  } else out.categories = results.categories;
  if (results.homepage.ok) {
    const html = String(results.homepage.data);
    const text = strip(html);
    const linked = (list, key) => (Array.isArray(list) ? list : []).filter(x => x[key] && (hrefFor(x.slug) || (typeof x[key] === "string" && x[key].startsWith("http") && html.includes(new URL(x[key]).pathname))));
    out.homepage = {
      clientRendered: text.length < 300,   // a JS shell with nothing readable server-side
      textStart: text.slice(0, 1500),
      saleMentions: (text.match(/black friday|cyber monday|bfcm|sale|% off|\bdeal/gi) || []).slice(0, 20),
      datesMentioned: (text.match(/\b(nov(ember)?|dec(ember)?)\.?\s+\d{1,2}(\s*[–-]\s*\d{1,2})?|\b\d{1,2}\s*[–-]\s*\d{1,2}\s+(nov|dec)[a-z]*/gi) || []).slice(0, 10),
      hasCountdown: /countdown|timer|ends in/i.test(html),
      linkedProducts: linked(out.products, "url").map(p => ({ id: p.id, name: p.name, availability: p.availability })),
      linkedCategorySlugs: linked(out.categories, "slug").map(c => c.slug),
      footerPolicyLinks: [...new Set((html.match(/href="[^"]*(polic|return|refund|shipping|terms|privacy|faq)[^"]*"/gi) || []))].slice(0, 20),
    };
  } else out.homepage = results.homepage;
  out.pages = {
    saleCategory: saleCategory ? { name: saleCategory.name, url: extraPages[0] && extraPages[0].url, ok: !!(extraPages[0] && extraPages[0].ok), textStart: extraPages[0] && extraPages[0].ok ? strip(extraPages[0].html).slice(0, 400) : null } : null,
    discountedProduct: discounted ? { name: discounted.name, url: discountedUrl, ok: !!(extraPages[1] && extraPages[1].ok),
      showsBothPrices: !!(extraPages[1] && extraPages[1].ok && new RegExp(String(discounted.compareAtPriceRange.minValue.amount).replace(".", "\\.")).test(strip(extraPages[1].html)) && new RegExp(String(discounted.actualPriceRange.minValue.amount).replace(".", "\\.")).test(strip(extraPages[1].html))) } : null,
  };
  const ordersSummary = (list) => {
    const perProduct = {}; let count = 0; let revenue = 0;
    for (const o of list) { if (o.status === "CANCELED") continue; count++;
      revenue += Number(o.priceSummary && o.priceSummary.total && o.priceSummary.total.amount || 0);
      for (const li of (o.lineItems || [])) { const k = (li.catalogReference && li.catalogReference.catalogItemId) || (li.productName && li.productName.original) || "?";
        perProduct[k] = (perProduct[k] || 0) + (li.quantity || 0); } }
    return { orders: count, revenue, aov: count ? revenue / count : null, unitsPerProduct: perProduct };
  };
  out.orders30d = results.orders30d.ok ? ordersSummary(results.orders30d.data) : results.orders30d;
  out.ordersLastBfcm = results.ordersLastBfcm.ok ? { ...ordersSummary(results.ordersLastBfcm.data), skipped: results.ordersLastBfcm.skipped } : results.ordersLastBfcm;
  if (results.automations.ok) {
    out.automations = results.automations.data.automations.map(a => ({ id: a.id, name: a.name, status: a.configuration && a.configuration.status,
      trigger: a.configuration && a.configuration.trigger && a.configuration.trigger.triggerKey }));
  } else out.automations = results.automations;
  if (results.campaigns.ok) {
    out.campaigns = results.campaigns.data.map(c => ({ id: c.campaignId, title: c.title, visibility: c.visibilityStatus, distribution: c.distributionStatus,
      published: c.publishingData && c.publishingData.datePublished, updated: c.dateUpdated }));
  } else out.campaigns = results.campaigns;
  out.giftCardProducts = results.giftCardProducts.ok ? (results.giftCardProducts.data.giftCardProducts || []).map(g => ({ id: g.id, name: g.name })) : results.giftCardProducts;
  for (const k of ["coupons", "discountRules", "shippingOptions", "deliveryProfiles", "checkoutSettings", "marketingTags", "cookieBanner", "siteProps", "staticPages"]) out[k] = results[k];
  // Lists read in one page: flag when the page may be full so the pass rules degrade ✅ to ❔ instead of trusting partial data.
  const count = (k, f) => results[k] && results[k].ok && Array.isArray(results[k].data[f]) ? results[k].data[f].length : 0;
  out.truncated = { inventory: count("inventory", "inventoryItems") >= 1000, coupons: count("coupons", "coupons") >= 100,
    discountRules: count("discountRules", "discountRules") >= 100, shippingOptions: count("shippingOptions", "shippingOptions") >= 100 };
  return out;
}
```

### What each probe returns (verified fields)

| Probe | Endpoint | Fields used |
|---|---|---|
| products | `POST /stores/v3/products/query` with `fields: ["PLAIN_DESCRIPTION","URL","MERCHANT_DATA","DIRECT_CATEGORIES_INFO"]` | `id`, `name`, `slug`, `visible`, `productType`, `media.main`, `actualPriceRange.minValue.amount` (string), `compareAtPriceRange` (absent when none), `plainDescription` (HTML), `brand.name` (absent when none), `costRange.minValue.amount` (`"0"` when no cost entered), `ribbon.name`, `inventory.availabilityStatus`, `variantSummary.variantCount`, `url.url`, `directCategoriesInfo.categories[].id` (only with `DIRECT_CATEGORIES_INFO`; inventory items also carry `product.directCategoryIds`). 100 per page, `pagingMetadata.hasNext` / `cursors.next`; keep `fields` on every page. |
| inventory | `POST /stores/v3/inventory-items/query`, `limit` up to 1000 | one item per variant: `productId`, `variantId`, `trackQuantity`, `quantity` (tracked only), `inStock` (untracked only), `availabilityStatus`, `product.name`, `product.variantName`, `product.directCategoryIds`. Next page while `pagingMetadata.cursors.next` exists. |
| categories | `POST /categories/v1/categories/query` with `treeReference.appNamespace: "@wix/stores"`, `returnNonVisibleCategories: true` | `categories[].{id, name, slug, visible, itemCounter, parentCategory.id}`. Catalog V3 only. |
| coupons | `POST /stores/v2/coupons/query`, `query.paging.limit` 100 | `coupons[].specification.{name, code, active, startTime, expirationTime (epoch ms), usageLimit, limitPerCustomer, minimumSubtotal, scope, percentOffRate | moneyOffAmount | freeShipping | fixedPriceAmount | buyXGetY}`, `numberOfUsages`, `expired`. `totalResults` only when empty. |
| discountRules | `POST /ecom/v1/discount-rules/query` | `discountRules[].{id, revision, name, active, activeTimeInfo.{start,end} (ISO), discounts.values[].{discountType, percentage | fixedAmount, targetType, specificItemsInfo.scopes[].{type, catalogItemFilter}}}`. A scope with `catalogItemFilter.catalogAppId` and no product ids targets the whole catalog. |
| shippingOptions | `POST /ecom/v1/shipping-options/query` | `shippingOptions[].{title, deliveryRegionIds, estimatedDeliveryTime, rates[].{amount, conditions[], multiplyByQuantity}}`. A `rates[].conditions` entry with a subtotal bound is the free-shipping threshold. |
| deliveryProfiles | `POST /ecom/v1/delivery-profiles/query` body `{}` | `deliveryProfiles[].deliveryRegions[].{id, name, active, destinations[].countryCode}`. A region with `destinations: []` is "rest of world". |
| checkoutSettings | `GET /ecom/v1/checkout-settings` | `checkoutSettings.checkoutPolicies.{termsAndConditions, privacyPolicy, returnPolicy, digitalItemPolicy, contactUs, customPolicy}.{visible, content}` (customPolicy also `title`); `checkoutFields.policyAgreementCheckbox.visible` |
| marketingTags | `GET /marketing/v1/tags` | `tags[]`, each with `enabled` and one tag object (`googleAnalytics`, `facebookPixel`, `googleTagManager`, `googleAds`, `tikTokPixel`, `yandexMetrica`) holding `trackingId`. Empty `tags: []` = nothing connected. |
| automations | `POST /automations-service/v2/automations/query` | `automations[].{id, name, origin, configuration.status ("ACTIVE" / "INACTIVE"), configuration.trigger.triggerKey}` |
| campaigns | `GET /email-marketing/v1/campaigns?paging.limit=100&paging.offset=N` | `campaigns[].{campaignId, title, visibilityStatus (DRAFT / PUBLISHED / TEMPLATE), distributionStatus (SCHEDULED, DISTRIBUTED, SENDING, NOT_STARTED, PAUSED, …), publishingData.datePublished, dateUpdated}`. No date filter, no `hasNext`: page by offset until a page has fewer than 100. |
| giftCardProducts | `POST /gift-cards/v1/gift-card-products/query` | `giftCardProducts[].{id, name, presetVariants, customVariant}`. Empty = the store sells no gift card (a site holds at most one). |
| cookieBanner | `GET /wixpress/cookie-banner-settings/v1/cookie-banner-settings` | `settings.enabled`. A `400 "No application found for the requested site"` means the cookie-banner app is not installed: treat as **banner off**, not as ❔. |
| siteProps | `GET /site-properties/v4/properties` | `properties.timeZone`, `properties.paymentCurrency`, `properties.locale.country` |
| staticPages | `POST /ricos/v1/site-context/static-pages/list` body `{}` | `items[].{title, url}`. Returns the home page and unmanaged pages; policy pages built in the editor appear here, app pages don't. Ignore its top-level `published` flag (it reads `false` on published headless sites). |
| pages | `GET <sale category URL>` and `GET <discounted product URL>` at `scope: "account"` | `pages.saleCategory.{url, ok, textStart}`, `pages.discountedProduct.{url, ok, showsBothPrices}` (both the compare-at and the sale amount appear in the page text). URLs are resolved from the homepage's own `href`s by slug, because a headless site's routes differ from the catalog's `url` field (which 404s there); the catalog URL is the fallback. These URLs are what the fallback checklist links; `ok: false` → link the homepage instead and say "find <name> from the shop page". |
| homepage | `GET <site URL>` at `scope: "account"` (the call that runs the function must carry this site's `siteId`; only the account's own published sites can be fetched, a `403 … is not a site of this account` means the wrong site id or an unpublished site) | raw HTML, scripts and styles stripped before reading. Editor sites and most headless sites carry their text, nav and links server-side; `linkedProducts` and `linkedCategorySlugs` match each product's and category's own URL path, so they work on both. Under 300 characters of real text is a JS shell: `clientRendered: true`. |
| orders | `POST /ecom/v1/orders/search` on `purchasedDate`, page by `metadata.cursors.next` | `orders[].{status, priceSummary.total.amount, lineItems[].{catalogReference.catalogItemId, productName.original, quantity}}`. Exclude `status: "CANCELED"`. (`priceSummary.total` is per the Orders docs; the test store had no orders to exercise it.) |
| paymentMethodTypes (optional) | `GET /payments/site-payment-method-types/v1/site-payment-method-types?countryCode=<cc>&currencyCode=<cur>` | `sitePaymentMethodTypes[].{legacyId (creditCard, payPal, applePay, googlePay, klarna, …), displayName}`. Lists what is **available in the country**, not what the store has turned on. Use only to word check 3's checklist item. |

## Probe 2 — test carts (creates and deletes temporary carts)

Run after Probe 1, once, with `hasMutations: true`. Pick the product: the cheapest visible, in-stock, physical product with one variant (`variants === 1`); if every product has options, use `GET /stores/v3/products/{id}` and take `variantsInfo.variants[0].id` as `catalogReference.options.variantId`. Build one scenario per delivery region (one destination country from `destinations[].countryCode`; a region with `destinations: []` is "rest of world", so pick a country **no other region covers**, e.g. `DE` when the only other region is US) × both sides of any free-shipping threshold (quantity chosen so the subtotal lands above and below it) × each active coupon code. Carts are deleted in `finally`.

```javascript
async function() {
  const STORES_APP = "215238eb-22a5-4c36-9e7b-e7c08025e04e";
  const scenarios = [ // built from Probe 1; example:
    { label: "US · below threshold", productId: "<id>", quantity: 1, address: { country: "US", subdivision: "US-NY", city: "New York", postalCode: "10001", addressLine1: "1 Main St" } },
    { label: "US · above threshold", productId: "<id>", quantity: 3, address: { country: "US", subdivision: "US-NY", city: "New York", postalCode: "10001", addressLine1: "1 Main St" } },
    { label: "Rest of world (DE) · coupon BF25", productId: "<id>", quantity: 1, coupon: "BF25", address: { country: "DE", city: "Berlin", postalCode: "10115", addressLine1: "Hauptstr. 1" } },
  ];
  const results = [];
  for (const s of scenarios) {
    let cartId = null;
    try {
      const body = { catalogItems: [{ catalogReference: { catalogItemId: s.productId, appId: STORES_APP }, quantity: s.quantity }] };
      if (s.coupon) body.coupons = [{ code: s.coupon }];
      const created = await wix.request({ method: "POST", url: "https://www.wixapis.com/ecom/v2/carts", body });
      cartId = created.data.cart.id;
      await wix.request({ method: "PATCH", url: `https://www.wixapis.com/ecom/v2/carts/${cartId}`, body: { cart: { id: cartId, deliveryInfo: { address: s.address } } } });
      const calc = await wix.request({ method: "POST", url: `https://www.wixapis.com/ecom/v2/carts/${cartId}/calculate`, body: { refreshCart: true } });
      const sum = calc.data.summary;
      const line = calc.data.cart.lineItems[0];
      results.push({ label: s.label, ok: true,
        subtotal: sum.priceSummary.subtotal.amount, discount: sum.priceSummary.discount.amount, delivery: sum.priceSummary.delivery.amount,
        tax: sum.priceSummary.tax.amount, total: sum.priceSummary.total.amount,
        deliveryMethod: sum.deliverySummary && sum.deliverySummary.method && sum.deliverySummary.method.title && sum.deliverySummary.method.title.original,
        discounts: (sum.discounts || []).map(d => ({ name: d.name || d.couponCode || d.discountRuleName, amount: d.amount && d.amount.amount })),
        unitFull: line.pricing.breakdown.fullPrice.amount, unitSale: line.pricing.breakdown.salePrice.amount, availableQuantity: line.quantityInfo.availableQuantity,
        violations: (sum.violations || []).filter(v => v.code !== "MISSING_DELIVERY_METHOD").map(v => v.code) });
    } catch (e) {
      const msg = String(e && e.message || e);
      results.push({ label: s.label, ok: false, couponInvalid: /INVALID_COUPON_CODE/.test(msg), error: msg.slice(0, 300) });
    } finally {
      if (cartId) { try { await wix.request({ method: "DELETE", url: `https://www.wixapis.com/ecom/v2/carts/${cartId}` }); } catch (_) {} }
    }
  }
  return results;
}
```

Verified behavior: Create Cart with a coupon code that does not exist, is inactive, or has not started fails with `INVALID_COUPON_CODE` and creates no cart. Calculate returns `{ cart, summary }`; `summary.deliverySummary` holds the auto-selected method and its price for the address; `MISSING_DELIVERY_METHOD` is always present on a cart without an explicit selection and is noise; any other violation (no shipping to the region, item unavailable) is a finding. `priceSummary.discount.amount` may come back as `"0"` while the other amounts carry decimals: compare numerically.

## Probe 3 — look at the live site (browser pass)

Run after Probes 1 and 2 **whenever the agent has a tool that opens web pages and returns what they look like** (a browser tool, a screenshot tool, a page-reading tool with rendered text). An agent with only API access and no page-opening tool has none: skip to the fallback.

**Pages, in order.** All on the merchant's live site; URLs come from Probe 1.

| # | Page | URL | Look for |
|---|---|---|---|
| P1 | Homepage, desktop | `SITE_URL` | 4 the announcement bar: visible above the fold, its text and dates · 5 featured products: click or hover each, note name · 7 a countdown: its end time and what it counts to · 8 the menu: a link to the sale category · 10 footer: links to returns, shipping, terms, privacy · 12 the cookie banner appears on first visit (do not click it) |
| P2 | Homepage, phone width (≈ 390 px) when the tool can resize | `SITE_URL` | 4 bar still visible and readable · 8 the sale link is in the mobile menu · nothing overlaps the hero |
| P3 | Sale category page | `pages.saleCategory.url` | 8 it exists and lists products · 6 each product card shows the crossed-out original and the sale price · 5 out-of-stock badges |
| P4 | One discounted product page | `pages.discountedProduct.url` | 6 crossed-out original price beside the sale price · stock message · the add-to-cart button works |
| P5 | Cart, after adding that product | from P4 | 9 a shipping estimate or "calculated at checkout" · the coupon field exists · 1 totals readable |
| P6 | Checkout, stopped before payment | from P5 | 9 shipping options and prices for the pre-filled or default region · 10 policy links in the checkout footer · 12 the "I agree" checkbox when policies exist · the payment methods offered (3): cards, PayPal, Apple Pay / Google Pay, buy-now-pay-later |

**Rules.** Stop at the payment step: never enter card details, an email, a name, an address or any personal data; never submit a form; never log in; never accept or decline the cookie banner. The item added to the cart in P5 is removed afterwards when the tool allows; otherwise it is a visitor cart that expires on its own and nothing is ordered. Take a screenshot of each page when the tool can, and name it in the evidence ("homepage-mobile.png"). Spend at most one attempt per page; a page that does not load is ❔ for its checks, not a retry loop.

**What P1–P6 change in the grading.** A visual check seen in the browser is graded from what was seen, and the evidence line says so ("the bar reads 'Black Friday 30% off Nov 27–30', matches your discount"; "Oak Wick Trimmer shows $34 crossed out, $24 in red"). A visual check contradicted by the browser overrides the HTML probe (the bar's text is in the HTML but hidden behind a popup → ⚠️). Check 3 gains real evidence from P6: the payment methods shown at checkout.

**Fallback when there is no browser.** Say so in the report header. Then the checklist opens with the group **On your live site**, one checkbox per visual check the agent could not see, each with the exact URL and the thing to look at, on a phone and on a computer:

- [ ] Open <SITE_URL> on your phone and your computer: is the Black Friday bar visible without scrolling, does it say <dates from the sale window>? (4)
- [ ] On the homepage, tap every featured product: does each open and show it is in stock? (5)
- [ ] Open <pages.discountedProduct.url>: is <compare-at> crossed out next to <sale price>? (6; omit when `showsBothPrices` is true and say "the page text shows both prices; glance that the original is struck through")
- [ ] If you have a countdown, does it end at <discount end, store tz> and show "Sale ended" at zero, not negative numbers? (7)
- [ ] Is <sale category name> in your site menu, including the mobile menu? (8; omit when `linkedCategorySlugs` holds its slug and `visible` is true, say "it's linked; glance that it shows on mobile")
- [ ] Add one item to the cart, go to checkout, stop before paying: do shipping options and prices appear for your main region, are returns/terms/privacy linked at the bottom, and are Apple Pay / Google Pay / PayPal / pay-later shown? (1, 3, 9, 10)
- [ ] Open the site in a private window: does the cookie banner appear? (12; omit when the banner API said `enabled: true` and the store does not ship to the EU/UK)

HTML evidence from Probe 1 only trims this list (a check whose HTML signal is unambiguous gets the shorter "glance" wording); it never removes the group.

## Pass rules per check

Thresholds are defaults; the merchant can override them in chat.

Marks: ✅ passes. ⚠️ is a verified problem: it goes in **🔧 I can fix these** when the rule's *Offer* names an API change the agent can make, and in **📋 Your checklist** (✋) when only the merchant can act. A rule's ✋ line is always a checklist item. ❔ when the probe failed or the data is not exposed. ➖ not applicable. Convert every time to the store time zone (`siteProps.properties.timeZone`) before stating it; coupon times are epoch ms, rule times ISO.

**The sale window** (used by 4, 7, 11, 16, 19, 21) is the union of the windows of active coupons and discount rules that overlap the Black Friday week of the current year: US Thanksgiving (the fourth Thursday of November) through the following Tuesday; Black Friday is the Friday after it. No such window → "no dated sale found yet".

**Truncated lists.** When `truncated.<list>` is true, every check that reads that list (inventory: 5, 13, 15; coupons: 16, 17, 19, 20, 21; discountRules: 16, 18, 19, 21; shippingOptions: 9) reports ❔ "more than N items; I checked the first N" instead of ✅, and the fix offers stand only for items actually read.

### A. Checkout, payments & catalog

**1 Test cart prices** — ✅ when every Probe 2 scenario is `ok` with no violations and `total` = subtotal − discount + delivery + tax. ⚠️ (agent-fixable only when the cause is a shipping or discount setting; otherwise ✋) on any violation or arithmetic mismatch, quoting the scenario. ✋ always: "Place one real order on your live site and refund it; confirm the confirmation email arrives." When every scenario returns `tax` of `0` and the store ships to a taxed region (US, EU, UK, CA, AU): ✋ "Tax came to 0 on test carts; confirm your tax settings" → `ecom-platform/tax`. ➖ when no purchasable product.

**2 Product completeness** — over `visible: true` products: ⚠️ list those with `hasImage === false`, `price <= 0` or `NaN`, or `descriptionChars < 20`. ✅ when none. Offer: write the missing descriptions (merchant approves the text) → 🔧; images and prices → ✋.

**3 Payments and payment methods** — Browser: P6 shows which methods are offered at checkout; ✅ when cards plus PayPal, Apple Pay or Google Pay, and a pay-later option appear, ⚠️ → ✋ naming the missing ones. API: no public read exposes the provider's status or which methods are on, and a test cart never reaches payment. Always the first ✋ under "In your dashboard": "Confirm payments are connected and live (not test mode), and turn on Apple Pay, Google Pay, PayPal and a buy-now-pay-later option (Klarna/Afterpay) — 12% of shoppers abandon when their method is missing" → `wix-cashier/payments`. Optionally name which of those are available in the store's country from `paymentMethodTypes[].legacyId`. A store with no orders ever also gets this in the verdict: "confirm payments are connected before anything else".

### B. Sale merchandising (live homepage)

With a browser (Probe 3), checks 4–8 are graded from what was seen on P1–P4; the HTML signals below are the fallback and the tie-breaker. Without a browser: grade from the HTML signals where they are unambiguous, and every check in this section also appears in the **On your live site** checklist group with the "glance" wording. When `homepage.ok` is false or `clientRendered` is true and there is no browser, checks 4, 5, 7 and 8 are their full checklist lines and nothing is graded ✅; check 6 still runs from the catalog.

**4 Announcement bar** — Browser: ✅ when the bar is visible above the fold on desktop and phone with the sale's dates; ⚠️ → ✋ when hidden, missing, or the dates differ. HTML: ✅ only as "text present" when `saleMentions` is non-empty AND a date in `datesMentioned` falls inside the sale window, with the glance line in the checklist. ⚠️ → ✋ when the sale window exists but the page has no sale mention, or the dates differ ("your bar says Nov 25–30, your discount runs Nov 27–Dec 1"). ✋ also: "Confirm the bar is scheduled to come down on <end date> in the editor." ➖ when no dated sale.

**5 Hero product links in stock** — Browser: each featured product opened from P1 shows in stock. HTML: over `linkedProducts`: ⚠️ list any whose `availability` is `OUT_OF_STOCK` or whose tracked inventory sums to 0; swapping the featured product → ✋; restocking with quantities the merchant gives → 🔧. ✅ otherwise. ➖ when the page links no products.

**6 Crossed-out original price** — Browser: P3 and P4 show the original struck through beside the sale price. HTML: `pages.discountedProduct.showsBothPrices` true is "both prices present" (glance line stays). Catalog: candidates: products targeted by an active discount rule, with `ribbon` matching /sale|black friday|deal|holiday/i, or with `compareAt` set. ⚠️ → 🔧 when a candidate has no `compareAt`, or `compareAt <= price`: set compare-at prices on approval. ✅ otherwise.

**7 Countdown timer** — Browser: the timer on P1 counts to the discount end; ⚠️ → ✋ when it ends at another time or shows negatives. HTML: only if `hasCountdown`. ✋ "Your timer should end at <discount end, store tz>; preview it with a past date to see what shoppers see at zero." ➖ when no timer found.

**8 Sale category in the menu** — sale category = a category whose `name` matches /sale|black friday|cyber|holiday|deal|gift/i. Browser: ✅ when P1 and P2 show it in the menu (desktop and mobile) and P3 lists products. HTML: ✅ when one exists, is `visible`, has `items > 0` and its `slug` is in `linkedCategorySlugs` (glance line for mobile stays). Exists but not linked → ✋ "Add <name> to your site menu" (editor). Exists but hidden or empty → 🔧 show it / fill it from discounted products. None → 🔧 "create a Black Friday category from your discounted products" (S6), and ✋ to add it to the menu afterwards.

### C. Shipping

**9 Shipping per region** — Browser: P6 shows shipping options and prices for the default region; a checkout with no shipping option is ⚠️ regardless of what Probe 2 said. API: one Probe 2 scenario per active region; the subtotal threshold from `shippingOptions[].rates[].conditions`, one scenario each side. ✅ when every region returns a `deliveryMethod` and `delivery` flips to `0` only above the threshold. ⚠️ → 🔧 when a region has no method, a free-shipping rate applies below the threshold, or a region has no shipping option (Shipping dispatcher recipe). Separately ⚠️ → 🔧 when a shipping option has no `estimatedDeliveryTime`: "shoppers see no delivery estimate at checkout" → add it once the merchant gives transit times. Worldwide free shipping with no minimum → ✋ "confirm this is intended for your price range" → `ecom-platform/delivery-profile`.

### D. Policies & legal

**10 Shipping / returns / refund policy** — Browser: footer links seen on P1 and policy links seen on P6 count as the "linked" half. HTML/API: ✅ when `returnPolicy.visible && content.length > 50` AND (`footerPolicyLinks` has a return/shipping/refund link OR `staticPages` has a page titled like one). Checkout policy hidden or empty → 🔧 draft and enable it on approval. Footer link missing → ✋ "link your returns and shipping policy in the site footer"; on a `clientRendered` page that half is ✋ "confirm the footer links to your policies". ✋ always: "Read the wording; is it still current?"

**11 Sale terms** — ✅ when `customPolicy.visible` with content mentioning the sale, or a static page / footer link titled like "sale terms" / "promotion terms". ⚠️ → 🔧 when a dated sale exists and none is found: draft the terms from the real discounts (dates, excluded scopes, whether the coupon stacks with automatic rules, final-sale items) into `customPolicy`. ➖ when no dated sale (check 16's fix drafts them together).

**12 Terms, privacy, cookie banner** — Browser: the banner appearing on P1 (first visit) is the banner's evidence, and the "I agree" checkbox seen on P6 is the checkbox's. API: ✅ when `termsAndConditions.visible` and `privacyPolicy.visible` with non-empty content AND cookie banner `settings.enabled`. Missing policy text → 🔧 (Update Checkout Settings). Banner off or app missing → ✋ "install and switch on the cookie banner in your site settings"; it is a ✋ problem when the store ships to the EU/UK (a region covering an EU country or rest-of-world) or `locale.country` is in the EU, otherwise a plain ✋ confirmation. When both policies exist but `policyAgreementCheckbox.visible` is false → 🔧 "show the 'I agree to the terms' checkbox at checkout". ✋ always: "Confirm the legal wording is right for you (GDPR for EU shoppers, CCPA for US)."

### E. Stock

**13 Stock vs demand** — demand per product = max(units in `ordersLastBfcm`, 2 × units in `orders30d`). Candidates: products targeted by the sale discount, plus the top 5 by last-year units. ⚠️ → ✋ when tracked stock (sum of `quantity` over its inventory items) < demand: "<name>: N in stock, ~M expected — decide what to reorder". ✅ when none. ❔ when both order sets are empty or skipped ("no sales history yet to size demand; with N units of X in stock, decide yourself").

**14 Low-stock alerts** — not readable by API. ✋ "Check low-stock notifications are on in your store settings" → `wix-stores/settings`.

**15 Inventory tracking** — ⚠️ → 🔧 list physical products with any inventory item `tracked === false` ("sold as unlimited"): turn tracking on once the merchant gives quantities. ✅ when none.

**Costs** — when every product has `cost` of `0` or null, add one ✋ under "In your dashboard": "Enter product costs so I can check that discounts never price anything below cost" → `wix-stores/products`. Check 18's below-cost rule is then skipped and says so.

### F. Coupons & discounts

**16 Sale discount exists with right dates** — ✅ when at least one coupon or rule overlaps the Black Friday week with both start and end set. ⚠️ → 🔧 when none exists ("set up your Black Friday discount — tell me the offer and the dates", item 1); a coupon/rule has `active: false`; start is after Black Friday; no end ("runs forever"); or a coupon and a rule meant for the same sale have different windows.

**17 Coupons work on a cart** — one Probe 2 scenario per active coupon code. ✅ when `discounts` names the coupon and `discount` equals the expected amount (`percentOffRate` × subtotal, `moneyOffAmount`, or `delivery` `0` for `freeShipping`) and a cart below `minimumSubtotal` is rejected or undiscounted. ⚠️ → 🔧 on `couponInvalid` (not started, inactive, wrong code) or a wrong amount.

**18 Discounts don't conflict** — scenario with the active automatic rule plus each coupon. ⚠️ → 🔧 when `cost > 0` and the effective unit price after both discounts < cost ("drops below your cost of X"), or when the combined discount exceeds 50% without the merchant having said so. ✅ otherwise. ➖ when no automatic rule. Cost checks only where `cost > 0`.

**19 No stacking on already-discounted products** — already-discounted = products with `compareAt > price`. ⚠️ → 🔧 when an active sale rule targets the whole catalog (a scope with `catalogItemFilter` and no product ids) or a category containing them, or a sale coupon has `scope.namespace: "stores"` with no group, while already-discounted products exist: "N products already on sale (Oak Wick Trimmer $24 was $34) would get the extra X% — narrow the rule to exclude them, or set their compare-at as the sale price". ✅ when no overlap. ➖ when no sale rule or coupon.

**20 Coupon usage limits** — ⚠️ → 🔧 list active coupons with `usageLimit` or `limitPerCustomer` missing: set limits on approval (merchant picks the numbers; default suggestion per customer 1, total 3 × last year's order count). ✅ when all have both.

**21 Everything scheduled** — ✅ when every sale coupon and rule has both a start and an end (so nothing needs a manual switch), and at least one campaign has `distribution: "SCHEDULED"` or was `DISTRIBUTED` since Nov 1. ⚠️ → 🔧 for a sale coupon or rule with `active: false` or no start ("needs you to switch it on by hand on the day") and for no scheduled campaign ("your emails depend on you pressing send"). ✋ always when a dated sale exists: "Schedule the announcement bar and countdown in the editor to appear on <start> and disappear on <end>."

### G. Emails & tracking

**22 Transactional automations** — by trigger key: `domain_events_wix.ecom.v1.automation_trigger-order_confirmation_issued_to_buyer` (order confirmation), `domain_events_wix.ecom.v1.automation_trigger-shipping_confirmation_issued` (shipping confirmation), `wix_e_commerce-cart_abandonment` (abandoned cart). ✅ when each has at least one automation with `status: "ACTIVE"`. ⚠️ → 🔧 list the INACTIVE or missing ones: activate (activation-status recipe) or build (build-and-manage recipe). Send history is not public: ✋ "Place the test order and check your inbox for the confirmation."

**23 At least 4 BFCM emails** — count every campaign with `distribution: "SCHEDULED"` (a scheduled send is in the future by definition) plus campaigns with `distribution` in {DISTRIBUTED, SENDING} whose `published` is on or after Nov 1 of this year; never count by `updated`, it changes on every edit. ✅ when ≥ 4. ⚠️ → 🔧 when fewer: "you have N; stores with 4 or more saw +41% vs. the year before, 0 saw −20% — I'll draft the missing ones (tease, early access, launch, reminder, Cyber Monday) for your approval; scheduling needs your confirmed subject, audience and send time" (campaigns recipe). Link `email-marketing/my-campaigns`.

**24 Tracking pixels** — ✅ when `tags` has an `enabled` entry for Google Analytics (`googleAnalytics`) and for Meta (`facebookPixel`); TikTok (`tikTokPixel`) reported only if the merchant sells there. ⚠️ → 🔧 list the missing ones: connect once the merchant gives the tracking ID. ✋ "After your test order, confirm the purchase appears in GA / Meta."

### I. Google & AI search

**25 Google Merchant Center connected** — no public read (Search Console and Business Profile have connection APIs; Merchant Center does not). ✋ "Confirm your store is connected to Google Merchant Center — Google Shopping, Google's AI search and Google Ads all depend on it" → `wix-stores/channel/google`.

**26 Product data ready for Google and AI search** — over `visible: true` products: ⚠️ → 🔧 list those with `nameChars < 15` or `> 150`, `brand` null, or `descriptionChars < 50`, ranked by last-year units then price: "fix titles, brands and descriptions on approval". ✅ when none. A store with no brand anywhere gets one line, not one per product.

**27 Product feeds synced** — not readable by API. ✋ "Check the Google and Meta channels for rejected products and that sale prices show" → `wix-stores/channel/google`.

### H. Operations

**28 Volume** — one ✋ under "In your operations": "Expect roughly <N> orders over the sale (last year's Black Friday week: N orders; last 30 days: M orders) → size packaging, labels and carrier pickups for that." When `ordersLastBfcm.skipped` is set, say "your store is newer than last Black Friday" and use the 30-day figure only. ❔ only when both order probes failed.

### Suggestions that read data (Part 2)

- **S14 gift cards**: `giftCardProducts` empty → suggest creating one (gift-cards recipe); non-empty → suggest promoting it, link `ecom-platform/gift-cards`.
- **S15 free-shipping banner**: threshold = round up `orders30d.aov` × 1.2 to a clean number in the store currency; ➖ when no AOV.
- **S7 / S8 feature picks and gift guide**: from `ordersLastBfcm.unitsPerProduct` (fallback `orders30d`), skipping products with `compareAt` set (already discounted) and tracked stock under the 13-demand figure; tiers at the 33rd and 66th price percentiles of in-stock products.
- **S20 segments**: counts come from orders (repeat vs one-time buyers, last year's holiday buyers absent in the last 30 days) and from the Contacts search recipe for signed-up-never-bought; labels only on approval.
- **S12 convert coupon to automatic discount**: the discount-rule recipe, same window and scope as the coupon; deactivate the coupon only when the merchant says so.
