---
name: wix-cli-context-provider
description: "Use when building context provider components that expose shared state and functionality to child components in Wix CLI applications. Triggers include context provider, shared state, context hook, useContext, provider component, context API."
compatibility: Requires Wix CLI development environment.
---

# Wix Context Provider Builder

Creates production-quality context provider components for Wix CLI applications. Context providers are logical components (no UI) that can be added to any page, container, or section in the Editor. They expose shared state and functionality that child components consume via a React hook.

**You MUST read [CONTEXT_PROVIDER_SPEC.md](references/CONTEXT_PROVIDER_SPEC.md) before implementing a context provider.** It contains the complete manifest structure, all data types, and type constraints.

## Consumer Constraint

**⚠️ Only site components (`wix-cli-site-component`) can consume context provider extensions.** Site widgets, site plugins, and all other extension types are NOT supported as consumers.

**⚠️ Consumer site components require valid manifests.** When creating a site component to consume this context provider, you MUST follow the [wix-cli-site-component](../wix-cli-site-component/SKILL.md) skill, including its Hard Constraints.

## Quick Start Checklist

Follow these steps in order when creating a context provider:

1. [ ] Install `@wix/public-schemas` as a devDependency
2. [ ] Install `@wix/services-manager-react` and `@wix/services-definitions` if not already present
3. [ ] Create provider folder: `src/extensions/{provider-name}/`
4. [ ] Create `provider.tsx` with React context, hook export, provider component, and RichText support for all text/number values
5. [ ] Register in `src/extensions.ts` using `experimentalExtensions.contextProvider()` — include both plain and richText context items
6. [ ] Ensure consumer components are **site components** with `contextDependencies` in their registration

## Architecture

Context providers consist of **two required parts**:

### 1. Provider Component (`provider.tsx`)

A React component that:

- Creates a React context using `createContext`
- Exports a hook for child components (e.g., `useCounterContext`)
- Exports the provider component as the `default` export
- Accepts configuration props defined in the `data` field of the registration
- Provides state and functions to child components via context
- Optionally exports `injectAccessTokenGetter` for access token injection

### 2. Extension Registration (in `src/extensions.ts`)

Registers the context provider with the app builder using `experimentalExtensions.contextProvider()`, defining:

- The context model (what values/functions are exposed)
- The data model (what configuration props the provider accepts)
- The resource URLs (where to load the component bundle)
- The context specifier (hook name and optional module specifier)

## Provider Component Pattern

```typescript
import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useService } from '@wix/services-manager-react';
import { SignalsServiceDefinition } from '@wix/services-definitions/core-services/signals';
import type { Text } from '@wix/public-schemas';

// 1. Define the context type interface (use @wix/public-schemas types, not plain primitives)
export interface MyContextType {
  someValue: Text;
  someAction: () => void;
}

// 2. Define the provider props interface (matches `data` in registration)
export interface MyProviderProps {
  children?: React.ReactNode;
  initialValue: Text;
}

// 3. Create the context (use null, not undefined)
const MyContext = createContext<MyContextType | null>(null);
MyContext.displayName = 'MyContext';

// 4. Export the hook
export function useMyContext(): MyContextType {
  const context = useContext(MyContext);
  if (!context) {
    throw new Error('useMyContext must be used within a MyProvider');
  }
  return context;
}

// 5. Export the provider component (also as default)
export function MyContextProvider({
  children,
  initialValue,
}: MyProviderProps): React.ReactNode {
  const signalsService = useService(SignalsServiceDefinition);
  const signal = useMemo(() => {
    return signalsService.signal(initialValue || '');
  }, [initialValue]);

  const someAction = () => {
    signal.set('updated');
  };

  const api: MyContextType = {
    someValue: signal.get(),
    someAction,
  };

  return (
    <MyContext.Provider value={api}>{children}</MyContext.Provider>
  );
}

MyContextProvider.displayName = 'MyContextProvider';
export default MyContextProvider;
```

### Key Rules for Provider Components

