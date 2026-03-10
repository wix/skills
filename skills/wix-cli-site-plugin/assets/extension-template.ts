// {{PLUGIN_NAME}}.extension.ts
// Extension configuration for site plugin registration.
//
// How to adapt this template:
// 1. Replace {{GENERATE_UUID}} with a freshly generated UUID v4 string
// 2. Update name, marketData, and tagName to match your plugin
// 3. Configure placements with the correct appDefinitionId, widgetId, and slotId
//    (see references/SLOTS.md for available slots)
// 4. Update element and settings paths to point to your plugin files
//
// Important:
// - The id must be a unique static UUID — do NOT use randomUUID()
// - {{BASE_URL}} resolves to the public/ folder at runtime
// - tagName must be kebab-case and contain a hyphen

import { extensions } from '@wix/astro/builders';

export default extensions.sitePlugin({
  id: '{{GENERATE_UUID}}',
  name: 'My Site Plugin',
  marketData: {
    name: 'My Site Plugin',
    description: 'Marketing Description',
    logoUrl: '{{BASE_URL}}/my-site-plugin-logo.svg',
  },
  placements: [{
    appDefinitionId: 'a0c68605-c2e7-4c8d-9ea1-767f9770e087',
    widgetId: '6a25b678-53ec-4b37-a190-65fcd1ca1a63',
    slotId: 'product-page-details-6',
  }],
  installation: { autoAdd: true },
  tagName: 'my-site-plugin',
  element: './extensions/site/plugins/my-site-plugin/my-site-plugin.tsx',
  settings: './extensions/site/plugins/my-site-plugin/my-site-plugin.panel.tsx',
});
