---
name: wix-cli-context-provider
description: "Use when building context provider components that expose shared state and functionality to child components in Wix CLI applications. Triggers include context provider, shared state, context hook, useContext, provider component, context API."
compatibility: Requires Wix CLI development environment.
---

# Wix Context Provider Builder

Creates production-quality context provider components for Wix CLI applications. Context providers are logical components (no UI) that can be added to any page, container, or section in the Editor. They expose shared state and functionality that child components consume via a React hook.

**You MUST read [CONTEXT_PROVIDER_SPEC.md](references/CONTEXT_PROVIDER_SPEC.md) before implementing a context provider.** It contains the complete manifest structure, all data types, and type constraints.

**For all context pattern examples, see [EXAMPLES.md](references/EXAMPLES.md).**

## Quick Start Checklist

Follow these steps in order when creating a context provider:

1. [ ] Install `@preact/signals-react` as a devDependency if not already present
2. [ ] Create provider folder: `src/extensions/{provider-name}/`
3. [ ] Create `provider.tsx` with React context, hook export, and provider component
4. [ ] Register in `src/extensions.ts` using `experimentalExtensions.contextProvider()`
5. [ ] Ensure child components declare `contextDependencies` in their registration

## Architecture

Context providers consist of **two required parts**:

### 1. Provider Component (`provider.tsx`)

A React component that:

- Creates a React context using `createContext`
- Exports a hook for child components (e.g., `useCounterContext`)
- Exports the provider component as the `default` export
- Accepts configuration props defined in the `data` field of the registration
- Provides state and functions to child components via context

### 2. Extension Registration (in `src/extensions.ts`)

Registers the context provider with the app builder using `experimentalExtensions.contextProvider()`, defining:

- The context model (what values/functions are exposed)
- The data model (what configuration props the provider accepts)
- The resource URLs (where to load the component bundle)
- The context specifier (hook name and optional module specifier)

## Provider Component Pattern

```typescript
import { useSignal } from '@preact/signals-react';
import type { Signal } from '@preact/signals-react';
import React, { createContext, useContext } from 'react';

// 1. Define the context type interface
export interface MyContextType {
  someValue: Signal<string>;
  someAction: () => void;
}

// 2. Define the provider props interface (matches `data` in registration)
export interface MyProviderProps {
  children?: React.ReactNode;
  initialValue: string;
}

// 3. Create the context
const MyContext = createContext<MyContextType | undefined>(undefined);
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
  const someValue = useSignal(initialValue || '');

  const someAction = () => {
    someValue.value = 'updated';
  };

  const api = { someValue, someAction };

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
- Provider props correspond to the `data` entries in the extension registration
- Use `@preact/signals-react` for reactive state management

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

### Context with Functions

```typescript
context: {
  items: {
    addItem: {
      dataType: 'function',
      displayName: 'Add Item',
      function: {
        parameters: [
          { dataType: 'text', displayName: 'Item ID' },
          { dataType: 'number', displayName: 'Quantity', optional: true },
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

### Context Implementor

Delegates part of the context to a separate component. Useful for item-level contexts with scoped functions (e.g., `setAsCurrentItem`). See [EXAMPLES.md](references/EXAMPLES.md) for the full order/line-item implementor example.

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
| `resources.contextSpecifier.moduleSpecifier` | string | No | Package name chosen by the app developer. Consumers import the hook from this name and declare it in `contextDependencies` |

### Child Component Dependencies

Any site component consuming a context provider must declare the dependency:

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
import { useSignal } from '@preact/signals-react';
import type { Signal } from '@preact/signals-react';
import React, { createContext, useContext } from 'react';

export interface CounterContextType {
  count: Signal<number>;
  decrement: () => void;
  increment: () => void;
  setCount: (count: number) => void;
}

export interface CounterProviderProps {
  children?: React.ReactNode;
  initialCount: number;
}

const CounterContext = createContext<CounterContextType | undefined>(undefined);
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
  const count = useSignal(initialCount || 0);

  const increment = () => { count.value += 1; };
  const decrement = () => { count.value -= 1; };
  const setCount = (value: number) => { count.value = value; };

  const api = { count, decrement, increment, setCount };

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
      type: 'neoApp.TestContextType',
      context: {
        items: {
          count: {
            dataType: 'number',
            displayName: 'Counter current value',
          },
          decrement: {
            dataType: 'function',
            displayName: 'Decrement counter value by 1',
          },
          increment: {
            dataType: 'function',
            displayName: 'Increment counter value by 1',
          },
          setCount: {
            dataType: 'function',
            displayName: 'Set counter value to a specific number',
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
  type: 'neoApp.MyClicker',
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
import React, { type FC } from 'react';
//@ts-expect-error will be generated
import { useCounterContext } from 'my-counter-context';
import type { CounterContextType } from '../context-provider/provider.tsx';

interface Props {
  id: string;
  className: string;
  text?: string;
}

const Clicker: FC<Props> = (props) => {
  const { count, increment } = useCounterContext() as CounterContextType;

  return (
    <div className={props.className} id={props.id}>
      <span>Count: {count.value}</span>
      <button onClick={() => increment()}>
        {props.text ?? 'CLICK'}
      </button>
    </div>
  );
};

export default Clicker;
```

### Consumer Component Rules

- **Import the hook from the `moduleSpecifier` package** (e.g., `my-counter-context`). This package is generated at build time, so the import requires `@ts-expect-error`:
  ```typescript
  //@ts-expect-error will be generated
  import { useCounterContext } from 'my-counter-context';
  ```
- **Import the context type directly** from the provider file for type safety, and cast the hook result:
  ```typescript
  import type { CounterContextType } from '../context-provider/provider.tsx';
  const { count, increment } = useCounterContext() as CounterContextType;
  ```
- **Access Signal values with `.value`** — Context values using `@preact/signals-react` are Signal objects. Read them in JSX with `count.value`, not `count`.
- The consumer's registration must include `contextDependencies` referencing the provider's `moduleSpecifier`.

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
- Use `@preact/signals-react` for reactive state
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

## Verification

After implementation, use [wix-cli-app-validation](../wix-cli-app-validation/SKILL.md) to validate TypeScript compilation, build, preview, and runtime behavior.

## Reference Documentation

- [Context Provider Specification](references/CONTEXT_PROVIDER_SPEC.md) - Complete manifest structure, all types, and constraints
- [Examples](references/EXAMPLES.md) - Full examples for every context pattern (simple, arrays, objects, functions, implementors, editor bundles, textEnums)