- **Always** create a `displayName` for both the context and the provider component
- **Always** export the hook as a named export
- **Always** export the provider as both a named export and `default`
- **Always** throw an error in the hook if used outside the provider
- **Always** accept `children` as a prop
- **Always** use types from `@wix/public-schemas` (e.g., `NumberType`, `Text`, `BooleanType`) instead of plain TypeScript primitives for context and props types
- Provider props correspond to the `data` entries in the extension registration
- Use `@wix/services-manager-react` with `SignalsServiceDefinition` from `@wix/services-definitions/core-services/signals` for reactive state management
- **Always** expose RichText versions of all text and number context values (see [RichText Support](#richtext-support-mandatory) below)

## RichText Support (Mandatory)

**Every context provider MUST expose RichText versions of all text and number context values.** This ensures both native hook consumers and Editor Binding consumers can connect values to rich text components (like Wix's built-in text elements). This is NOT optional — always provide both the plain value and its RichText equivalent.

### RichText Helper

Add a `toRichText` helper in the provider:

```typescript
type RichTextType = { text: string; html: string };

const toRichText = (value: string | number): RichTextType => ({
  text: `${value}`,
  html: `<div>${value}</div>`,
});
```

### Provider API

Expose both plain and richText versions in the context API object:

```typescript
const api = {
  count: signal.get(),
  richTextCount: toRichText(signal.get()),
  // ...other context items
};
```

### Registration

Register both the plain value and the richText version in `context.items`:

```typescript
context: {
  items: {
    count: {
      dataType: 'number',
      displayName: 'Counter Value',
    },
    richTextCount: {
      dataType: 'data',
      displayName: 'Counter Value (Rich Text)',
      data: {
        items: {
          text: { dataType: 'text' },
          html: { dataType: 'text' },
        },
      },
    },
  },
}
```

### Context Type Interface

Include both versions in the context type:

```typescript
export interface MyContextType {
  count: NumberType;
  richTextCount: { text: string; html: string };
  // ...functions, other values
}
```

Exposing both gives consumers maximum flexibility — native hook consumers use the plain value directly, while Editor Binding consumers can connect the richText version to text elements.

## Extension Registration

**Extension registration is MANDATORY.**

### Import Requirements

Context providers use the **experimental** extensions builder:

```typescript
import { extensions as experimentalExtensions } from '@wix/astro/builders/experimental';
```

This is different from standard extensions which use `import { extensions } from '@wix/astro/builders'`.

### Registration Pattern

```typescript
import { app } from '@wix/astro/builders';
import { extensions as experimentalExtensions } from '@wix/astro/builders/experimental';

export default app()
  .use(
    experimentalExtensions.contextProvider({
      id: '{{GENERATE_UUID}}',
      type: 'appSlug.ContextTypeName',
      context: {
        items: {
          // Context values exposed to children
        },
      },
      data: {
        // Configuration props for the provider
      },
      resources: {
        client: {
          url: './extensions/{provider-name}/provider.tsx',
        },
        contextSpecifier: {
          hook: 'useMyContext',
          moduleSpecifier: 'my-package-name',
        },
      },
    })
  );
```

### Registration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID v4) | Yes | Unique identifier. Generate a fresh UUID for each provider |
| `type` | string | Yes | Namespaced component type: `slug.ComponentName` (max 100 chars) |
| `context` | object | Yes | The context model — what values/functions are exposed |
| `data` | object | Yes | Configuration props the provider accepts in the Editor |
| `resources` | object | Yes | Runtime bundles and context specifier |
| `displayName` | string | No | Human-friendly name (max 50 chars) |
| `description` | string | No | Public description (max 300 chars) |

**CRITICAL: UUID Generation** — The `id` must be a unique, static UUID v4 string. Generate a fresh UUID for each extension. Do NOT use `randomUUID()` or copy UUIDs from examples.

### Context Items

The `context.items` map defines what the provider exposes to child components. Each item requires a `dataType`. See [CONTEXT_PROVIDER_SPEC.md](references/CONTEXT_PROVIDER_SPEC.md) for all ContextItem fields and constraints.

### ⚠️ CRITICAL: `context` vs `data` Array Format Difference

The `context` section and `data` section use **different types** for array items. Mixing them up causes the runtime error `arrayItems is missing arrayItems.item or arrayItems.dataItem with dataType`.

| Section | Type | Array item key | Example |
|---------|------|---------------|---------|
| `context` | `ContextArrayItems` | `item` | `arrayItems: { item: { dataType: 'text' } }` |
| `data` | `ArrayItems` | `dataItem` | `arrayItems: { dataItem: { dataType: 'text' } }` |

**In `context` arrays** — use `arrayItems.item` (a `ContextItem`):

```typescript
context: {
  items: {
    myList: {
      dataType: 'arrayItems',
      arrayItems: {
        item: { dataType: 'text' },  // ← "item" for context
      },
    },
  },
}
```

**In `data` arrays** — use `arrayItems.dataItem` (a `DataItem`):

```typescript
data: {
  initialList: {
    dataType: 'arrayItems',
    arrayItems: {
      dataItem: { dataType: 'text' },  // ← "dataItem" for data
    },
  },
}
```

### Context with Functions

```typescript
context: {
  items: {
    addItem: {
      dataType: 'function',
      displayName: 'Add Item',
      function: {
        parameters: [
          { dataType: 'text', displayName: 'Item ID', description: 'The ID of the item to add' },
          { dataType: 'number', displayName: 'Quantity', description: 'Number of items to add', optional: true },
        ],
        async: false,
      },
    },
    checkout: {
      dataType: 'function',
      displayName: 'Checkout',
      function: {
        parameters: [{ dataType: 'text', displayName: 'Payment Method' }],
        returns: {
          dataType: 'data',
          data: {
            items: {
              success: { dataType: 'booleanValue' },
              orderId: { dataType: 'text' },
            },
          },
        },
        async: true,
      },
    },
  },
}
```

### Context with Arrays

```typescript
context: {
  items: {
    products: {
      dataType: 'arrayItems',
      displayName: 'Product List',
      arrayItems: {
        item: {
          dataType: 'data',
          data: {
            items: {
              name: { dataType: 'text', displayName: 'Name' },
              price: { dataType: 'number', displayName: 'Price' },
            },
          },
        },
      },
    },
  },
}
```

Arrays can be nested — use `dataType: 'arrayItems'` inside another array's `item` to create multi-dimensional structures (e.g., a 2D grid).

### Context with TextEnum

```typescript
context: {
  items: {
    tier: {
      dataType: 'textEnum',
      displayName: 'Subscription Tier',
      textEnum: {
        options: [
          { value: 'basic', displayName: 'Basic' },
          { value: 'premium', displayName: 'Premium' },
          { value: 'enterprise', displayName: 'Enterprise' },
        ],
      },
    },
  },
}
```

### Context Implementor

Delegates part of the context to a separate component. Useful for item-level contexts with scoped functions (e.g., `setAsCurrentItem`).

```typescript
data: {
  items: {
    id: { dataType: 'text', displayName: 'Item ID' },
    name: { dataType: 'text', displayName: 'Name' },
  },
  contextImplementor: {
    componentType: 'appSlug.lineItemContext',
    propKey: 'lineItemData',
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
| `resources.contextSpecifier.moduleSpecifier` | string | No | An identifier for the context module. Does not have to be an NPM package. Consumers import the hook from this name and declare it in `contextDependencies` |

### Child Component Dependencies

Consumer site components must declare the dependency (see [Consumer Constraint](#consumer-constraint) above):

```typescript
extensions.siteComponent({
  // ...
  resources: {
    client: {
      componentUrl: './extensions/my-component/component.tsx',
    },
    dependencies: {
      contextDependencies: ['my-package-name'],
    },
  },
});
```

The `contextDependencies` array references the `moduleSpecifier` from the context provider's `contextSpecifier`.

## Complete Example

### Counter Context Provider

**`src/extensions/context-provider/provider.tsx`**:

```typescript
import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useService } from '@wix/services-manager-react';
import { SignalsServiceDefinition } from '@wix/services-definitions/core-services/signals';
import type { NumberType } from '@wix/public-schemas';

type RichTextType = { text: string; html: string };

const toRichText = (value: string | number): RichTextType => ({
  text: `${value}`,
  html: `<div>${value}</div>`,
});

export interface CounterContextType {
  count: NumberType;
  richTextCount: RichTextType;
  decrement: () => void;
  increment: () => void;
  setCount: (count: NumberType) => void;
}

export interface CounterProviderProps {
  children?: React.ReactNode;
  initialCount: NumberType;
}

const CounterContext = createContext<CounterContextType | null>(null);
CounterContext.displayName = 'CounterContext';

export function useCounterContext(): CounterContextType {
  const context = useContext(CounterContext);
  if (!context) {
    throw new Error('useCounterContext must be used within a CounterProvider');
  }
  return context;
}

export function CounterContextProvider({
  children,
  initialCount,
}: CounterProviderProps): React.ReactNode {
  const signalsService = useService(SignalsServiceDefinition);
  const count = useMemo(() => {
    return signalsService.signal(initialCount || 0);
  }, [initialCount]);

  const setCount = (value: NumberType) => {
    count.set(value);
  };
  const increment = () => { setCount(count.peek() + 1); };
  const decrement = () => { setCount(count.peek() - 1); };

  const api: CounterContextType = {
    count: count.get(),
    richTextCount: toRichText(count.get()),
    decrement,
    increment,
    setCount,
  };

  return (
    <CounterContext.Provider value={api}>{children}</CounterContext.Provider>
  );
}

CounterContextProvider.displayName = 'CounterContextProvider';
export default CounterContextProvider;
```

**Registration in `src/extensions.ts`**:

```typescript
import { app } from '@wix/astro/builders';
import { extensions as experimentalExtensions } from '@wix/astro/builders/experimental';

export default app()
  .use(
    experimentalExtensions.contextProvider({
      id: '20c6e0a1-6d3f-4da1-96a3-9cd9fabde1e9',
      type: '<codeIdentifier>.TestContextType',
      context: {
        items: {
          count: {
            dataType: 'number',
            displayName: 'Counter current value',
          },
          richTextCount: {
            dataType: 'data',
            displayName: 'Counter Value (Rich Text)',
            data: {
              items: {
                text: { dataType: 'text' },
                html: { dataType: 'text' },
              },
            },
          },
          decrement: {
            dataType: 'function',
            displayName: 'Decrement counter value by 1',
            function: {
              parameters: [],
              async: false,
            },
          },
          increment: {
            dataType: 'function',
            displayName: 'Increment counter value by 1',
            function: {
              parameters: [],
              async: false,
            },
          },
          setCount: {
            dataType: 'function',
            displayName: 'Set counter value to a specific number',
            function: {
              parameters: [
                {
                  dataType: 'number',
                  displayName: 'Count Value',
                },
              ],
              async: false,
            },
          },
        },
      },
      data: {
        initialCount: {
          dataType: 'number',
          defaultValue: 0,
          deprecated: false,
          displayName: 'Initial Count',
        },
      },
      resources: {
        client: {
          url: './extensions/context-provider/provider.tsx',
        },
        contextSpecifier: {
          hook: 'useCounterContext',
          moduleSpecifier: 'my-counter-context',
        },
      },
    })
  );
```

**Consumer component declaring the dependency**:

```typescript
extensions.siteComponent({
  id: '4294f79c-e7b7-47d4-98b7-e33822051fed',
  type: '<codeIdentifier>.MyClicker',
  description: 'My Clicker Component',
  resources: {
    client: {
      componentUrl: './extensions/clicker-with-context/component.tsx',
    },
    dependencies: {
      contextDependencies: ['my-counter-context'],
    },
  },
});
```

**Consumer component (`src/extensions/clicker-with-context/component.tsx`)**:

```typescript
import React from 'react';
//@ts-expect-error will be generated
import { useCounterContext } from 'my-counter-context';
//@ts-expect-error will be generated
import type { CounterContextType } from 'my-counter-context';
import './component.css';

interface Props {
  id: string;
  className: string;
  text?: string;
}

export default function Clicker(props: Props) {
  const { count, increment } = useCounterContext() as CounterContextType;
  const finalClassName = `clicker ${props.className ?? ''}`;

  return (
    <div className={finalClassName} id={props.id}>
      <span>Count: {count}</span>
      <button onClick={() => increment()}>
        {props.text ?? 'CLICK'}
      </button>
    </div>
  );
}
```

### Consumer Component Rules

- Consumers must be **site components** (see [Consumer Constraint](#consumer-constraint) above).
- **Import the hook AND context type from the `moduleSpecifier`.** Both require `@ts-expect-error` since the module is generated at build time. Do NOT redeclare the context type locally or import it from the provider's file path.
  ```typescript
  //@ts-expect-error will be generated
  import { useCounterContext } from 'my-counter-context';
  //@ts-expect-error will be generated
  import type { CounterContextType } from 'my-counter-context';

  const { count, increment } = useCounterContext() as CounterContextType;
  ```
- **Import `Wix` type from `@wix/public-schemas`** — Use `import type { Wix } from '@wix/public-schemas'` for the `wix` prop. Do NOT define a local `Wix` type.
- **Context values are plain values** — The provider resolves signal values via `.get()` before exposing them. Consumers use values directly (e.g., `count`, not `count.value`).
- **Use `finalClassName`** — Combine the `editorElement.selector` class (without the `.`) with `props.className`: ``const finalClassName = `clicker ${props.className ?? ''}` ``
- The consumer's registration must include `contextDependencies` referencing the provider's `moduleSpecifier`.

## Editor Binding (Alternative Consumption)

In addition to Native usage (importing the hook), context can be consumed via **Editor Binding**. This allows components to receive context data and methods as props, without importing the hook or having a direct dependency on the provider's bundle. The editor UI lets users connect a component's props to a context provided by any component above it in the React tree.

From the component's perspective, Editor Binding is identical to receiving static props — the component doesn't know or care whether the values come from context or direct configuration.

### When to use Editor Binding

- The consumer doesn't need direct access to the provider's bundle
- You want any component (not just those with `contextDependencies`) to consume context
- The context data should be wired up by the site owner in the editor UI

### Consumer component using Editor Binding

The component receives context as a regular prop:

```typescript
import React from 'react';
import type { NumberType, Text } from '@wix/public-schemas';

interface CounterProps {
  incrementText?: Text;
  decrementText?: Text;
  // Context injected as a prop by editor binding
  counter?: {
    increment: () => void;
    decrement: () => void;
    setCount: (value: NumberType) => void;
    count: NumberType;
  };
}

export default function CounterDisplay({
  incrementText = '+',
  decrementText = '-',
  counter,
}: CounterProps) {
  if (!counter) {
    return <div>Counter context not available</div>;
  }

  const { increment, decrement, count } = counter;

  return (
    <div>
      <span>{count}</span>
      <button onClick={increment}>{incrementText}</button>
      <button onClick={decrement}>{decrementText}</button>
    </div>
  );
}
```

### Consumer manifest for Editor Binding

The context shape is declared in the component's `data` using `dataType: 'data'`:

```json
{
  "type": "appSlug.CounterDisplay",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/counter-display.js"
    }
  },
  "editorElement": {
    "selector": ".counter-display",
    "displayName": "Counter Display",
    "data": {
      "incrementText": {
        "dataType": "text",
        "displayName": "Increment Button Text"
      },
      "decrementText": {
        "dataType": "text",
        "displayName": "Decrement Button Text"
      },
      "counter": {
        "dataType": "data",
        "displayName": "Counter Context",
        "data": {
          "items": {
            "increment": {
              "dataType": "function",
              "displayName": "Increment Function",
              "function": { "parameters": [], "async": false }
            },
            "decrement": {
              "dataType": "function",
              "displayName": "Decrement Function",
              "function": { "parameters": [], "async": false }
            },
            "setCount": {
              "dataType": "function",
              "displayName": "Set Count Function",
              "function": {
                "parameters": [
                  { "dataType": "number", "displayName": "Count Value" }
                ],
                "async": false
              }
            },
            "count": {
              "dataType": "number",
              "displayName": "Current Count"
            }
          }
        }
      }
    }
  }
}
```

Note that Editor Binding consumers do **not** need `contextDependencies` in their registration — the binding is configured by the user in the editor.

### RichText Support for Editor Binding

RichText versions of context values are **always provided** (see [RichText Support (Mandatory)](#richtext-support-mandatory)). Editor Binding consumers can connect these richText context items to Wix's built-in text elements without any additional setup.

## Output Structure

```
src/extensions/{provider-name}/
└── provider.tsx          # Context provider component with hook
```

## Code Quality Requirements

- Strict TypeScript with no `any` types
- Explicit return types for all functions
- Proper null/undefined handling with optional chaining
- Functional components with hooks
- Use `@wix/services-manager-react` and `@wix/services-definitions/core-services/signals` for reactive state
- SSR-safe code (no browser APIs at module scope)
- Always set `displayName` on context and provider
- No `@ts-ignore` comments. `@ts-expect-error` is only allowed for the generated `moduleSpecifier` import in consumer components
- Use `const`/`let` (no `var`)

## Hard Constraints

- **Import `experimentalExtensions`** from `@wix/astro/builders/experimental`, NOT from `@wix/astro/builders`
- Do NOT invent or assume new types, modules, or imports
- The `type` field must be namespaced: `slug.ComponentName`
- Generate a fresh UUID v4 for each new context provider `id`
- Do NOT use disallowed data types (`UNKNOWN_DataType`, `schema`, `container`, `onClick`, `onChange`, `onKeyPress`, `onKeyUp`, `onSubmit`)
- All context items must have a `dataType`
- The hook name in `contextSpecifier.hook` must match the exported hook in `provider.tsx`
- NEVER use mocks, placeholders, or TODOs in any code
- ALWAYS implement complete, production-ready functionality
- ALWAYS expose RichText versions (`{ text, html }`) of all text and number context values — this is mandatory, not optional

## Reference Documentation

- [Context Provider Specification](references/CONTEXT_PROVIDER_SPEC.md) - Complete manifest structure, all types, and constraints
