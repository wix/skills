# Manifest Advanced

Data type constraints, installation variants, and collection patterns.

## Installation Variant Examples

```json
// Content-based height
{
  "installation": {
    "staticContainer": "HOMEPAGE",
    "initialSize": {
      "width": { "sizingType": "pixels", "pixels": 600 },
      "height": { "sizingType": "content" }
    }
  }
}

// Stretched width
{
  "installation": {
    "staticContainer": "HOMEPAGE",
    "initialSize": {
      "width": { "sizingType": "stretched" },
      "height": { "sizingType": "pixels", "pixels": 400 }
    }
  }
}
```

## DataItem Fields

Each data item in the manifest can have these configuration fields:

| Field | Type | Description |
|-------|------|-------------|
| `dataType` | DataType | Type of data being configured (required) |
| `displayName` | string | Display name shown in editor, max 100 chars |
| `text` | Text | Limitations on text input (maxLength, minLength, pattern) |
| `textEnum` | TextEnum | Required list of options with value and displayName |
| `number` | Number | Restrictions (minimum, maximum, multipleOf) |
| `link` | Link | Link support definition with linkTypes array |
| `arrayItems` | ArrayItems | Array data type definition with data structure and maxSize |
| `richTextAbilities` | RichTextAbilities[] | Rich text formatting abilities array |

## Link Types

Available options for `link` dataType:
- `externalLink`, `anchorLink`, `emailLink`, `phoneLink`
- `dynamicPageLink`, `pageLink`, `whatsAppLink`, `documentLink`
- `popupLink`, `addressLink`, `edgeAnchorLinks`, `loginToWixLink`

## Rich Text Abilities

Available formatting options for `richText` dataType:
- `font`, `fontFamily`, `fontSize`, `fontStyle`, `fontWeight`
- `textDecoration`, `color`, `backgroundColor`, `letterSpacing`
- `textAlign`, `direction`, `marginStart`, `marginEnd`
- `bulletedList`, `numberedList`, `seoTag`

## Array Items Collection Example

```json
{
  "featureList": {
    "dataType": "arrayItems",
    "displayName": "Feature List",
    "arrayItems": {
      "data": {
        "items": {
          "title": {
            "dataType": "text",
            "displayName": "Feature Title"
          },
          "description": {
            "dataType": "text",
            "displayName": "Feature Description"
          },
          "icon": {
            "dataType": "vectorArt",
            "displayName": "Feature Icon"
          }
        }
      },
      "maxSize": 6
    }
  }
}
```
