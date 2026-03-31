# Component Manifest Guidelines

The manifest defines the contract between your React component and the Wix ecosystem, enabling users to interact with inner elements, edit component style and props through the visual editor.

## Core Structure

```json
{
  "editorElement": {
    "selector": ".component-name",
    "displayName": "Component Name",
    "archetype": "Container",
    "layout": { ... },
    "cssProperties": { ... },
    "data": { ... },
    "elements": { ... }
  }
}
```

## Data Types

### Basic Types

| Type | Runtime Value | Constraints | Use Case |
|------|---------------|-------------|----------|
| `text` | string | maxLength, minLength, pattern | Names, titles, descriptions |
| `textEnum` | string | required options list | Predefined choices |
| `number` | number | minimum, maximum, multipleOf | Quantities, dimensions |
| `booleanValue` | boolean | - | Toggles, feature flags |
| `localDate` | string (YYYY-MM-DD) | - | Birthdays, events |
| `localTime` | string (hh:mm[:ss][.sss]) | - | Schedules |
| `webUrl` | string | http/https validation | External links |
| `direction` | string | - | HTML dir attribute (ltr/rtl) |

### Rich Content Types

| Type | Runtime Value | Configuration | Use Case |
|------|---------------|---------------|----------|
| `richText` | string (HTML) | richTextAbilities array | Formatted content |
| `link` | `{ href, target, rel }` | linkTypes array | Navigation |
| `image` | `{ uri, url, alt, width, height }` | - | Media content |
| `video` | Video object | - | Media content |
| `vectorArt` | Sanitized SVG object | - | Icons, graphics |
| `a11y` | Object | selected A11Y fields | Accessibility attributes |

### Collection Types

| Type | Runtime Value | Configuration | Use Case |
|------|---------------|---------------|----------|
| `arrayItems` | Array | data structure, maxSize | Lists, collections |
| `menuItems` | Array of menu items | - | Navigation menus |

### DataItem Fields

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

### Link Types

Available options for `link` dataType:
- `externalLink`, `anchorLink`, `emailLink`, `phoneLink`
- `dynamicPageLink`, `pageLink`, `whatsAppLink`, `documentLink`
- `popupLink`, `addressLink`, `edgeAnchorLinks`, `loginToWixLink`

### Rich Text Abilities

Available formatting options for `richText` dataType:
- `font`, `fontFamily`, `fontSize`, `fontStyle`, `fontWeight`
- `textDecoration`, `color`, `backgroundColor`, `letterSpacing`
- `textAlign`, `direction`, `marginStart`, `marginEnd`
- `bulletedList`, `numberedList`, `seoTag`

## CSS Properties

### Common Properties

| Property | Description | Values |
|----------|-------------|--------|
| `backgroundColor` | Background color | Color values |
| `color` | Text color | Color values |
| `font` | Font shorthand | Derives fontFamily, fontSize, etc. |
| `padding` | Internal spacing | Derives all directional variants |
| `margin` | External spacing | Derives all directional variants |
| `border` | Border shorthand | Derives width, style, color variants |
| `borderRadius` | Corner rounding | Derives all corner variants |
| `display` | Display type | See display values below |
| `gap` | Flex/grid spacing | Length values |
| `width`, `height` | Dimensions | Length values |
| `textAlign` | Text alignment | left, center, right, justify |
| `flexDirection` | Flex direction | row, column, row-reverse, column-reverse |
| `alignItems` | Cross-axis alignment | flex-start, center, flex-end, stretch |
| `justifyContent` | Main-axis alignment | flex-start, center, flex-end, space-between |
| `objectFit` | Image fitting | contain, cover, fill, scale-down |

### Display Values

Use underscores for multi-word values:
- `none`, `block`, `inline`, `flow`, `flowRoot`, `table`
- `flex`, `grid`, `list_item`, `contents`
- `inline_block`, `inline_table`, `inline_flex`, `inline_grid`

### CSS Property Item Fields

- **displayName** (string): Display name, max 100 chars
- **defaultValue** (Value): Default CSS value
- **display** (Display): Options for display property with displayValues array

### CSS Shorthand Properties

Shorthand properties derive their constituent parts:
- **border**: Derives borderWidth, borderStyle, borderColor, and all directional variants
- **background**: Derives backgroundColor, backgroundImage, backgroundSize, etc.
- **margin**: Derives marginTop, marginRight, marginBottom, marginLeft
- **padding**: Derives paddingTop, paddingRight, paddingBottom, paddingLeft
- **font**: Derives fontFamily, fontSize, fontWeight, fontStyle, lineHeight
- **borderRadius**: Derives all corner radius variants

### CSS Property Structure

```json
{
  "cssProperties": {
    "backgroundColor": {
      "displayName": "Background Color",
      "defaultValue": "#ffffff"
    },
    "display": {
      "displayName": "Display Type",
      "display": {
        "displayValues": ["none", "block", "flex", "grid"]
      }
    }
  }
}
```

## Editor Element Configuration

### Main Properties

| Property | Type | Description | Constraints |
|----------|------|-------------|-------------|
| `selector` | string | CSS class from React | 4-50 chars, one class only |
| `displayName` | string | Editor stage name | 4-20 chars |
| `cssProperties` | object | CSS API | Container styles only |
| `data` | object | Data API | Component-wide config only |
| `elements` | object | Inner elements | Each distinct UI part |
| `layout` | object | Layout capabilities | Resize/position options |
| `archetype` | string | Component type | See archetype options |

