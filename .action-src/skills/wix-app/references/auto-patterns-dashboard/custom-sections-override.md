# Custom Sections Override Rules

**REQUIRED**: After creating section files, you MUST update `page.tsx` to register them.

## Type Definitions
```typescript
interface Section {
  id: string; // Unique grouping ID
  title: string; // Header text
  primaryAction?: {
    id: string;
    label: string;
    prefixIcon?: React.ReactElement;
    onClick: () => void;
  };
  badge?: {
    visible: boolean;
    skin?: 'light' | 'danger' | 'neutralLight';
  };
}

// Section Renderer Signature
type SectionRenderer = (item: any) => Section;
```

## Configuration Schema
```json
{
  "type": "collectionPage",
  "collectionPage": {
    "components": [
      {
        "layout": [
          {
            "type": "Table",
            "table": {
              "sections": {
                "id": "groupByType" // Matches override key
              }
            }
          }
        ]
      }
    ]
  }
}
```

## Validation Logic
- **IF** `sections.id` is defined **THEN** matching override function MUST exist.
- **IF** multiple items return same `id` from renderer **THEN** they will be visually grouped.
- **NEVER** perform heavy computations in renderer; it runs for every item.

## Implementation Rules
- **MUST** be placed in `components/sections/` folder.
- **MUST** export a `useSections` hook from `components/sections/index.tsx`.
- **MUST** return a valid `Section` object.
- **MUST** handle missing fields gracefully (default values).

## Canonical Example
```tsx
// components/sections/groupByType.ts
import { Section } from '@wix/patterns';

export function groupByType(item: any): Section {
  const type = item.type || 'other';
  return {
    id: type,
    title: type.toUpperCase(),
    badge: { visible: true, skin: 'neutralLight' }
  };
}

// components/sections/index.tsx
import { groupByType } from './groupByType';
export const useSections = () => ({ groupByType });
```

## page.tsx Registration (REQUIRED)

**CRITICAL: PRESERVE EXISTING OVERRIDES** - Do NOT remove existing overrides. ADD this new one alongside them.

```tsx
// 1. Add import (keep all existing imports)
import { useSections } from './components/sections';

// 2. Add hook call (keep all existing hook calls)
const sections = useSections();

// 3. Add sections to PatternsWizardOverridesProvider value (keep ALL existing overrides)
```
