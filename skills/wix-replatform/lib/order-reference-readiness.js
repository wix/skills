'use strict';
// API acceptance is insufficient: every selected rule requires observed dashboard fidelity.
function proven(cell, aspect) { return cell?.accepted === true && cell.dashboardVerified === true && cell[aspect + 'Fidelity'] === true; }
function selectOrderReferenceMapping(cells = require('../resources/rp-target-wix/domains/ecom/entities/order.json').importReferenceCanary?.cells || []) {
  const byId = new Map((cells || []).map(cell => [cell.cell, cell]));
  const baseline = byId.get(1), blockers = [];
  if (!proven(baseline, 'shipping')) blockers.push('order-shipping-reference-unverified');
  if (!proven(baseline, 'tax')) blockers.push('order-tax-reference-unverified');
  if (blockers.length) return { verified: false, blockers, setupEdgeMode: 'task-complete' };
  let carrier = true, code = true, taxGroup = true;
  if (proven(byId.get(2), 'shipping')) carrier = code = false;
  else if (proven(byId.get(8), 'shipping')) carrier = false;
  else if (proven(byId.get(9), 'shipping')) code = false;
  if (proven(byId.get(3), 'tax')) taxGroup = false;
  if (!carrier && !code && !taxGroup && !(proven(byId.get(4), 'shipping') && proven(byId.get(4), 'tax'))) carrier = code = taxGroup = true;
  const signatures = { 1: [true, true, true], 2: [false, false, true], 3: [true, true, false], 4: [false, false, false], 8: [false, true, true], 9: [true, false, true] };
  let selected = [...byId.values()].find(cell => JSON.stringify(signatures[cell.cell] || cell.selectedReferences) === JSON.stringify([carrier, code, taxGroup]));
  if (!selected || !proven(selected, 'shipping') || !proven(selected, 'tax')) return { verified: false, blockers: ['order-shipping-reference-unverified', 'order-tax-reference-unverified'], setupEdgeMode: 'task-complete', requiredCombination: [carrier, code, taxGroup] };
  return { verified: true, carrier, code, taxGroup, selectedCell: selected.cell, blockers: [], setupEdgeMode: 'task-complete' };
}
function orderShippingReadiness(order, mapping = selectOrderReferenceMapping(), { logistics } = {}) {
  const lines = order.shipping_lines || [];
  if (!Array.isArray(lines) || lines.length > 1) return { deferred: true, reason: 'order-multiple-shipping-lines', severity: 'blocker' };
  if (!lines.length && !(order.tax_lines || []).length) return { shippingInfo: undefined };
  if (!mapping?.verified) return { deferred: true, reason: mapping?.blockers?.[0] || 'order-shipping-reference-unverified', severity: 'blocker' };
  if (!lines.length) return { shippingInfo: undefined };
  const line = lines[0];
  return { shippingInfo: { title: line.method_title, cost: { price: { amount: String(line.total) } }, ...(logistics ? { logistics } : {}) }, requiredReferences: { carrier: mapping.carrier, code: mapping.code, taxGroup: mapping.taxGroup } };
}
module.exports = { selectOrderReferenceMapping, orderShippingReadiness };
