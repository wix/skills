'use strict';

const DASHBOARD_BASE_URL = 'https://manage.wix.com/dashboard';

function normalizeMetaSiteId(metaSiteId) {
  const normalized = String(metaSiteId || '').trim();
  if (!normalized) {
    throw new Error('metaSiteId is required to build a Wix dashboard URL');
  }
  if (/[/?#\s]/.test(normalized)) {
    throw new Error('metaSiteId must be a bare id, not a URL or path');
  }
  return normalized;
}

function buildWixDashboardUrl(metaSiteId, options = {}) {
  const id = normalizeMetaSiteId(metaSiteId);
  const path = options.path ? String(options.path).trim().replace(/^\/+/, '') : '';
  const suffix = path ? `/${encodeURIComponent(path).replace(/%2F/g, '/')}` : '';
  return `${DASHBOARD_BASE_URL}/${encodeURIComponent(id)}${suffix}`;
}

function buildWixDashboardLink(metaSiteId) {
  return {
    metaSiteId: normalizeMetaSiteId(metaSiteId),
    dashboardUrl: buildWixDashboardUrl(metaSiteId),
  };
}

module.exports = {
  DASHBOARD_BASE_URL,
  buildWixDashboardLink,
  buildWixDashboardUrl,
  normalizeMetaSiteId,
};