### Archetype Options

Complete list of available archetypes:

**Containers**: `Container`, `Carousel`, `Accordion`, `Tabs`

**Content**: `Text`, `RichTextEditor`, `Image`, `Gallery`, `Video`, `Audio`, `VectorArt`, `AnimatedGraphic`, `Line`, `Logo`, `Avatar`

**Interactive**: `Button`, `LoginButton`, `Menu`, `Pagination`, `Slider`, `SearchBox`, `Social`, `Breadcrumbs`

**Input**: `TextInput`, `SignatureInput`, `Checkbox`, `RadioGroup`, `Switch`, `Dropdown`, `DatePicker`, `TimePicker`, `Ratings`, `RatingInput`, `Upload`, `Captcha`

**Specialized**: `Map`, `Cart`, `ContactForm`, `ProgressBar`

### Layout Configuration

```json
{
  "layout": {
    "resizeDirection": "horizontalAndVertical",
    "contentResizeDirection": "horizontal",
    "disableStretching": false,
    "disablePositioning": false,
    "disableRotation": false
  }
}
```

**Resize Direction Options:**
- `horizontal`, `vertical`, `horizontalAndVertical`, `aspectRatio`

**Content Resize Direction Options:**
- `horizontal`, `vertical`, `horizontalAndVertical`, `none`

## Elements Structure

### Element Definition

```json
{
  "elements": {
    "elementKey": {
      "elementType": "inlineElement",
      "inlineElement": {
        "selector": ".component__element",
        "displayName": "Element Name",
        "cssProperties": { ... },
        "data": { ... },
        "elements": { ... },
        "behaviors": {
          "selectable": true,
          "removable": true
        },
        "archetype": "Button"
      }
    }
  }
}
```

### Critical Rules

**One Element = One Manifest Entry**
- Each distinct visual part = separate element
- 3 buttons → 3 separate elements (NOT 1 "buttons" element)
- Image + text → 2 separate elements (NOT 1 "hero" element)

**Data Scoping**
- `editorElement.data` - ONLY component-wide config (layout enums, numbers)
- `elements[key].data` - Content for THAT element (text, links, images)
- NEVER put element content in component-level data

**Display CSS Property (Required)**
The root editorElement MUST include a display CSS property:
```json
"display": {
  "displayName": "Display",
  "display": {
    "displayValues": ["none", "block"]
  }
}
```

**Behaviors (Required)**
- Always set `selectable: true` and `removable: true`
- Users need to select and remove elements independently

**Data VS CSS Properties**
- Anything that can be defined in CSS should be exposed in the manifest via CSS properties, never data
- Use `cssProperties` for: colors, sizes, spacing, fonts, borders, shadows
- Use `data` for: text content, links, images, arrays, configuration values

**Repeated Data**
- Whenever the component has repeated data (e.g. lists, collections), ALWAYS use the `arrayItems` data type
- Never create multiple separate elements for items that should be in an array

## Examples

### Simple Text Element

```json
{
  "title": {
    "elementType": "inlineElement",
    "inlineElement": {
      "selector": ".product-card__title",
      "displayName": "Title",
      "data": {
        "titleText": {
          "dataType": "text",
          "displayName": "Title Text"
        }
      },
      "cssProperties": {
        "color": {
          "displayName": "Text Color",
          "defaultValue": "#333333"
        },
        "fontSize": {
          "displayName": "Font Size",
          "defaultValue": "24px"
        }
      },
      "behaviors": {
        "selectable": true,
        "removable": true
      },
      "archetype": "Text"
    }
  }
}
```

### Button with Link

```json
{
  "ctaButton": {
    "elementType": "inlineElement",
    "inlineElement": {
      "selector": ".hero__cta-button",
      "displayName": "CTA Button",
      "data": {
        "buttonText": {
          "dataType": "text",
          "displayName": "Button Text"
        },
        "buttonLink": {
          "dataType": "link",
          "displayName": "Button Link",
          "link": {
            "linkTypes": ["externalLink", "pageLink"]
          }
        }
      },
      "cssProperties": {
        "backgroundColor": {
          "displayName": "Background Color",
          "defaultValue": "#007bff"
        },
        "borderRadius": {
          "displayName": "Border Radius",
          "defaultValue": "8px"
        }
      },
      "behaviors": {
        "selectable": true,
        "removable": true
      },
      "archetype": "Button"
    }
  }
}
```

### Array Items Collection

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

## Synchronization Requirements

**CRITICAL**: Manifest must match React and CSS exactly:

| File | Convention | Example |
|------|------------|---------|
| React className | Direct class | `className="product-card__title"` |
| CSS selector | Same class | `.product-card__title { ... }` |
| Manifest selector | Same class | `"selector": ".product-card__title"` |
| React prop | camelCase | `titleText` |
| Manifest data key | camelCase | `"titleText"` |

**Never use:**
- Compound selectors (`.a.b`)
- Descendant selectors (`.parent .child`)
- Different naming between files

## Validation Checklist

- [ ] All selectors match between manifest, React, and CSS
- [ ] Each distinct UI element has separate manifest entry
- [ ] Component data contains only layout/config, not content
- [ ] Element data contains only content for that element
- [ ] All elements have `selectable: true, removable: true`
- [ ] CSS properties have appropriate default values
- [ ] Data types match expected runtime values
- [ ] Display names are user-friendly (4-20 chars)
- [ ] Selectors are valid CSS classes (4-50 chars)
