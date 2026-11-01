# Context Provider Manifest and Binding

## The Manifest Is the Binding Contract

A binding-only consumer never sees the provider source. It decides what to wire from `displayName` and `description` alone, so those fields carry the whole meaning of the value.

- `displayName` names the element and the state the value represents.
- `description` states exactly when the value is true, and — for items meant to be bound — which element surface to bind it to.
- Both are translatable free text — `displayName` max 100 chars, `description` max 300.

## Extension Registration

The generated `<provider-kebab-case-name>.extension.ts` holds the manifest; fields are in [CONTEXT_PROVIDER_SPEC.md](CONTEXT_PROVIDER_SPEC.md).

### Context Items

The `context.items` map defines what the provider exposes to child components. Each item requires a `dataType`. See [CONTEXT_PROVIDER_SPEC.md](CONTEXT_PROVIDER_SPEC.md) for all ContextItem fields and constraints.

### ⚠️ CRITICAL: `context` vs `data` Array Format Difference

The `context` section and `data` section use **different types** for array items. Mixing them up causes the checkpoint error `arrayItems is missing arrayItems.item or arrayItems.dataItem with dataType`.

| Section | Type | Array item key | Example |
|---------|------|---------------|---------|
| `context` | `ContextArrayItems` | `item` | `arrayItems: { item: { dataType: 'text' } }` |
| `data` | `ArrayItems` | `dataItem` | `arrayItems: { dataItem: { dataType: 'text' } }` |

An array of objects follows the same rule in both sections: the object is the array element, so it goes under `item` (context) or `dataItem` (data) with `dataType: 'data'`. Never put `data: { items }` directly under `arrayItems`. Editor React Components accept that form, context providers reject it.

```typescript
// ✅ data section, array of objects
arrayItems: { dataItem: { dataType: 'data', data: { items: { title: { dataType: 'text' } } } } }
// ❌ fails the checkpoint
arrayItems: { data: { items: { title: { dataType: 'text' } } } }
```

### Context Item Shapes

Entries in `context.items` — functions, arrays, and enums (full type definitions in [CONTEXT_PROVIDER_SPEC.md](CONTEXT_PROVIDER_SPEC.md)):

```typescript
context: {
  items: {
    // function — sync or async, optional params, typed returns
    checkout: {
      dataType: 'function',
      displayName: 'Checkout',
      function: {
        parameters: [
          { dataType: 'text', displayName: 'Payment Method', description: 'How to pay' },
          { dataType: 'number', displayName: 'Tip', optional: true },
        ],
        returns: { dataType: 'data', data: { items: { success: { dataType: 'booleanValue' }, orderId: { dataType: 'text' } } } },
        async: true,
      },
    },
    // array of objects — nest another arrayItems inside `item` for multi-dimensional structures
    products: {
      dataType: 'arrayItems',
      displayName: 'Product List',
      arrayItems: {
        item: { dataType: 'data', data: { items: { name: { dataType: 'text' }, price: { dataType: 'number' } } } },
      },
    },
    // enum: at least 2 options; a single fixed value is `text` (with no `textEnum` key)
    tier: {
      dataType: 'textEnum',
      displayName: 'Subscription Tier',
      textEnum: { options: [{ value: 'basic', displayName: 'Basic' }, { value: 'premium', displayName: 'Premium' }] },
    },
  },
},
```

### Context Implementor

Delegates part of the context to a separate component. Useful for item-level contexts with scoped functions (e.g., `setAsCurrentItem`). `contextImplementor` belongs in the **`context`** section (on a `ContextItem` or inside a nested `ContextDataItems`) — never in `data`.

```typescript
context: {
  items: {
    lineItem: {
      dataType: 'data',
      data: {
        items: {
          id: { dataType: 'text', displayName: 'Item ID' },
          name: { dataType: 'text', displayName: 'Name' },
        },
        contextImplementor: {
          componentType: '<codeIdentifier>.lineItemContext',
          propKey: 'lineItemData',
        },
      },
    },
  },
},
```

The implementor component must be part of the same application and is rendered inside the parent's tree, giving it access to the parent context.

### Resources

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resources.client.url` | string | Yes | Path to the ESM bundle (provider component) |
| `resources.editor.url` | string | No | Path to editor-specific bundle (mock/default data) |
| `resources.contextSpecifier.hook` | string | Yes | The exported hook name (e.g., `useMyContext`) |
| `resources.contextSpecifier.moduleSpecifier` | string | Yes | `<moduleSpecifierPrefix><provider-kebab-case-name>` (max 100 characters). Registered Wix-wide, so it must carry the `<moduleSpecifierPrefix>` prefix; never change it once the provider exists. Does not have to be an NPM package |

### `componentType already exists` (code 2018)

**`Component type '<type>' is already registered by another component` (code 2018, `componentType already exists`).** The platform's background preview reports it. The `type` is built from `name` (`<codeIdentifier>.<camelCaseName>`) and is globally unique, so a second extension with the same name is rejected. Give the new extension a different `name` and `type`, and a different `moduleSpecifier` (never rename one that was already released).

## Editor Binding

Context is consumed via **Editor Binding**: a native Editor element receives context data and methods as props, without importing the hook or having a direct dependency on the provider's bundle. The editor UI lets the site owner connect an element's props to a context provided by any component above it in the React tree. From the element's perspective this is identical to receiving static props — it doesn't know or care whether the values come from context or direct configuration.

A native, non-React Wix Editor element already on the stage — a built-in Heading, Text, Button, Image — consumes context by having the site owner connect a context item to one of the element's surfaces:

| Element surface | Context item type to bind |
|---|---|
| `visibility.hidden` / `visibility.collapsed` / `visibility.removed` (`true` = not shown) | `booleanValue` |
| text content | `text` or `number` (converted to rich text by the platform) |
| click / event handler | `function` with `parameters: []` (the event is not a parameter) |

**One item, one surface, straight through** — the value reaches the element unchanged apart from the platform's automatic type conversion, with no expression layer in between. This is the constraint that governs what the provider must expose: see [Derived Values](DERIVED_VALUES.md#derived-values-mandatory) and [The Manifest Is the Binding Contract](#the-manifest-is-the-binding-contract) for how to describe each item so the right binding is chosen.

No consumer is written or registered for this path — the provider is the only code involved, and it is still registered exactly as always, hook export and `contextSpecifier` included. Plain `text` and `number` items connect to Wix's built-in text elements with no additional setup — the platform converts them to rich text at the binding (see [Plain Values, Not RichText Twins](DERIVED_VALUES.md#plain-values-not-richtext-twins)). A worked end-to-end example is in [EXAMPLES.md](EXAMPLES.md#counter-with-a-goal-gated-banner).

## Code Quality Requirements

The project-wide rules are in [CODE_QUALITY.md](../CODE_QUALITY.md). For a provider:

- Strict TypeScript with no `any` types
- Explicit return types for all functions
- Proper null/undefined handling with optional chaining
- Functional components with hooks
- SSR-safe code (no browser APIs at module scope)
- No `@ts-ignore` or `@ts-expect-error` comments, except the `// @ts-ignore` directly above an import of a context by its `moduleSpecifier` (see [Importing a Context in Code](CONSUMING.md#importing-a-context-in-code))
- Use `const`/`let` (no `var`)
