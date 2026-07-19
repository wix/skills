# Views Configuration Rules

## When To Use Views

Views are named, saved operational worksets. Use them when the manager needs recurring subsets such as `All products`, `Low stock`, `Discontinued`, or `My queue`.

Views are separate from the collection page layout:

- `layout: [Table, Grid]` enables the Table/Grid presentation switcher.
- `views` configures named presets, their filters, and optional column preferences.
- Configure both when the user needs both visual representations and named worksets.
- `isDefaultView` selects the default saved View. It does not select Table or Grid as the initial presentation.

For a dynamic condition that compares two fields, such as `stockOnHand <= reorderPoint`, do not claim that a View calculates it. First provide a maintained filterable field, for example `inventoryStatus: In stock | Low stock | Discontinued`, then configure the View against that field's documented filter ID.

## Type Definitions
```typescript
interface ViewsConfig {
  enabled?: boolean;
  presets?: ViewsPreset | CategoriesPreset;
  saveViewModalProps?: { placeholderName?: string; learnMore?: { url?: string } };
  viewsDropdownProps?: {
    showTotal?: boolean;
    hideAllItemsView?: boolean;
    customAllItemsViewLabel?: string;
  };
}

interface ViewsPreset {
  type: 'views';
  views: PresetView[];
}

interface CategoriesPreset {
  type: 'categories';
  categories: {
    id: string;
    label: string;
    views: PresetView[];
    icon?: { tooltipContent: string; size?: 'small' | 'medium' };
  }[];
}

interface PresetView {
  id: string; // Forbidden: predefined-views, saved-views, all-items-view
  label: string;
  isDefaultView?: boolean;
  columnPreferences?: { id: string; direction?: 'asc' | 'desc'; show?: boolean }[];
  filters?: Record<string, AutoFilterValue>; // Key matches filter config ID
}
```

## Validation Logic
- **IF** `views.enabled` is false **THEN** all other settings ignored.
- **IF** controlling columns in views **THEN** `table.customColumns.enabled` MUST be true.
- **IF** setting `columnPreferences` **THEN** must list ALL visible columns if reordering/hiding.
- **IF** setting filters **THEN** keys MUST match defined filter IDs.

## Implementation Rules
- **MUST** set `enabled: true` to activate.
- **MUST** use valid filter structures (Date/Number/Boolean/Enum/Reference) matching `AppConfig`.
- **MUST** avoid reserved IDs (`predefined-views`, `saved-views`, `all-items-view`).
- **SHOULD** set `isDefaultView: true` on exactly one preset if default override needed.
- **SHOULD** use `type: 'views'` for a short flat set of manager worksets; use categories only when the sets need a meaningful hierarchy.

## Canonical Example
```typescript
views: {
  enabled: true,
  presets: {
    type: 'categories',
    categories: [{
      id: 'status-cat',
      label: 'By Status',
      views: [{
        id: 'active-items',
        label: 'Active Only',
        isDefaultView: true,
        filters: {
          'status-filter': { filterType: 'boolean', value: [{ id: 'checked', name: 'Active' }] }
        },
        columnPreferences: [
          { id: 'name', show: true },
          { id: 'status', show: true, direction: 'asc' }
        ]
      }]
    }]
  }
}
```
