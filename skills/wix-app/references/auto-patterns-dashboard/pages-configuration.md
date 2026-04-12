# Pages Configuration Rules

## Type Definitions
```typescript
interface PageConfig {
  id: string; // Unique ID
  type: 'collectionPage' | 'entityPage';
  appMainPage?: boolean; // EXACTLY ONE page must have true
}

interface CollectionPage extends PageConfig {
  type: 'collectionPage';
  collectionPage: {
    route: { path: '/' };
    components: [{
      entityPageId: string; // REQUIRED: Links to entity page ID
      // ... component config
    }];
  };
}

interface EntityPage extends PageConfig {
  type: 'entityPage';
  entityPage: {
    parentPageId: string; // REQUIRED: Links to collection page ID
    route: {
      path: string; // MUST be '/[segment]/:entityId'
      params: { id: 'entityId' };
    };
  };
}

interface StickyConfig {
  stickyColumns?: number; // Count of columns to stick from left
  columns: Array<{
    reorderDisabled?: boolean; // Recommended for sticky cols
  }>;
}
```

## Validation Logic
- **IF** `pages` array length != 2 **THEN** Invalid (Must be exactly 2).
- **IF** `appMainPage: true` count != 1 **THEN** Invalid (Must be exactly 1).
- **IF** `type: 'entityPage'` **THEN** `route.path` MUST match `/[segment]/:entityId`.
- **IF** `route.path` is `/:entityId` **THEN** Invalid (Conflict with root).
- **IF** `stickyColumns` is set **THEN** value must be > 0 AND <= total columns.

## Implementation Rules
- **MUST** generate exactly one `collectionPage` and one `entityPage`.
- **MUST** link pages bidirectionally:
    - `collectionPage` references `entityPageId` (in component).
    - `entityPage` references `parentPageId` (in page config).
- **MUST** use `entityId` as the dynamic parameter name.
- **MUST** use position-based stickiness (first N columns).
- **SHOULD** set `reorderDisabled: true` for sticky columns to prevent user breakage.

## Canonical Example
```typescript
[
  {
    id: 'product-list',
    type: 'collectionPage',
    appMainPage: true,
    collectionPage: {
      route: { path: '/' },
      components: [{
        type: 'collection',
        entityPageId: 'product-details', // Link to Entity Page
        layout: [{
          type: 'Table',
          table: {
            stickyColumns: 1,
            columns: [
              { id: 'name', name: 'Name', reorderDisabled: true }, // Sticky & Locked
              { id: 'price', name: 'Price' }
            ]
          }
        }]
      }]
    }
  },
  {
    id: 'product-details',
    type: 'entityPage',
    entityPage: {
      parentPageId: 'product-list', // Link to Collection Page
      route: {
        path: '/product/:entityId', // Correct format
        params: { id: 'entityId' }
      }
    }
  }
]
```
