# Entity Page Action Rules (Edit Mode)

## Type Definitions
```typescript
interface EntityPageConfig {
  entityPage: {
    actions: {
      moreActions: (CustomActionItem | DividerItem)[];
    };
  };
}

interface CustomActionItem {
  id: string; // Matches resolver name
  type: 'custom';
  label: string;
  biName: string; // MANDATORY
}

interface DividerItem {
  type: 'divider';
}

// Resolver Type
type CustomEntityPageActionResolver = (params: {
  actionParams: {
    entity: any; // Current entity data
    form: UseFormReturn; // react-hook-form instance
  };
  sdk: AutoPatternsSDK;
}) => ResolvedAction;
```

## Validation Logic
- **IF** mode is `'edit'` **THEN** ONLY `moreActions` is supported (`primaryActions` forbidden).
- **IF** `type: 'custom'` **THEN** `id` MUST match exported resolver name.
- **IF** `type: 'divider'` **THEN** NO other properties allowed.
- **ONLY** `'custom'` and `'divider'` are valid action types in moreActions. There is NO built-in `'duplicate'`, `'copy'`, `'clone'`, `'archive'`, `'export'`, or similar action type.
- **IF** you need any operation beyond navigation (duplicate, archive, export, share, etc.) **THEN** use `type: 'custom'` with a resolver implementation.

## Implementation Rules
- **MUST** place all custom actions in `moreActions` array for Edit Mode.
- **MUST** include `biName` for every action.
- **MUST** return a valid `ResolvedAction` object (see resolved_action.md).
- **MUST** use `errorHandler` for Wix API calls.
- **NEVER** use `primaryActions` or `secondaryActions` in Edit Mode.

## Canonical Example
```typescript
// Config
{
  moreActions: [
    { id: 'sendEmail', type: 'custom', label: 'Send Email', biName: 'send-email-action' },
    { type: 'divider' },
    { id: 'archive', type: 'custom', label: 'Archive', biName: 'archive-action' }
  ]
}

// components/actions/sendEmail.tsx (use .tsx because it contains JSX icon)
export const sendEmail: CustomEntityPageActionResolver = ({ actionParams, sdk }) => {
  return {
    label: 'Send Email',
    icon: <EmailIcon />,
    biName: 'send-email-action',
    onClick: () => {
      // Logic here
    }
  };
};
```
