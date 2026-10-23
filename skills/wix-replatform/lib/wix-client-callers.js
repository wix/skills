'use strict';
const fs = require('node:fs');
const path = require('node:path');
const CALLERS = Object.freeze([
  'skills/wix-replatform/lib/execution-capability.js',
  'skills/wix-replatform/lib/dependency-readiness.js',
  'skills/wix-replatform/resources/rp-execute-setup/scripts/execute-setup.js',
  'skills/wix-replatform/resources/rp-execute-import/scripts/shipping-estimate-audit.js',
  'skills/wix-replatform/resources/rp-quick-woocommerce/scripts/quick-mode.js',
  'skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js',
  'skills/wix-replatform/resources/rp-target-wix/lib/wix-writers.js',
  'skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js',
  'skills/wix-replatform/scripts/item-seo-tags-verify.js',
  'skills/wix-replatform/scripts/url-redirects.js',
  'tests/target-wix/probe-plain-description-media.js',
  'tests/target-wix/coupon-plan-live-sentinel.js',
  'tests/target-wix/payments-live-sentinel.js',
  'tests/target-wix/order-history-live-sentinel.js',
  'tests/target-wix/contract-test.js',
  'tests/target-wix/write-outcome-classification-test.js',
  'tests/target-wix/order-history-composite-test.js',
  'tests/target-wix/read-back-transport-test.js',
  'tests/orchestration/read-back-gate-test.js',
  'tests/orchestration/dependency-readiness-test.js',
  'tests/orchestration/dependency-review-regressions-test.js',
  'tests/orchestration/dependency-readiness-scaling-test.js',
  'tests/orchestration/dependency-readiness-matrix-test.js',
  'tests/orchestration/setup-reference-gate-test.js',
  'tests/orchestration/dependency-readiness-cost-test.js',
  'tests/orchestration/dependency-cutover-test.js',
  'tests/orchestration/dependency-consent-test.js',
  'tests/orchestration/execution-capability-test.js',
]);
const PROBES = new Set(CALLERS.filter(file => /(?:verify-stores|item-seo-tags-verify|live-sentinel|probe-plain-description-media|contract-test|execution-capability-test|dependency-readiness-matrix-test|write-outcome-classification-test|order-history-composite-test|read-back-transport-test|read-back-gate-test)/.test(file)));
function scanWixClientCallers(root) {
  const found = [], errors = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.[cm]?js$/.test(file)) {
        const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ''), relative = path.relative(root, file).split(path.sep).join('/');
        if (/\b(?:createWixClient|startSetupRun|bindSetupStep|startImportRun|bindTask|startQuickRun|bindQuickEntity|bindQuickSetup|startDevProbe)\s*\(/.test(text)) {
          found.push(relative); if (!CALLERS.includes(relative)) errors.push(`wix_client_caller_unlisted:${relative}`);
          if (/\bstartDevProbe\s*\(/.test(text) && !PROBES.has(relative) && !relative.endsWith('/execution-capability.js')) errors.push(`dev_probe_caller_unlisted:${relative}`);
        }
      }
    }
  }
  walk(path.join(root, 'skills')); walk(path.join(root, 'tests'));
  return { ok: !errors.length, errors, callers: found.sort() };
}
module.exports = { CALLERS, scanWixClientCallers };
