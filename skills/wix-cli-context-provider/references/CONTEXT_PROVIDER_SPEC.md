# Context Provider Specification

Complete specification for the EditorContextProvider manifest and all related types.

## EditorContextProvider

Defines a context provider component that can be added to any page, container, or section in the Editor. The component is logical and does not provide any UI, but it does provide props for configuring it in the Editor.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| type | string | The component type, should be namespaced: `slug.componentName` | Required, maxLength: 100 |
| resources | EditorContextProviderResources | The runtime information needed for this component | Required |
| context | Context | The exposed context model for this component | Required |
| data | map<propName: string, DataItem> | The props this component can receive for configuration | Required |
| settings | Action | Allows overriding the default settings actions for the data of this component | Optional |
| displayName | string | Human friendly name of the context provider for human readability | Optional, maxLength: 50, translatable |
| description | string | The public description of the context provider | Optional, maxLength: 300, translatable |

## EditorContextProviderResources

Defines the runtime resources needed for the context provider component.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| client | Resource | The ESM bundle URL for this component in runtime | Required |
| editor | Resource | An ESM bundle for editor experiences. Can allow different things like having default data | Optional |
| contextSpecifier | ContextSpecifier | The specifier of how to use the context this component provides in React | Required |
| dependencies | Dependencies | Dependencies on other services and contexts | Optional |
| schemaRefsUrl | string URL | A URL to get schema references of items for the function library | Optional, internal |

## Resource

A resource specifier of where to load the ESM bundle from.

| Key | Type | Description | More Info |
|-----|------|-------------|-----------|
| url | String URL | The URL to the ESM component bundle for server side rendering | Should have the `default` export as the component |

## DataItem

Defines a single data item. Used in both the `data` map (configuration props) and within complex structures.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| dataType | DataType | The type of data | Required |
| displayName | string | Display name of this data item | Optional, maxLength: 100, translatable |
| defaultValue | Value | Default value (only for display purposes in editor panels). Should align with the runtime/props format | Optional |
| deprecated | boolean | Whether this data item is deprecated | Optional, internal |
| disableDeletion | BoolValue | Disables the ability to delete this data-item value in the Editor UI | Optional |
| text | Text | Limitations on text input | Only when dataType is `text` |
| textEnum | TextEnum | Required list of options | Only when dataType is `textEnum` |
| number | Number | Restrictions on the number | Only when dataType is `number` |
| a11y | A11y | List of A11Y attributes to configure | Only when dataType is `a11y` |
| link | Link | Definition of supported link types | Only when dataType is `link` |
| arrayItems | ArrayItems | Array type definition | Required when dataType is `arrayItems` |
| data | DataItems | Complex data structure | Required when dataType is `data` |
| image | Image | Image editing definition | Only when dataType is `image` |
| video | Video | Video editing definition | Only when dataType is `video` |
| vectorArt | VectorArt | SVG editing definition | Only when dataType is `vectorArt` |
| richText | RichText | Rich text ability filters | Only when dataType is `richText` |
| function | EditorFunction | Custom function definition | Only when dataType is `function` |

