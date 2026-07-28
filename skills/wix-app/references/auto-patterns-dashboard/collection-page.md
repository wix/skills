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

## Validation Logic
- **IF** `components` array length != 1 **THEN** Invalid Config (Must be exactly 1).
- **IF** `layout` contains both 'Table' and 'Grid' **THEN** View Switcher is automatically enabled.
- **IF** `columns` count > 5 **THEN** `customColumns.enabled` = `true`.
- **IF** `columns` count <= 5 **THEN** `customColumns.enabled` = `false` (unless explicitly requested).
- **IF** `type` is 'Grid' **THEN** `titleFieldId` is **REQUIRED**.

## Implementation Rules
- **MUST** reference `entityPageId` to link rows/cards to the entity page.
- **MUST** select max 3 columns initially for the table.
- **MUST** use `tooltipContent` to explain complex column data.
- **SHOULD** include a primary action with `type: 'update'` in Grid view to allow easy editing.
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
