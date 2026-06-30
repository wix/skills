# Custom Entity Header Override Rules

**REQUIRED**: After creating header override files, you MUST update `page.tsx` to register them.

## Type Definitions
```typescript
// Subtitle Override
type SubtitleResolver = (entity: Record<string, any>) => { text: string };

// Badge Override
interface BadgeObject {
  text: string;                     // Required: Text to display
  skin?: BadgeSkin;                 // Optional: Visual styling
  prefixIcon?: React.ReactElement;  // Optional: Icon before text (from @wix/wix-ui-icons-common)
  suffixIcon?: React.ReactElement;  // Optional: Icon after text (from @wix/wix-ui-icons-common)
}

type BadgeSkin = 'success' | 'warning' | 'destructive' | 'neutral' | 'premium';

type BadgesResolver = (entity: Record<string, any>) => BadgeObject[];
```

## Configuration Schema
```json
{
  "entityPage": {
    "title": {
      "text": "Entity Details",
      "badges": {
        "id": "entityPageHeaderBadges"  // Must match override key
      }
    },
    "subtitle": {
      "text": "Default subtitle text",
      "id": "entityPageHeaderSubtitle"  // Must match override key
    }
  }
}
```

## Validation Logic
- **IF** overriding subtitle **THEN** function MUST return `{ text: string }` object.
- **IF** overriding badges **THEN** function MUST return array of `BadgeObject` (NOT JSX components).
- **IF** `badges.id` or `subtitle.id` defined in config **THEN** matching override MUST exist.
- **IF** logic depends on entity data **THEN** check for field existence (entity might be partial).
- **IF** `id` in config does not match override key **THEN** override will not render.

## Implementation Rules
- **MUST** be placed in `components/entityPageHeaderSubtitle/` or `components/entityPageHeaderBadges/`.
- **MUST** export `useEntityPageHeaderSubtitle` / `useEntityPageHeaderBadges` hooks from respective index files.
- **MUST** be pure functions (no hooks inside the resolver functions).
- **MUST** ensure `id` in config matches the key in override object exactly.
- **NEVER** return JSX from badge/subtitle functions (return data objects only).

## Canonical Example

### 1. Subtitle Override
```typescript
// components/entityPageHeaderSubtitle/entityPageHeaderSubtitle.ts
export const entityPageHeaderSubtitle = (entity: Record<string, any>) => {
  return { text: `Created by ${entity.owner || 'Unknown'} on ${entity.date || 'N/A'}` };
};

// components/entityPageHeaderSubtitle/index.ts
import { entityPageHeaderSubtitle } from './entityPageHeaderSubtitle';
export const useEntityPageHeaderSubtitle = () => ({ entityPageHeaderSubtitle });
```

### 2. Badges Override
```typescript
// components/entityPageHeaderBadges/entityPageHeaderBadges.ts
export const entityPageHeaderBadges = (entity: Record<string, any>) => {
  const badges = [];

  // Add status badge
  if (entity.isActive) {
    badges.push({ text: 'Active', skin: 'success' });
  } else {
    badges.push({ text: 'Inactive', skin: 'neutral' });
  }

  // Add premium badge if applicable
  if (entity.isPremium) {
    badges.push({ text: 'Premium', skin: 'premium' });
  }

  // Add warning badge if needed
  if (entity.needsAttention) {
    badges.push({ text: 'Needs Attention', skin: 'warning' });
  }

  return badges;
};

// components/entityPageHeaderBadges/index.ts
import { entityPageHeaderBadges } from './entityPageHeaderBadges';
export const useEntityPageHeaderBadges = () => ({ entityPageHeaderBadges });
```

## page.tsx Registration (REQUIRED)

**CRITICAL: PRESERVE EXISTING OVERRIDES** - Do NOT remove existing overrides. ADD this new one alongside them.

### For Subtitle Override:
```tsx
// 1. Add import (keep all existing imports)
import { useEntityPageHeaderSubtitle } from './components/entityPageHeaderSubtitle';

// 2. Add hook call (keep all existing hook calls)
const entityPageHeaderSubtitle = useEntityPageHeaderSubtitle();

// 3. Add entityPageHeaderSubtitle to AutoPatternsOverridesProvider value (keep ALL existing overrides)
```

### For Badges Override:
```tsx
// 1. Add import (keep all existing imports)
import { useEntityPageHeaderBadges } from './components/entityPageHeaderBadges';

// 2. Add hook call (keep all existing hook calls)
const entityPageHeaderBadges = useEntityPageHeaderBadges();

// 3. Add entityPageHeaderBadges to AutoPatternsOverridesProvider value (keep ALL existing overrides)
```
