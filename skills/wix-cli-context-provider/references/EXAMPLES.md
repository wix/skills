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

**Per-extension file (`src/extensions/context-provider/extensions.ts`)**:

```typescript
import { extensions as experimentalExtensions } from '@wix/astro/builders/experimental';

export const contextproviderCounterContext = experimentalExtensions.contextProvider({
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
});
```

**Main app file (`src/extensions.ts`)**:

```typescript
import { app } from '@wix/astro/builders';
import { contextproviderCounterContext } from './extensions/context-provider/extensions.ts';

export default app()
  .use(contextproviderCounterContext);
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
