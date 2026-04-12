# AppConfig Rules

## Type Definitions
```typescript
export interface AppConfig {
  pages: PageConfig[];
}

type PageConfig = CollectionPageConfig | EntityPageConfig;

interface PageBase {
  id: string; // Unique across app
  appMainPage?: boolean; // ONE page must be true
}

interface CollectionPageConfig extends PageBase {
  type: 'collectionPage';
  collectionPage: {
    route: { path: string };
    title: { text: string; hideTotal?: boolean };
    subtitle?: { text: string };
    actions?: PageActions;
    components: [CollectionComponent | CustomComponent]; // EXACTLY ONE component with layout
  };
}

interface EntityPageConfig extends PageBase {
  type: 'entityPage';
  entityPage: {
    mode?: 'edit' | 'view'; // Default 'edit'
    route: { path: string; params: { id: string } };
    title?: { text: string; badges?: { id?: string } };
    subtitle?: { text: string; id?: string };
    actions?: EntityPageActions;
    parentPageId?: string; // ID of parent collection page
    collectionId: string;
    entityTypeSource: 'cms' | 'custom';
    custom?: { id: string }; // REQUIRED if entityTypeSource='custom'
    layout?: {
      main: CardLayout[];
      sidebar?: CardLayout[];
    };
  };
}

// Action Types
interface PageActions {
  primaryActions?: ActionGroup;
  secondaryActions?: ActionGroup;
}

interface EntityPageActions {
  primaryActions?: ActionGroup; // View mode only
  secondaryActions?: ActionGroup; // View mode only
  moreActions?: CustomAction[]; // Both modes
}

type ActionGroup = { type: 'action'; action?: { item: ActionItem } } | { type: 'menu'; menu?: { label: string; items: ActionItem[] } };

interface ActionItem {
  id: string;
  type: 'create' | 'update' | 'delete' | 'custom' | 'bulkDelete';
  label?: string;
  biName: string; // MANDATORY
  skin?: string;
  disabled?: boolean;
  tooltip?: string;
  collection?: CollectionSource; // For create action
  create?: { mode: 'page'; page: { id: string } };
  update?: { mode: 'page'; page: { id: string } };
  delete?: { mode: 'modal'; modal: ModalConfig };
  bulkDelete?: { mode: 'modal'; modal: ModalConfig };
}

// Component Types
interface CollectionComponent {
  type: 'collection';
  entityPageId?: string;
  collection: CollectionSettings;
  filters?: FilterConfig;
  actionCell?: ActionCellConfig;
  bulkActionToolbar?: BulkActionToolbar;
  toolbarTitle?: ToolbarTitle;
  views?: ViewsConfig;
  search?: { shown?: boolean };
  emptyState?: EmptyStateConfig;
  dragAndDrop?: { enabled: boolean; dragAndDropCancel?: { id?: string } };
  layout: [TableLayout, GridLayout];
}

interface CustomComponent {
  type: 'custom';
  id: string;
}

// Sub-Types
interface CollectionSource {
  collectionId: string;
  entityTypeSource: 'cms' | 'custom';
  custom?: { id: string };
}

interface CollectionSettings extends CollectionSource {
  reflectQueryInUrl?: boolean;
  selectAllScope?: 'page' | 'all';
  selectionUpdateMode?: 'preserve' | 'clear';
  paginationMode?: 'cursor' | 'offset';
}

interface TableLayout {
  type: 'Table';
  table?: {
    columns: ColumnConfig[];
    customColumns?: { enabled: boolean };
    dataExtension?: { enabled: boolean };
    stickyColumns?: number;
    showTitleBar?: boolean;
  };
}

interface GridLayout {
  type: 'Grid';
  grid?: {
    item: {
      titleFieldId: string;
      subtitleFieldId?: string;
      imageFieldId?: string;
      cardContentMode?: 'full' | 'title' | 'empty';
      imagePlacement?: 'top' | 'side';
    };
  };
}
```

## Validation Logic
- **IF** `entityTypeSource` is `'custom'` **THEN** `custom: { id: "..." }` is **REQUIRED**.
- **IF** `type: 'collectionPage'` **THEN** `collectionPage` object is **REQUIRED**, `entityPage` object is **FORBIDDEN**.
- **IF** `type: 'entityPage'` **THEN** `entityPage` object is **REQUIRED**, `collectionPage` object is **FORBIDDEN**.
- **IF** `type: 'action'` **THEN** `action` property is **REQUIRED**.
- **IF** `type: 'menu'` **THEN** `menu` property is **REQUIRED**.
- **IF** action type is `'create'` **THEN** `create` config is **REQUIRED**.
- **IF** action type is `'update'` **THEN** `update` config is **REQUIRED**.
- **IF** action type is `'delete'` **THEN** `delete` config is **REQUIRED**.

## Implementation Rules
- **MUST** include `biName` in EVERY action configuration (format: kebab-case, `{action-purpose}-action`).
- **MUST** designate exactly ONE page as `appMainPage: true`.
- **MUST** use TypeScript for configuration.
- **NEVER** fill optional fields unless explicitly requested.
- **NEVER** mix page types in a single configuration.
- **NEVER** set `stickyColumns` to negative, zero, or > column count.
- **NEVER** invent enum values; ASK user for values.

## page.tsx Structure
```tsx
import React from 'react';
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
```

## Canonical Example
```typescript
export const config: AppConfig = {
  pages: [
    {
      id: "product-list",
      type: "collectionPage",
      appMainPage: true,
      collectionPage: {
        route: { path: "/" },
        title: { text: "Products" },
        actions: {
          primaryActions: {
            type: "action",
            action: {
              item: {
                id: "create-product",
                type: "create",
                label: "Add Product",
                biName: "create-product-action",
                collection: {
                  collectionId: "products",
                  entityTypeSource: "cms"
                },
                create: {
                  mode: "page",
                  page: { id: "product-details" }
                }
              }
            }
          }
        },
        components: [
          {
            type: "collection",
            entityPageId: "product-details",
            collection: {
              collectionId: "products",
              entityTypeSource: "cms"
            },
            layout: [
              {
                type: "Table",
                table: {
                  columns: [
                    { id: "name", name: "Name", width: "200px" },
                    { id: "price", name: "Price", width: "100px" }
                  ]
                }
              },
              {
                type: "Grid",
                grid: {
                  item: { titleFieldId: "name" }
                }
              }
            ]
          }
        ]
      }
    },
    {
      id: "product-details",
      type: "entityPage",
      entityPage: {
        route: { path: "/product/:id", params: { id: "id" } },
        collectionId: "products",
        entityTypeSource: "cms",
        layout: {
          main: [
            {
              type: "card",
              card: {
                title: { text: "Basic Info" },
                children: [
                  { type: "field", field: { fieldId: "name" } }
                ]
              }
            }
          ]
        }
      }
    }
  ]
};
```
