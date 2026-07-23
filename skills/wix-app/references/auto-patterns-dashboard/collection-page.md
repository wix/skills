# Collection Page Rules

## Type Definitions
```typescript
interface CollectionComponent {
  type: 'collection';
  entityPageId: string; // REQUIRED for navigation
  collection: {
    collectionId: string;
    entityTypeSource: 'cms' | 'custom';
    custom?: { id: string };
  };
  layout: LayoutItem[];
}

type LayoutItem = TableLayout | GridLayout;

interface TableLayout {
  type: 'Table';
  table: {
    columns: ColumnConfig[];
    customColumns?: { enabled: boolean };
    dataExtension?: { enabled: boolean };
    stickyColumns?: number;
    showTitleBar?: boolean;
  };
}

interface ColumnConfig {
  id: string; // Field ID
  name: string; // Display title
  width: string;
  tooltipContent?: string; // Info icon text
  sortable?: boolean;
  hideable?: boolean;
}

interface GridLayout {
  type: 'Grid';
  grid: {
    item: {
      titleFieldId: string; // REQUIRED Field ID
      subtitleFieldId?: string; // Field ID
      imageFieldId?: string; // Field ID
      cardContentMode?: 'full' | 'title' | 'empty';
    };
  };
}
```

## Terminology and Boundary

Use **layout switcher** for the automatic presentation control created when both `Table` and `Grid` layouts are configured. Use **Saved Views** for the separate named-filter and column-preference system in `views` configuration.

The layout switcher supports only `Table` and `Grid`. It is not the native CMS `Choose layout` picker: `List`, custom layout labels, a dropdown layout-picker presentation, and a configurable initial layout are not documented configuration capabilities.

## Validation Logic
- **IF** `components` array length != 1 **THEN** Invalid Config (Must be exactly 1).
- **IF** `layout` contains both 'Table' and 'Grid' **THEN** the built-in Table/Grid layout switcher is automatically enabled.
- **IF** `columns` count > 5 **THEN** `customColumns.enabled` = `true`.
- **IF** `columns` count <= 5 **THEN** `customColumns.enabled` = `false` (unless explicitly requested).
- **IF** `type` is 'Grid' **THEN** `titleFieldId` is **REQUIRED**.

## Implementation Rules
- **MUST** reference `entityPageId` to link rows/cards to the entity page.
- **MUST** select max 3 columns initially for the table.
- **MUST** use `tooltipContent` to explain complex column data.
- **SHOULD** include a primary action with `type: 'update'` in Grid view to allow easy editing.
- **SHOULD** choose the linked entity page for deep, multi-section, validation-heavy, deep-linkable, or long-running work. A SidePanel or Modal may support viewing or editing when its depth and context fit better.
- **NEVER** use `onRowClick` unless custom behavior (not entity page navigation) is explicitly required.

## Canonical Example
```typescript
{
  type: 'collectionPage',
  // ... page props
  components: [
    {
      type: 'collection',
      entityPageId: 'pet-details', // Links to entity page
      collection: {
        collectionId: 'pets',
        entityTypeSource: 'cms'
      },
      layout: [
        {
          type: 'Table',
          table: {
            columns: [
              { id: 'name', name: 'Name', width: '200px', tooltipContent: 'Pet Name' },
              { id: 'breed', name: 'Breed', width: '150px' },
              { id: 'age', name: 'Age', width: '100px' }
            ],
            customColumns: { enabled: false }
          }
        },
        {
          type: 'Grid',
          grid: {
            item: {
              titleFieldId: 'name',
              subtitleFieldId: 'breed',
              imageFieldId: 'photo'
            }
          }
        }
      ]
    }
  ]
}
```
