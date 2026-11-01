# Context Provider Specification: Functions and Dependencies

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
| dataType | DataType | The type of the parameter. See [Disallowed Data Types](CONTEXT_SPEC_ITEMS.md#disallowed-data-types) for restrictions | Required |
| optional | bool | Whether the parameter is optional. Due to JavaScript limitations, only the last parameters can be optional. Default is `false` | Optional |
| defaultValue | Value | The default value for this parameter, only for display purposes in the editor — will not be passed to the function | Only when `optional` is `true` |
| displayName | string | The display name of the parameter for human readability | Optional, maxLength: 100, translatable |
| description | string | The description of the parameter for human readability | Optional, maxLength: 100, translatable |
| arrayItems | FunctionParameterArrayItems | Array type definition | Only when dataType is `arrayItems` |
| data | FunctionParameterItems | Complex object structure | Only when dataType is `data` |
| function | EditorFunction | Callback function definition | Only when dataType is `function` |
| textEnum | TextEnum | List of options | Only when dataType is `textEnum` |
| deprecated | boolean | Whether this parameter is deprecated | Optional, internal |

> **Note:** The same [Disallowed Data Types](CONTEXT_SPEC_ITEMS.md#disallowed-data-types) apply to function parameters.

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

> **Note:** The same [Disallowed Data Types](CONTEXT_SPEC_ITEMS.md#disallowed-data-types) apply to function return types.

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
