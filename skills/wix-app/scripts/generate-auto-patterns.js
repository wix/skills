#!/usr/bin/env node

/**
 * Auto Patterns Generator Script
 *
 * Generates patterns.json and page.tsx for @wix/auto-patterns dashboard pages.
 * Replicates the deterministic logic from AutoPatternsGenerator.ts.
 *
 * Usage:
 *   node scripts/generate-auto-patterns.js --input <path-to-input.json> --output <target-directory>
 *   node scripts/generate-auto-patterns.js --help
 *
 * Input JSON shape:
 * {
 *   "collection": {
 *     "idSuffix": "additional-fees",
 *     "fields": [{ "key": "feeTitle", "displayName": "Fee Title", "type": "TEXT" }, ...]
 *   },
 *   "schema": {
 *     "content": { "collectionRouteId": "...", ... (20 string fields) },
 *     "layout": { "main": [...], "sidebar": [...] },
 *     "columns": [{ "id": "feeTitle", "displayName": "Title" }],
 *     "gridItem": null | { "titleFieldId": "...", ... }
 *   },
 *   "relevantCollectionId": "my-namespace/additional-fees",
 *   "extensionName": "Additional Fees Manager"
 * }
 *
 * Output:
 *   Writes patterns.json and page.tsx to the specified output directory.
 *   Prints JSON result to stdout: { "files": ["patterns.json", "page.tsx"] }
 *
 * Exit codes:
 *   0 - Success
 *   1 - Invalid arguments or missing required fields
 *   2 - File system error
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// --- Argument parsing ---

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Auto Patterns Generator

Usage:
  node scripts/generate-auto-patterns.js --input <path> --output <dir>

Options:
  --input   Path to input JSON file (required)
  --output  Target directory for generated files (required)
  --help    Show this help message

Input JSON shape:
  {
    "collection": {
      "idSuffix": "string",
      "fields": [{ "key": "string", "displayName": "string", "type": "string" }]
    },
    "schema": {
      "content": { "collectionRouteId": "string", ... },
      "layout": { "main": [...], "sidebar": [...] },
      "columns": [{ "id": "string", "displayName": "string" }],
      "gridItem": null | { "titleFieldId": "string", ... }
    },
    "relevantCollectionId": "string",
    "extensionName": "string"
  }

Output:
  Writes patterns.json and page.tsx to the output directory.
  Prints JSON to stdout: { "files": ["patterns.json", "page.tsx"] }`);
  process.exit(0);
}

const inputPath = getArg('input');
const outputDir = getArg('output');

if (!inputPath) {
  console.error('Error: --input is required. Use --help for usage.');
  process.exit(1);
}
if (!outputDir) {
  console.error('Error: --output is required. Use --help for usage.');
  process.exit(1);
}

// --- Read and validate input ---

let input;
try {
  const raw = readFileSync(resolve(inputPath), 'utf-8');
  input = JSON.parse(raw);
} catch (err) {
  console.error(`Error: Failed to read input file: ${err.message}`);
  process.exit(1);
}

const { collection, schema, relevantCollectionId } = input;

if (!collection || !collection.idSuffix || !Array.isArray(collection.fields)) {
  console.error(
    'Error: Input must include "collection" with "idSuffix" and "fields" array.',
  );
  process.exit(1);
}
if (
  !schema ||
  !schema.content ||
  !schema.layout ||
  !Array.isArray(schema.columns)
) {
  console.error(
    'Error: Input must include "schema" with "content", "layout", and "columns".',
  );
  process.exit(1);
}

// --- Generator logic (mirrors AutoPatternsGenerator.ts) ---

function generatePatternsConfig(collection, schema) {
  const collectionRouteId = schema.content.collectionRouteId;
  const singularEntityName = schema.content.singularEntityName;

  // Build field map
  const fieldMap = new Map();
  for (const field of collection.fields) {
    if (field.key && field.displayName) {
      fieldMap.set(field.key, field);
    }
  }

  const sortableFieldTypes = ['TEXT', 'DATE', 'NUMBER', 'BOOLEAN', 'URL'];

  // Generate columns
  const columns = schema.columns
    .map((columnConfig) => {
      const field = fieldMap.get(columnConfig.id);
      if (!field || !field.key || !field.type) return null;

      let width = '200px';
      if (['BOOLEAN', 'IMAGE', 'NUMBER'].includes(field.type)) width = '100px';
      if (field.type === 'URL') width = '300px';

      return {
        id: field.key,
        name: columnConfig.displayName || field.displayName || 'Field',
        width,
        sortable: sortableFieldTypes.includes(field.type || ''),
      };
    })
    .filter(Boolean);

  // Generate filters
  const filterableFieldTypes = ['DATE', 'NUMBER', 'BOOLEAN'];
  const filters = columns
    .map((column) => {
      const field = fieldMap.get(column.id);
      if (
        !field ||
        !field.key ||
        !filterableFieldTypes.includes(field.type || '')
      )
        return null;

      const baseFilter = {
        id: `${field.key}-filter`,
        fieldId: field.key,
        displayName: field.displayName || '',
        tagLabel: field.displayName || '',
      };

      if (field.type === 'DATE') {
        return {
          ...baseFilter,
          dateConfig: {
            mode: 'COMBINE',
            presets: [
              'TODAY',
              'SEVEN_DAYS',
              'MONTH',
              'NEXT_SEVEN_DAYS',
              'NEXT_THIRTY_DAYS',
            ],
            includeTime: false,
          },
        };
      }
      if (field.type === 'NUMBER') {
        return {
          ...baseFilter,
          numberConfig: { allowedDecimals: true },
        };
      }
      if (field.type === 'BOOLEAN') {
        return baseFilter;
      }
      return null;
    })
    .filter(Boolean);

  // Generate layout (Table + optional Grid)
  const layout = [
    {
      type: 'Table',
      table: {
        columns,
        customColumns: { enabled: true },
      },
    },
  ];

  if (schema.gridItem) {
    layout.push({
      type: 'Grid',
      grid: {
        item: {
          titleFieldId: schema.gridItem.titleFieldId,
          ...(schema.gridItem.subtitleFieldId
            ? { subtitleFieldId: schema.gridItem.subtitleFieldId }
            : {}),
          ...(schema.gridItem.imageFieldId
            ? { imageFieldId: schema.gridItem.imageFieldId }
            : {}),
          cardContentMode: schema.gridItem.subtitleFieldId ? 'full' : 'title',
        },
      },
    });
  }

  // Generate entity page layout
  function generateEntityPageLayout(layoutData) {
    if (!layoutData) return { main: [] };

    const main = layoutData.main.map((section) => ({
      type: 'card',
      card: {
        title: { text: section.title },
        subtitle: { text: section.subtitle },
        children: section.fields.map((fieldKey) => ({
          type: 'field',
          field: { span: 12, fieldId: fieldKey },
        })),
      },
    }));

    const sidebar = layoutData.sidebar.map((section) => ({
      type: 'card',
      card: {
        title: { text: section.title },
        subtitle: { text: section.subtitle },
        children: section.fields.map((fieldKey) => ({
          type: 'field',
          field: { span: 12, fieldId: fieldKey },
        })),
      },
    }));

    return {
      main,
      ...(sidebar.length > 0 ? { sidebar } : {}),
    };
  }

  // Use relevantCollectionId for the collection reference in the config
  const collectionId = relevantCollectionId || collection.idSuffix;

  return {
    pages: [
      {
        id: `${collectionRouteId}-collection`,
        type: 'collectionPage',
        appMainPage: true,
        collectionPage: {
          route: { path: '/' },
          title: {
            text: schema.content.pageTitle || '',
            hideTotal: false,
          },
          subtitle: {
            text: schema.content.pageSubtitle || '',
          },
          actions: {
            primaryActions: {
              type: 'action',
              action: {
                item: {
                  id: `create-${collectionRouteId}`,
                  type: 'create',
                  label: schema.content.actionButtonLabel,
                  collection: {
                    collectionId,
                    entityTypeSource: 'cms',
                  },
                  create: {
                    mode: 'page',
                    page: { id: `${collectionRouteId}-entity` },
                  },
                },
              },
            },
          },
          components: [
            {
              type: 'collection',
              layout,
              entityPageId: `${collectionRouteId}-entity`,
              collection: {
                collectionId,
                entityTypeSource: 'cms',
              },
              toolbarTitle: {
                title: schema.content.toolbarTitle || '',
                subtitle: {
                  text: schema.content.toolbarSubtitle || '',
                },
                showTotal: true,
              },
              filters: { items: filters },
              emptyState: {
                title: schema.content.emptyStateTitle,
                subtitle: schema.content.emptyStateSubtitle,
                addNewCta: {
                  id: `create-${collectionRouteId}`,
                  text: schema.content.emptyStateButtonText,
                },
              },
              actionCell: {
                primaryAction: {
                  item: {
                    id: `edit-${collectionRouteId}`,
                    type: 'update',
                    update: {
                      mode: 'page',
                      page: { id: `${collectionRouteId}-entity` },
                    },
                  },
                },
                secondaryActions: {
                  items: [
                    {
                      id: `delete-${collectionRouteId}`,
                      type: 'delete',
                      label: 'Delete',
                      delete: {
                        mode: 'modal',
                        modal: {
                          title: {
                            text: schema.content.deleteModalTitle || '',
                          },
                          description: {
                            text: schema.content.deleteModalDescription || '',
                          },
                          feedback: {
                            successToast: {
                              text: schema.content.deleteSuccessToast || '',
                            },
                            errorToast: {
                              text: schema.content.deleteErrorToast || '',
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
              bulkActionToolbar: {
                primaryActions: [
                  {
                    type: 'action',
                    action: {
                      item: {
                        id: `bulk-delete-${collectionRouteId}`,
                        type: 'bulkDelete',
                        bulkDelete: {
                          mode: 'modal',
                          modal: {
                            title: {
                              text: schema.content.bulkDeleteModalTitle || '',
                            },
                            description: {
                              text:
                                schema.content.bulkDeleteModalDescription || '',
                            },
                            feedback: {
                              successToast: {
                                text:
                                  schema.content.bulkDeleteSuccessToast || '',
                              },
                              errorToast: {
                                text: schema.content.bulkDeleteErrorToast || '',
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        id: `${collectionRouteId}-entity`,
        type: 'entityPage',
        entityPage: {
          route: {
            path: `/${singularEntityName}/:entityId`,
            params: { id: 'entityId' },
          },
          title: { text: schema.content.entityPageTitle || '' },
          subtitle: { text: schema.content.entityPageSubtitle },
          parentPageId: `${collectionRouteId}-collection`,
          layout: generateEntityPageLayout(schema.layout),
          collectionId,
          entityTypeSource: 'cms',
        },
      },
    ],
  };
}

function generatePageTsx() {
  return `import React from 'react';
import { WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { PatternsWizardOverridesProvider, AutoPatternsApp, type AppConfig } from '@wix/auto-patterns';
import { withDashboard } from '@wix/patterns';
import config from './patterns.json';

const Index: React.FC = () => {
  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <WixPatternsProvider>
        <PatternsWizardOverridesProvider value={{}}>
          <AutoPatternsApp configuration={config as AppConfig} />
        </PatternsWizardOverridesProvider>
      </WixPatternsProvider>
    </WixDesignSystemProvider>
  );
};

export default withDashboard(Index);
`;
}

// --- Generate and write output ---

const resolvedOutput = resolve(outputDir);

try {
  if (!existsSync(resolvedOutput)) {
    mkdirSync(resolvedOutput, { recursive: true });
  }
} catch (err) {
  console.error(`Error: Failed to create output directory: ${err.message}`);
  process.exit(2);
}

const patternsConfig = generatePatternsConfig(collection, schema);
const pageTsx = generatePageTsx();

try {
  writeFileSync(
    join(resolvedOutput, 'patterns.json'),
    JSON.stringify(patternsConfig, null, 2),
  );
  writeFileSync(join(resolvedOutput, 'page.tsx'), pageTsx);
} catch (err) {
  console.error(`Error: Failed to write output files: ${err.message}`);
  process.exit(2);
}

// Print structured result to stdout
console.log(
  JSON.stringify({
    success: true,
    files: ['patterns.json', 'page.tsx'],
    outputDir: resolvedOutput,
  }),
);