The same disallowed data types that apply to context items also apply to data items (see [Disallowed Data Types](#disallowed-data-types)).

### Text Type

| Key | Type | Description |
|-----|------|-------------|
| maxLength | int32 | Maximum length allowed for the text |
| minLength | int32 | Minimum length required for the text |
| pattern | string | A regex pattern the text must comply with (maxLength: 100) |

### TextEnum Type

| Key | Type | Description |
|-----|------|-------------|
| options | Option[] | List of valid enum items (maxSize: 100) |

Each option:

| Key | Type | Description |
|-----|------|-------------|
| value | string | Actual text value (maxLength: 100, unique) |
| displayName | string | Display name (maxLength: 100, translatable) |

### Number Type

| Key | Type | Description |
|-----|------|-------------|
| min | string | Minimum value (string of Decimal number) |
| max | string | Maximum value (string of Decimal number) |
| multiplier | string | Multiplier for the number value (string of Decimal number) |

### ArrayItems Type

> **⚠️ Important:** This `ArrayItems` type is used in the **`data`** section only. It uses `data` or `dataItem` as keys. This is different from `ContextArrayItems` (used in the **`context`** section), which uses `item` as its key. See [ContextArrayItems](#contextarrayitems) below. Mixing these up causes the error: `arrayItems is missing arrayItems.item or arrayItems.dataItem with dataType`.
| Key | Type | Description |
|-----|------|-------------|
| data | DataItems | Multiple data items per array element. Cannot be used with `dataItem` |
| dataItem | DataItem | Single data type for array elements. Cannot be used with `data` |
| maxSize | int32 | Maximum size of the array |

### DataItems Type

| Key | Type | Description |
|-----|------|-------------|
| items | map<string, DataItem> | Map of data items defining the complex object structure |

## Context

Defines the context model exposed by the context provider component.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| items | map<string, ContextItem> | A map of keys describing the context provided by this component | Required |

## ContextSpecifier

Specifies how to use the context this component provides in React.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| moduleSpecifier | string | An identifier for the context module. Does not have to be an NPM package | Optional, maxLength: 100 |
| hook | string | The exported hook for components usage (e.g., `useSomeContextName`) | Required, maxLength: 100 |

## ContextItem

Defines a single context item that can be provided by the context provider.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| dataType | DataType | The type exposed by the context item | Required |
| displayName | string | The display name of the context item for user facing and AI usage | Optional, maxLength: 100, translatable |
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
- `onClick`
- `onChange`
- `onKeyPress`
- `onKeyUp`
- `onSubmit`

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
| `richText` | string (HTML) | Formatted content with inline styles |
| `arrayItems` | Array | Lists, collections |
| `direction` | string | HTML dir attribute (ltr/rtl) |
| `menuItems` | Array | Menu item collections |
| `data` | object | Complex nested objects |
| `function` | function | Actions, callbacks |

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

## EditorFunction

Defines a function with its parameters, return type, and execution characteristics. Used in both context items and data items when `dataType` is `function`.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| parameters | FunctionParameter[] | The parameters expected by the function. Can be empty for functions with no parameters | Optional, maxSize: 10 |
| returns | FunctionReturnType | The return type of the function. Omit for void return | Optional |
| async | bool | Whether the function returns a promise with the type of the result | Optional |
| displayName | string | The display name of the function for panels | Optional, maxLength: 100, translatable |
| description | string | The description of the function for human readability | Optional, maxLength: 300, translatable |
| deprecated | boolean | Whether this function is deprecated | Optional, internal |

## FunctionParameter

Defines a function parameter with its data type and optional structure.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| dataType | DataType | The type of the parameter. See [Disallowed Data Types](#disallowed-data-types) for restrictions | Required |
| optional | bool | Whether the parameter is optional. Due to JavaScript limitations, only the last parameters can be optional. Default is `false` | Optional |
| defaultValue | Value | The default value for this parameter, only for display purposes in the editor — will not be passed to the function | Only when `optional` is `true` |
| displayName | string | The display name of the parameter for human readability | Optional, maxLength: 100, translatable |
| description | string | The description of the parameter for human readability | Optional, maxLength: 100, translatable |
| arrayItems | FunctionParameterArrayItems | Array type definition | Only when dataType is `arrayItems` |
| data | FunctionParameterItems | Complex object structure | Only when dataType is `data` |
| function | EditorFunction | Callback function definition | Only when dataType is `function` |
| textEnum | TextEnum | List of options | Only when dataType is `textEnum` |
| deprecated | boolean | Whether this parameter is deprecated | Optional, internal |

> **Note:** The same [Disallowed Data Types](#disallowed-data-types) apply to function parameters.

## FunctionReturnType

Defines the return type of a function with its data type and optional structure.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| dataType | DataType | The type of the return value | Required |
| displayName | string | The display name of the return type for human readability | Optional, maxLength: 100, translatable |
| description | string | The description of the function return type for human readability | Optional, maxLength: 100, translatable |
| textEnum | TextEnum | List of options | Only when dataType is `textEnum` |
| arrayItems | FunctionParameterArrayItems | Array type definition | Only when dataType is `arrayItems` |
| data | FunctionParameterItems | Complex object structure | Only when dataType is `data` |

> **Note:** The same [Disallowed Data Types](#disallowed-data-types) apply to function return types.

## FunctionParameterItems

Defines the structure of a complex object type used in function parameters or return types.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| items | map<string, FunctionParameter> | Map of function parameters that define the structure of the complex object. Each key is the property name | Required |

## FunctionParameterArrayItems

Defines the structure of array items in function parameters or return types.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| item | FunctionParameter | Specifies the type of data inside the array | Required |

## Dependencies

Defines dependencies on other services and contexts. This allows the context provider to depend on other context providers or services that must be available for it to function properly.

> Note: The exact structure of Dependencies may vary. Consult the implementation for specific details.

## Component Bundle Exports

The component bundles can export:

- `default` export: The context provider component
- `injectAccessTokenGetter`: A way to have an access token injected
- Hooks: The hook method exposed for usage (e.g., `useSomeContextName`)
