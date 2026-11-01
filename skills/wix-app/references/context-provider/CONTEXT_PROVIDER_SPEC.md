# Context Provider Specification

Complete specification for the EditorContextProvider manifest and all related types.

## EditorContextProvider

Defines a context provider component that can be added to any page, container, or section in the Editor. The component is logical and does not provide any UI, but it does provide props for configuring it in the Editor.

| Key | Type | Description | Constraints |
|-----|------|-------------|------------|
| type | string | The component type, should be namespaced: `slug.componentName` | Required, maxLength: 100 |
| resources | EditorContextProviderResources | The runtime information needed for this component | Required |
| context | Context | The exposed context model for this component | Required |
| data | map<propName: string, DataItem> | The props this component can receive for configuration | Required; use `{}` when there are no inputs |
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

The same disallowed data types that apply to context items also apply to data items (see [Disallowed Data Types](CONTEXT_SPEC_ITEMS.md#disallowed-data-types)).

### Text Type

| Key | Type | Description |
|-----|------|-------------|
| maxLength | int32 | Maximum length allowed for the text |
| minLength | int32 | Minimum length required for the text |
| pattern | string | A regex pattern the text must comply with (maxLength: 100) |

### TextEnum Type

| Key | Type | Description |
|-----|------|-------------|
| options | Option[] | List of valid enum items (minSize: 2, maxSize: 100) |

A `textEnum` with fewer than 2 options fails the checkpoint with `textEnum must have at least 2 options`. A field that only ever holds one fixed value (e.g. a media `type` that is always `'image'`) is `text`, not a one-option `textEnum`. When changing a field from `textEnum` to `text`, remove its `textEnum` key too: a `textEnum` key on a non-`textEnum` item fails with `dataType "text" does not match extension field "textEnum"`.

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

### RichText Type

Configuration for `dataType: 'richText'`. Only valid on **DataItem** (the `data` section). ContextItem does not accept this field — context richText items omit the config and receive all abilities by default.

| Key | Type | Description |
|-----|------|-------------|
| abilities | RichTextAbilities[] | Whitelist of formatting controls to expose in the editor. Omit to enable all. maxSize: 22 |

Runtime/props shape (from `@wix/editor-react-types`):

```typescript
type RichText = {
  text: string;
  html: string;
  linkList: Array<Link>;
};
```

#### RichTextAbilities

`font`, `fontFamily`, `fontSize`, `fontStyle`, `fontWeight`, `textDecoration`, `color`, `backgroundColor`, `letterSpacing`, `textAlign`, `direction`, `marginStart`, `marginEnd`, `bulletedList`, `numberedList`, `seoTag`.

#### Example (DataItem)

```json
{
  "dataType": "richText",
  "displayName": "Section Description",
  "defaultValue": "<p>Enter your section description here</p>",
  "richText": {
    "abilities": ["font", "color", "textAlign", "bulletedList"]
  }
}
```

`defaultValue` is an HTML string used for editor preview only. The runtime/props value received by the component is the `RichText` object shape above.

### ArrayItems Type

> **⚠️ Important:** This `ArrayItems` type is used in the **`data`** section only. In a context provider it takes `dataItem` as its key. This is different from `ContextArrayItems` (used in the **`context`** section), which uses `item` as its key. See [ContextArrayItems](CONTEXT_SPEC_ITEMS.md#contextarrayitems) below. A context provider array without `dataItem` or `item` fails the checkpoint with: `arrayItems is missing arrayItems.item or arrayItems.dataItem with dataType`.

| Key | Type | Description |
|-----|------|-------------|
| dataItem | DataItem | The type of each array element. Required in a context provider |
| maxSize | int32 | Maximum size of the array |

`arrayItems: { data: { items: {...} } }` (a `DataItems` map directly under `arrayItems`) is valid for Editor React Components only. A context provider rejects it with the error above, after the build has already passed. For an array of objects, wrap the object in `dataItem` with `dataType: 'data'`:

```typescript
data: {
  sourceItems: {
    dataType: 'arrayItems',
    displayName: 'Source items',
    arrayItems: {
      dataItem: {
        dataType: 'data',
        data: {
          items: {
            title: { dataType: 'text', displayName: 'Title' },
            image: { dataType: 'text', displayName: 'Image URL' },
          },
        },
      },
    },
  },
},
```

### DataItems Type

| Key | Type | Description |
|-----|------|-------------|
| items | map<string, DataItem> | Map of data items defining the complex object structure |
