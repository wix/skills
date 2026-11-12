'use strict';

// Shopify bundles -> the canonical product.bundle (rp-target-wix/lib/wix-target-spec.js
// validateCanonicalBundle). This file only reads how Shopify stores a bundle; what Wix does with it
// is decided on the target side (stores/product-bundle, lib/stores-bundle-cutover.js).
//
// A Shopify bundle is a variant with `requiresComponents: true` whose `productVariantComponents`
// (read per bundle variant by lib/shopify-nested-reads.js) list the component variants and their
// quantities (Admin GraphQL ProductVariant / ProductVariantComponent, schema 2026-10). The bundle's
// price is the variant's own price and Shopify derives its availability from the components.
//
// Input: one folded products row. Output: { hasBundleFields, bundle, unreadableReason }.

function canonicalBundleFromShopifyProduct(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const bundles = variants.filter((variant) => variant && variant.requiresComponents === true);
  if (!bundles.length) return { hasBundleFields: false, bundle: null, unreadableReason: null };
  // One canonical bundle is one product. Several bundle variants can hold different parts each;
  // the operator takes those from the source rather than from a merged guess.
  if (bundles.length > 1) {
    return { hasBundleFields: true, bundle: null, unreadableReason: `${bundles.length} variants are bundles with their own parts` };
  }
  const components = bundles[0].productVariantComponents;
  if (!Array.isArray(components) || !components.length) {
    return { hasBundleFields: true, bundle: null, unreadableReason: 'the bundle variant\'s components were not read' };
  }
  const parts = [];
  for (const component of components) {
    const variantId = component?.productVariant?.id;
    const productId = component?.productVariant?.product?.id;
    if (typeof variantId !== 'string' || typeof productId !== 'string' || !Number.isInteger(component.quantity) || component.quantity < 1) {
      return { hasBundleFields: true, bundle: null, unreadableReason: 'a component has no variant, product or quantity' };
    }
    parts.push({ sourceProductId: productId, sourceVariantId: variantId, quantity: component.quantity, optional: false });
  }
  return {
    hasBundleFields: true,
    unreadableReason: null,
    bundle: { kind: 'fixed', components: parts, groups: [], priceRule: 'fixed', stockRule: 'from-components', detectedBy: 'shopify:bundle-variant' },
  };
}

module.exports = { canonicalBundleFromShopifyProduct };
