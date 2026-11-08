'use strict';

// The setup executor writes these values into setup-verification.json and the shared
// validator accepts them. Keep the names here so adding an executor check and adding
// validator vocabulary cannot drift apart.
const SETUP_CHECK_METHODS = Object.freeze({
  STATUS_READ: 'status-read',
  INSTALLED_APPS_READ: 'installed-apps-read',
  INSTALL_RESPONSE: 'install-response',
  EXTENDED_FIELD_VERIFICATION: 'extended-field-verification',
  COLLECTION_READ: 'collection-read',
  CATALOG_VERSION_READ: 'catalog-version-read',
  MEMBER_READ: 'member-read',
  MEMBER_CREATE_RESPONSE: 'member-create-response',
  REFERENCE_READ_BACK: 'reference-read-back',
  WRITER_RESPONSE: 'writer-response',
  SITE_PROPERTIES_READ: 'site-properties-read',
  SETTINGS_READ: 'settings-read',
});

const SETUP_CHECK_METHOD_SET = new Set(Object.values(SETUP_CHECK_METHODS));

module.exports = { SETUP_CHECK_METHODS, SETUP_CHECK_METHOD_SET };
