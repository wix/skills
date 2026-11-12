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
  'skills/wix-replatform/scripts/cms-item-quota.js',
  'tests/target-wix/probe-plain-description-media.js',
  'tests/target-wix/coupon-plan-live-sentinel.js',
  'tests/target-wix/payments-live-sentinel.js',
  'tests/target-wix/order-history-live-sentinel.js',
  'tests/target-wix/plan-order-live-sentinel.js',
  'tests/target-wix/contract-test.js',
  'tests/target-wix/write-outcome-classification-test.js',
  'tests/target-wix/order-history-composite-test.js',
  'tests/target-wix/read-back-transport-test.js',
  'tests/target-wix/cms-item-quota-test.js',
  'tests/target-wix/coupon-bulk-write-test.js',
  'tests/target-wix/member-support-runtime-test.js',
  'tests/orchestration/safe-mode-removed-cross-gate-test.js',
  'tests/migration-review/write-recovery-test.js',
  'tests/mapping/mapping-recovery-test.js',
  'tests/orchestration/read-back-gate-test.js',
  'tests/orchestration/dependency-adopt-only-test.js',
  'tests/orchestration/dependency-readiness-test.js',
  'tests/orchestration/dry-run-speed-test.js',
  'tests/orchestration/dependency-held-records-test.js',
  'tests/orchestration/one-click-held-approval-test.js',
  'tests/orchestration/dependency-no-producer-test.js',
  'tests/orchestration/dependency-gates-no-regression-test.js',
  'tests/orchestration/extract-integrity-cross-gate-test.js',
  'tests/orchestration/dependency-generality-test.js',
  'tests/orchestration/app-requirements-test.js',
  'tests/orchestration/dependency-review-regressions-test.js',
  'tests/orchestration/contact-import-readiness-test.js',
  'tests/orchestration/events-writers-cross-gate-test.js',
  'tests/orchestration/order-merchant-note-import-test.js',
  'tests/orchestration/product-media-cross-gate-test.js',
  'tests/orchestration/dependency-earlier-run-landed-test.js',
  'tests/orchestration/member-company-login-email-test.js',
  'tests/orchestration/member-contact-and-bulk-product-proof-test.js',
  'tests/orchestration/order-placeholder-line-test.js',
  'tests/orchestration/reconciled-target-in-grant-test.js',
  'tests/orchestration/saved-product-target-adoption-test.js',
  'tests/orchestration/product-media-per-record-test.js',
  'tests/orchestration/order-whole-task-waits-test.js',
  'tests/orchestration/gift-card-writers-cross-gate-test.js',
  'tests/orchestration/forms-import-client-test.js',
  'tests/orchestration/forms-cross-gate-test.js',
  'tests/orchestration/pre-send-refusal-journal-test.js',
  'tests/orchestration/plan-order-import-test.js',
  'tests/orchestration/raw-request-import-test.js',
  'tests/orchestration/harmony-app-install-test.js',
  'tests/orchestration/harmony-app-gate-test.js',
  'tests/orchestration/bookings-writers-import-test.js',
  'tests/orchestration/crm-label-member-about-import-test.js',
  'tests/orchestration/import-task-blog-member-marks-test.js',
  'tests/orchestration/seo-item-tags-import-test.js',
  'tests/orchestration/stores-writers-import-test.js',
  'tests/orchestration/rate-limit-readiness-b9-test.js',
  'tests/orchestration/writer-retry-safety-test.js',
  'tests/orchestration/writer-gates-agree-cross-gate-test.js',
  'tests/orchestration/dependency-readiness-scaling-test.js',
  'tests/orchestration/dependency-readiness-matrix-test.js',
  'tests/orchestration/dependency-child-output-test.js',
  'tests/orchestration/shipping-setup-import-ownership-test.js',
  'tests/orchestration/delivery-region-cross-gate-test.js',
  'tests/orchestration/dependency-self-edge-test.js',
  'tests/orchestration/setup-reference-gate-test.js',
  'tests/orchestration/dependency-readiness-cost-test.js',
  'tests/orchestration/dependency-cutover-test.js',
  'tests/orchestration/dependency-consent-test.js',
  'tests/orchestration/dry-run-writer-shapes-test.js',
  'tests/orchestration/execution-capability-test.js',
  'tests/lib/site-regional-fixtures.js',
  'tests/orchestration/site-regional-import-gate-test.js',
  'tests/site-regional/site-regional-capability-test.js',
  'tests/fixtures/generated-importer/entrypoint-product-tag-gap.js',
  'tests/target-wix/wix-token-refresh-test.js',
  'tests/orchestration/import-token-expiry-e2e-test.js',
  'tests/orchestration/setup-token-expiry-test.js',
  'tests/orchestration/same-task-parent-gate-test.js',
  'tests/orchestration/import-task-runner-test.js',
  'tests/orchestration/dependency-setup-producer-agreement-test.js',
  'tests/tooling/egress-fetch-test.js',
]);
const PROBES = new Set(CALLERS.filter(file => /(?:verify-stores|item-seo-tags-verify|live-sentinel|probe-plain-description-media|contract-test|execution-capability-test|dependency-readiness-matrix-test|write-outcome-classification-test|order-history-composite-test|read-back-transport-test|read-back-gate-test|write-recovery-test|wix-token-refresh-test|coupon-bulk-write-test)/.test(file)));
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
