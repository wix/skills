# Parameter Patterns

Reference for all function registration parameter patterns. Read this when implementing functions with complex parameter types.

## Functions with Data Parameters

```typescript
functions: {
  capitalize: {
    parameters: [
      {
        dataType: 'text',
        displayName: 'Text to capitalize',
      },
    ],
    returns: {
      dataType: 'text',
    },
    async: false,
  },
}
```

## Functions with Optional Parameters

```typescript
functions: {
  greet: {
    parameters: [
      {
        dataType: 'text',
        displayName: 'Name',
      },
      {
        dataType: 'text',
        displayName: 'Greeting',
        optional: true,
        defaultValue: 'Hello',
      },
    ],
    returns: {
      dataType: 'text',
    },
    async: false,
  },
}
```

## Functions with Complex Object Parameters

When a function accepts a structured object, use `dataType: 'data'` with a nested `data.items` map:

```typescript
functions: {
  formatUser: {
    parameters: [
      {
        dataType: 'data',
        displayName: 'User Data',
        data: {
          items: {
            firstName: { dataType: 'text', displayName: 'First Name' },
            lastName: { dataType: 'text', displayName: 'Last Name' },
            age: { dataType: 'number', displayName: 'Age' },
          },
        },
      },
    ],
    returns: { dataType: 'text' },
    async: false,
  },
}
```

## Functions with Array Parameters

```typescript
functions: {
  sum: {
    parameters: [
      {
        dataType: 'arrayItems',
        displayName: 'Numbers',
        arrayItems: {
          item: { dataType: 'number' },
        },
      },
    ],
    returns: { dataType: 'number' },
    async: false,
  },
}
```

Arrays can contain complex objects:

```typescript
functions: {
  calculateTotal: {
    parameters: [
      {
        dataType: 'arrayItems',
        displayName: 'Products',
        arrayItems: {
          item: {
            dataType: 'data',
            data: {
              items: {
                price: { dataType: 'number', displayName: 'Price' },
                quantity: { dataType: 'number', displayName: 'Quantity' },
              },
            },
          },
        },
      },
    ],
    returns: { dataType: 'number' },
    async: false,
  },
}
```

## Functions with TextEnum Parameters

```typescript
functions: {
  getNextStatus: {
    parameters: [
      {
        dataType: 'textEnum',
        displayName: 'Current Status',
        textEnum: {
          options: [
            { value: 'pending', displayName: 'Pending' },
            { value: 'processing', displayName: 'Processing' },
            { value: 'completed', displayName: 'Completed' },
          ],
        },
      },
    ],
    returns: {
      dataType: 'textEnum',
      textEnum: {
        options: [
          { value: 'processing', displayName: 'Processing' },
          { value: 'completed', displayName: 'Completed' },
        ],
      },
    },
    async: false,
  },
}
```

## Async Functions

Set `async: true` and define a `returns` type. The implementation must return a `Promise`:

```typescript
functions: {
  fetchData: {
    parameters: [
      { dataType: 'webUrl', displayName: 'URL' },
    ],
    returns: { dataType: 'text' },
    async: true,
  },
}
```

## Void Functions

Omit the `returns` field entirely:

```typescript
functions: {
  logMessage: {
    parameters: [
      { dataType: 'text', displayName: 'Message' },
    ],
    async: false,
  },
}
```

## DOM Event Parameters

Function libraries can accept DOM events as parameters.

Instead of `dataType`, set `domEvent` on a parameter to receive the raw browser event:

| Event Type | DOM Object | Use For |
|------------|------------|---------|
| `POINTER` | PointerEvent | Clicks, taps, drag starts |
| `CHANGE` | Event | Input value changes |
| `KEYBOARD` | KeyboardEvent | Key presses, shortcuts |
| `FOCUS` | FocusEvent | Focus/blur |
| `SUBMIT` | SubmitEvent | Form submissions |

### Basic DOM Event Parameter

```typescript
functions: {
  handleClick: {
    parameters: [
      {
        domEvent: 'POINTER',
        displayName: 'Click Event',
      },
    ],
    async: false,
  },
}
```

### Change Event with InputType

When `domEvent` is `CHANGE`, the optional `changeEvent` field declares where the meaningful value resides in the event object:

```typescript
functions: {
  onSearchChange: {
    parameters: [
      {
        domEvent: 'CHANGE',
        changeEvent: { inputType: 'text' },
        displayName: 'Search Input Change',
      },
    ],
    returns: { dataType: 'text' },
    async: false,
  },
  onToggleChange: {
    parameters: [
      {
        domEvent: 'CHANGE',
        changeEvent: { inputType: 'checkbox' },
        displayName: 'Toggle Change',
      },
    ],
    returns: { dataType: 'booleanValue' },
    async: false,
  },
}
```

Available `inputType` values:
- `text` — value at `target.value` (string)
- `checkbox` — value at `target.checked` (boolean)
- `number` — value at `target.valueAsNumber` (number)
- `date` — value at `target.valueAsDate` (Date)

## Code Quality Requirements

- Strict TypeScript with no `any` types
- Explicit return types for all functions
- Proper null/undefined handling with optional chaining
- SSR-safe code (no browser APIs at module scope)
- No `@ts-ignore` comments
- Use `const`/`let` (no `var`)
- Functions should be pure where possible — avoid side effects except for intentional logging or event handling
