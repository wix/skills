# ResolvedAction Rules

## Type Definitions
```typescript
interface ResolvedAction {
  label: string; // Display text
  icon: IconElement; // React Icon Component
  onClick: () => void; // async handlers compile due to TS void-return bivariance
  biName?: string; // type-optional; project convention is to ALWAYS set it (see Implementation Rules)
  disabled?: boolean;
  hidden?: boolean;
  tooltip?: string;
  skin?: string; // recommended values: 'standard' | 'inverted' | 'premium' | 'dark' | 'destructive'
}
```

## Validation Logic
- **IF** `disabled` is true **THEN** `tooltip` is **RECOMMENDED**.
- **IF** implementing a custom action **THEN** return object MUST match `ResolvedAction`.
- **IF** `biName` is provided **THEN** value MUST match configuration `biName`.

## Implementation Rules
- **MUST** include `label`, `icon`, `onClick`, and `biName`.
- **MUST** use valid icon element (e.g. `<Icon />`).
- **MUST** handle async `onClick` operations properly (use try/catch or SDK helpers).
- **SHOULD** use `hidden` for permission checks.
- **SHOULD** use `skin="destructive"` for delete/dangerous actions.

## Canonical Example
```typescript
// Resolver Function Return Value
return {
  label: 'Export',
  icon: <Download />,
  biName: 'export-action',
  onClick: async () => {
    // Action logic
  },
  disabled: !hasData,
  tooltip: !hasData ? 'No data to export' : undefined,
  skin: 'standard'
};
```
