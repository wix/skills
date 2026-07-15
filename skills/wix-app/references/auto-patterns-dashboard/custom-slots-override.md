# Custom Slots Override Rules

**REQUIRED**: After creating slot files, you MUST update `page.tsx` to register them.

## Type Definitions
```typescript
// Slot Component Signature
type SlotComponent = React.FC; // No props passed
```

## Configuration Schema
```json
{
  "type": "collectionPage",
  "collectionPage": {
    "components": [
      {
        "type": "custom",
        "id": "topBanner" // Matches override key
      },
      {
        "type": "collection",
        "collection": { "collectionId": "items" }
      }
    ]
  }
}
```

## Validation Logic
- **IF** `type` is `"custom"` in components array **THEN** `id` MUST match a key in the `slots` override object.
- **IF** implementing a slot **THEN** component MUST NOT expect any props.
- **NEVER** assume slot position; it renders exactly where placed in the `components` array.

## Implementation Rules
- **MUST** be placed in `components/slots/` folder.
- **MUST** export a `useSlots` hook from `components/slots/index.tsx`.
- **MUST** be a standard React Functional Component.
- **MUST** match the `id` in configuration exactly.

## Canonical Example
```tsx
// components/slots/TopBanner.tsx
import { Card, Text } from '@wix/design-system';

export const TopBanner = () => (
  <Card>
    <Card.Content>
      <Text>Welcome to the dashboard</Text>
    </Card.Content>
  </Card>
);

// components/slots/index.tsx
import { TopBanner } from './TopBanner';
export const useSlots = () => ({ topBanner: TopBanner });
```

## page.tsx Registration (REQUIRED)

**CRITICAL: PRESERVE EXISTING OVERRIDES** - Do NOT remove existing overrides. ADD this new one alongside them.

```tsx
// 1. Add import (keep all existing imports)
import { useSlots } from './components/slots';

// 2. Add hook call (keep all existing hook calls)
const slots = useSlots();

// 3. Add slots to PatternsWizardOverridesProvider value (keep ALL existing overrides)
```
