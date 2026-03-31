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
