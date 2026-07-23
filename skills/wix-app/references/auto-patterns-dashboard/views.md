# Views Configuration Rules

## When To Use Views

Saved Views are named, saved operational worksets. Use them when the manager needs recurring subsets such as `All products`, `Low stock`, `Discontinued`, or `My queue`.

Views are separate from the collection page layout:

- `layout: [Table, Grid]` enables the built-in Table/Grid **layout switcher**.
- `views` configures named Saved Views, their filters, and optional column preferences.
- Configure both when the user needs both visual representations and named worksets.
- `isDefaultView` selects the default saved View. It does not select Table or Grid as the initial presentation.

The native CMS `Choose layout` dropdown is a different product surface. Do not call it a Saved View. Auto Patterns does not document its `List` layout, a dropdown presentation for the layout switcher, or a `defaultLayout` configuration key.

For a dynamic condition that compares fields, combines predicates, or depends on elapsed time, do not claim that a View calculates it. First provide maintained filterable fields, then configure the View against their documented filter IDs:

- `stockOnHand <= reorderPoint` -> `inventoryStatus`
- unpaid OR unfulfilled for more than 24 hours OR customer issue -> `needsAttention`, `exceptionType`, and `exceptionSince`
- reviewed queue -> `isReviewed`

Define who updates each field on create, source changes, time transitions, and backfill. This remains a one-collection Auto Patterns route; filter complexity is data shaping, not evidence for a custom WDS table.

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
