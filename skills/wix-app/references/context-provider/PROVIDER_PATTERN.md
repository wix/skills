# Provider Component Pattern

## Provider Component Pattern

```typescript
import React, { createContext, useContext, useState } from 'react';
import type { Text } from '@wix/editor-react-types';

// 1. Define the context type interface (use @wix/editor-react-types types, not plain primitives)
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
  const [someValue, setSomeValue] = useState<Text>(initialValue || '');

  const someAction = () => {
    setSomeValue('updated');
  };

  const api: MyContextType = {
    someValue,
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

- **Always** create a `displayName` for both the context and the provider component — for human readability
- **Always** export the hook as a named export — the manifest's `contextSpecifier.hook` field references it by name
- **Always** export the provider as both a named export and `default` — the Wix runtime loads the context provider via its default export
- **Always** throw an error in the hook if used outside the provider — this surfaces a clear message rather than silently returning `null`. Keep it throwing when a consumer hits the error; fix the consumer's placement instead (see [When the Hook Throws](CONSUMING.md#when-the-hook-throws))
- **Always** accept `children` as a prop — the provider wraps whatever the Editor places inside it (page, container, or section content) in the React tree
- **Always** use types from `@wix/editor-react-types` (e.g., `NumberType`, `Text`, `BooleanValue`) instead of plain TypeScript primitives — these types match the actual runtime format Wix provides to components as props, so using plain primitives creates a type mismatch
- Provider props correspond to the `data` entries in the extension registration
- **Do not copy a `data` prop into state the provider never changes** — read it straight from props. A `data` prop is edited in the Editor panel, and `useState(prop)` keeps only the value it saw on mount, so the panel edit never reaches the page. Copy it into state only when the provider itself writes to that value, and name the prop for what it is (`initialValue`) so the seed-once behavior is intended rather than a surprise

## The Provider's Shape Never Shrinks

Regardless of what the current request asks for:

- **Always export the hook and register `contextSpecifier`.** A request phrased "use native elements, do not create an editor react component" constrains the *consumers*, never the provider's shape. `contextSpecifier.hook` is a required manifest field — dropping the hook export or `contextSpecifier` breaks the manifest for every consumer.
- **Keep the raw values alongside the derived ones.** `count` stays for the text element that displays it; `isCongratsBannerHidden` is added for the element gated on it. Derived items are additive — they never replace the state they are derived from.

Exposing an item costs nothing: a consumer can ignore any item it does not need.

## Async Data and the Render Gate

A provider makes **one binary decision for its whole subtree**: while its initial data is unresolved, nothing inside it renders — including children bound to nothing at all. Awaiting a promise without handling this ships a **blank page on load**.

**This applies to every promise — every Wix SDK call, every `fetch`, every `await`, however fast it usually resolves.** A quick call is not an exemption: it still resolves after the first render, so the gate still closes. If producing any context value involves a promise, you **MUST** read [LOADING.md](LOADING.md) and build the provider the way it describes.
