# Component Manifest Guidelines

The manifest defines the contract between your React component and the Wix ecosystem, enabling users to interact with inner elements, edit component style and props through the visual editor.

## Core Structure

```json
{
  "installation": {
    "staticContainer": "HOMEPAGE",
    "initialSize": {
      "width": { "sizingType": "pixels", "pixels": 400 },
      "height": { "sizingType": "pixels", "pixels": 300 }
    }
  },
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

## Installation Configuration

The `installation` property defines how the component is initially placed and sized when added to a page.

### Installation Fields

| Field | Type | Description |
|-------|------|-------------|
| `staticContainer` | string | Automatic installation location. Use `"HOMEPAGE"` to auto-install on homepage |
| `initialSize` | object | Initial dimensions when the component is added |

### Initial Size Configuration

| Property | Type | Description |
|----------|------|-------------|
| `width` | InitialSizeSetting | Width configuration |
| `height` | InitialSizeSetting | Height configuration |

### InitialSizeSetting

| Property | Type | Description |
|----------|------|-------------|
| `sizingType` | string | One of: `"content"`, `"stretched"`, `"pixels"` |
| `pixels` | number | Required when sizingType is `"pixels"` |

### Sizing Type Values

| Value | Description |
|-------|-------------|
| `content` | Component auto-sizes based on its content |
| `stretched` | Component stretches to fill available space |
| `pixels` | Component has a fixed pixel dimension (requires `pixels` property) |

### Installation Guidelines

- **Always include** `"staticContainer": "HOMEPAGE"` for automatic installation on Harmony editor
- **Default initial size** is 400px width, 300px height (matches Wix Harmony defaults)
- Use `"content"` for height when the component should auto-size based on its content
- Use `"stretched"` when the component should fill available space
- Use `"pixels"` for fixed dimensions

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
- The `arrayItems` field must contain one of: `data` (static structure), `dataItem` (single typed item), or `dynamicItems`. Omitting all three fails deploy validation
- Never create multiple separate elements for items that should be in an array

## Examples

### Simple Text Element

```json
{
  "title": {
    "elementType": "inlineElement",
    "inlineElement": {
      "selector": ".profile-card__title",
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

## Synchronization Requirements

**CRITICAL**: Manifest must match React and CSS exactly:

| File | Convention | Example |
|------|------------|---------|
| React className | Direct class | `className="profile-card__title"` |
| CSS selector | Same class | `.profile-card__title { ... }` |
| Manifest selector | Same class | `"selector": ".profile-card__title"` |
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
