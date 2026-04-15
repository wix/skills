# Auto-Patterns Core Rules

## Logic
### Configuration Generation
1. **Analyze** schema requirements.
2. **Select** fields based on data types (max 3 initially).
3. **Validate** against Core Rules.

### Enum Handling
- **IF** `enumConfig` is required (implicit or explicit):
    - **THEN** ASK user for possible option values.
    - **THEN** Derive `label` from `value` (e.g., "dog" -> "Dog") unless specified.
    - **NEVER** guess or invent enum values.

## Constraints
### Structural Limits
- **MUST** have exactly 2 pages in `pages` array (`collectionPage` + `entityPage`).
- **MUST** have exactly 1 component with `layout` array in `collectionPage`.
- **MUST** use TypeScript for configuration.

### Field Selection
- **MAX** 3 columns initially for `collectionPage`.
- **MUST** include `create` action in `collectionPage` navigating to `entityPage`.
- **NEVER** fill optional fields unless explicitly requested.

### Type Binding
- **IF** `type: 'collectionPage'` **THEN** only `collectionPage` field allowed.
- **IF** `type: 'entityPage'` **THEN** only `entityPage` field allowed.
- **NEVER** mix types in single page config.

### Validation
- **MUST** align with `AppConfig` structure.
- **MUST** remove unsupported configuration entries.
