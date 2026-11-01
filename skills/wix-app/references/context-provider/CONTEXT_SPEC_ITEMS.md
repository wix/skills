# Context Provider Specification: Context and Items

## Context

Defines the context model exposed by the context provider component.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| items | map<string, ContextItem> | A map of keys describing the context provided by this component | Required |

## ContextSpecifier

Specifies how to use the context this component provides in React.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| moduleSpecifier | string | An identifier for the context module. Does not have to be an NPM package. Unique across all of Wix, so it must be `<moduleSpecifierPrefix><provider-kebab-case-name>` (`@/` by default, or the prefix the user gives you). Cannot be renamed once registered | Required, must start with `<moduleSpecifierPrefix>`, maxLength: 100 |
| hook | string | The exported hook for components usage (e.g., `useSomeContextName`) | Required, maxLength: 100 |

## ContextItem

Defines a single context item that can be provided by the context provider.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| dataType | DataType | The type exposed by the context item | Required |
| displayName | string | The display name of the context item for user facing and AI usage | Optional, maxLength: 100, translatable |
| description | string | A description of the context item for user facing and AI usage | Optional, maxLength: 300, translatable |
| contextImplementor | ContextImplementor | For sub types that implement parts of context, points to a context provider component type | Optional |
| arrayItems | ContextArrayItems | For arrays, the items are defined here | Only used when dataType is arrayItems |
| data | ContextDataItems | For data objects, the items are defined here | Only used when defining a complex object structure |
| function | EditorFunction | For functions, the function definition is defined here | Only used when dataType is function |
| textEnum | TextEnum | A required list of options to supply to the users to choose from | Only used when dataType is textEnum |
| deprecated | boolean | Will be set to true in case an item has been removed from the Context | Optional, internal |

### Disallowed Data Types

The following dataTypes are NOT allowed for context items or data props:

- `UNKNOWN_DataType`
- `schema`
- `container`
- `onClick` (deprecated — expose a `function` item and let the element's click handler bind to it)
- `onChange` (deprecated — expose a `function` item and let the element's change handler bind to it)
- `onKeyPress` (deprecated)
- `onKeyUp` (deprecated)
- `onKeyDown` (deprecated)
- `onFocus` (deprecated)
- `onSubmit` (deprecated)

`DataType` is a closed enum: every `dataType` — on context items, data items, function parameters and return types — must be one of the values in the table below. The checkpoint validates the manifest against this enum and rejects anything else with `INVALID_ARGUMENT` (`value 'pointerEvent' does not match any of the allowed values`), after the build has already passed. A function bound to an element's event handler declares `parameters: []`; the DOM event is not a parameter and has no data type.

### Available Data Types

| Type | Runtime Value | Use Case |
|------|---------------|----------|
| `text` | string | Names, IDs, labels |
| `textEnum` | string | Predefined option sets |
| `number` | number | Counts, quantities, dimensions |
| `booleanValue` | boolean | Toggles, flags |
| `a11y` | object | Accessibility attributes |
| `link` | `{ href, target, rel }` | Navigation links |
| `image` | Image object | Image data |
| `video` | Video object | Media content |
| `vectorArt` | SVG object | Icons, graphics |
| `audio` | Audio object | Audio content |
| `localDate` | string (YYYY-MM-DD) | Date values |
| `localTime` | string (hh:mm[:ss][.sss]) | Time values |
| `localDateTime` | string (YYYY-MM-DDThh:mm[:ss][.sss]) | Date-time values |
| `webUrl` | string | URLs (http/https) |
| `email` | string | Email addresses (RFC 5321) |
| `phone` | string | Phone numbers |
| `hostname` | string | Hostname (IANA) |
| `regex` | string | Regex patterns |
| `guid` | string | Unique identifiers |
| `richText` | `RichText` from `@wix/editor-react-types` (`{ text, html, linkList }`) | Formatted content with inline styles |
| `arrayItems` | Array | Lists, collections |
| `direction` | string | HTML dir attribute (ltr/rtl) |
| `menuItems` | Array | Menu item collections |
| `data` | object | Complex nested objects |
| `function` | function | Actions, callbacks |
| `filter` | object | WQL filter (no matching type in `@wix/editor-react-types`) |
| `sort` | array | WQL sort definition (no matching type in `@wix/editor-react-types`) |

### Link configuration

For a `link` item or parameter, the optional `link` field limits the link types a Wix user can pick in the editor:

| Field | Required | Description |
|---|---|---|
| `linkTypes` | No | Allowed link types. Defaults to all supported types. |
| `appIds` | No | App IDs available for `dynamicPageLink` and `pageLink` values. |
| `hideInnerRoute` | No | Whether a dynamic page link can target only a top-level page. |

```typescript
{ dataType: 'link', displayName: 'Destination', link: { linkTypes: ['externalLink', 'pageLink'] } }
```

## ContextImplementor

A Context Implementor definition allows any part of a context to be **delegated** to a separate component. The referenced component provides a **new context** and may provide additional functionality that relies on the data from the original parent context. It may even use functionality from the parent to update its state.

This pattern is useful when an item-level context needs to provide **functions that modify parent state** (e.g., `setAsCurrentItem`, `removeItem`, `updateQuantity`).

When a `contextImplementor` is specified on a ContextItem or within ContextDataItems, the system will look for the referenced component (by `componentType`) in the component tree and delegate that portion of the context to it. The optional `propKey` specifies which prop the implementor component expects the context value to be passed through.

> A context implementor **must be** part of the same application.
| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| componentType | string | The component type that implements this part of the context. Must reference a valid registered component type of the same app | Required, maxLength: 100 |
| propKey | string | The prop key the implementor component expects the context to be passed in to it | Optional, maxLength: 100 |

## ContextArrayItems

Defines the structure of array items in the context. Specifies the type of data inside the array using a ContextItem, which can represent simple types, complex objects, nested arrays, or functions.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| item | ContextItem | Specifies the type of data inside the array | Required |

## ContextDataItems

A map of keys describing the context items provided by this component. Used for defining complex object structures in context.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| items | map<string, ContextItem> | A map of keys describing the data items provided by this component | Required |
| contextImplementor | ContextImplementor | For sub types that implement parts of context, points to a context provider component type | Optional |
