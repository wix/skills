'use strict';

// Source policy only. The target adapter owns how these canonical values are written.
function mapWooInventory(source = {}, { parent } = {}) {
  const gap = (reason) => ({ status: 'decision-needed', fields: {}, reason });
  if (source.backorders_allowed === true || source.backordered === true ||
      (source.backorders != null && source.backorders !== 'no') || source.stock_status === 'onbackorder') {
    return gap('backorder-policy');
  }
  if (source.manage_stock === 'parent' ||
      (parent && parent.manage_stock === true && source.manage_stock !== true)) {
    return gap('shared-parent-stock');
  }
  if (!['instock', 'outofstock'].includes(source.stock_status)) return gap('missing-or-unknown-stock-status');
  if (source.manage_stock === false) {
    return { status: 'mapped', fields: { inventoryTracked: false, inStock: source.stock_status === 'instock' } };
  }
  if (source.manage_stock !== true) return gap('missing-or-unknown-tracking-method');
  const quantity = source.stock_quantity;
  // LIVE-FOUND: a tracked product marked out of stock with no quantity (null) or an oversold
  // negative one. stock_status already says it cannot be bought, so it is tracked at 0 -- the same
  // storefront state -- instead of holding the product. In stock with no usable quantity stays a gap.
  if (source.stock_status === 'outofstock' && (quantity === null || quantity === undefined || (Number.isInteger(quantity) && quantity < 0))) {
    return { status: 'mapped', fields: { inventoryTracked: true, inventoryQuantity: 0 }, note: quantity == null ? 'out-of-stock-quantity-missing' : 'out-of-stock-quantity-negative' };
  }
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99999) return gap('invalid-stock-quantity');
  if ((quantity > 0) !== (source.stock_status === 'instock')) return gap('stock-status-quantity-conflict');
  return { status: 'mapped', fields: { inventoryTracked: true, inventoryQuantity: quantity } };
}

module.exports = { mapWooInventory };
