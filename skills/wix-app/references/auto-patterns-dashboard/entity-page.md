# Entity Page Rules

## Type Definitions
```typescript
interface EntityPageConfig {
  type: 'entityPage';
  entityPage: {
    mode?: 'edit' | 'view'; // Default 'edit'
    route: { path: string; params: { id: string } };
    parentPageId: string; // REQUIRED
    collectionId: string;
    entityTypeSource: 'cms' | 'custom';
    title?: {
      text: string;
      badges?: { id: string }; // Dynamic badges override ID
    };
    subtitle?: {
      text: string;
      id?: string; // Dynamic subtitle override ID
    };
    layout?: {
      main: CardLayout[];
      sidebar?: CardLayout[];
    };
    actions?: EntityPageActions; // See Action Rules
  };
}

interface CardLayout {
  type: 'card';
  card: {
    title?: { text: string };
    children: LayoutContent[];
  };
}

type LayoutContent = | { type: 'field'; field: { fieldId: string; span?: number } } | { type: 'container'; container: { children: LayoutContent[]; span?: number } } | { type: 'component'; component: { componentId: string; span?: number } };

// Override Types
type EntityPageHeaderSubtitle = (entity: any) => { text: string };
type EntityPageHeaderBadges = (entity: any) => {
  text: string;
  skin?: 'success' | 'warning' | 'destructive' | 'neutral' | 'premium';
  prefixIcon?: ReactElement;
  suffixIcon?: ReactElement;
}[];
```

## Validation Logic
- **IF** `mode` is undefined **THEN** defaults to `'edit'`.
- **IF** `mode: 'edit'` **THEN** only `moreActions` supported.
- **IF** `mode: 'view'` **THEN** `primaryActions`, `secondaryActions`, `moreActions` supported.
- **IF** `badges.id` defined **THEN** implementation MUST return array of badge objects.
- **IF** `subtitle.id` defined **THEN** implementation MUST return `{ text: string }`.

## Implementation Rules
- **MUST** use route format `/[segment]/:entityId` (NEVER `/:entityId`).
- **MUST** map dynamic parameter in `route.params` (e.g. `{ id: 'entityId' }`).
- **MUST** register overrides for `badges` and `subtitle` if IDs are used.
- **MUST** use 12-column grid system for `span` (wraps if > 12).
- **SHOULD** put primary info in `main` layout, metadata in `sidebar`.
- **NEVER** return JSX from badge/subtitle functions (return data objects).

## Canonical Example
```typescript
// Config
{
  type: 'entityPage',
  entityPage: {
    mode: 'view',
    route: { path: '/pet/:entityId', params: { id: 'entityId' } },
    parentPageId: 'pets-list',
    collectionId: 'pets',
    entityTypeSource: 'cms',
    title: {
      text: 'Pet Details',
      badges: { id: 'petBadges' }
    },
    layout: {
      main: [{
        type: 'card',
        card: {
          title: { text: 'Info' },
          children: [
            { type: 'field', field: { fieldId: 'name', span: 6 } },
            { type: 'field', field: { fieldId: 'age', span: 6 } }
          ]
        }
      }]
    }
  }
}

// Override Implementation
export const petBadges = (entity) => ([
  { text: entity.status, skin: entity.status === 'Active' ? 'success' : 'neutral' }
]);
```
