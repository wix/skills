# Site Component Example: Product Card

Complete production-ready site component demonstrating nested elements, all key data types, three component types (Leaf, Container, Root), conditional rendering, and three-way synchronization.

## Component Overview

- **8 elements** with 2-level nesting (imageWrapper > badge, contentArea > title/price/tags/description/button)
- **Data types**: text, link, image, arrayItems, number, booleanValue, direction
- **Patterns**: LeafComponent, ContainerComponent, RootComponent, elementsRemovalState, elementProps spreading

---

## manifest.json

```json
{
  "installation": {
    "staticContainer": "HOMEPAGE",
    "initialSize": {
      "width": { "sizingType": "pixels", "pixels": 320 },
      "height": { "sizingType": "content" }
    }
  },
  "editorElement": {
    "selector": ".product-card",
    "displayName": "Product Card",
    "archetype": "Container",
    "layout": {
      "resizeDirection": "horizontalAndVertical",
      "contentResizeDirection": "vertical"
    },
    "data": {
      "direction": {
        "dataType": "direction",
        "displayName": "Text Direction"
      }
    },
    "cssProperties": {
      "backgroundColor": { "displayName": "Card BG", "defaultValue": "#FFFFFF" },
      "borderRadius": { "displayName": "Radius", "defaultValue": "12px" },
      "boxShadow": { "displayName": "Shadow", "defaultValue": "0 2px 8px rgba(3,34,98,0.08)" },
      "display": {
        "displayName": "Display",
        "display": { "displayValues": ["none", "flex"] }
      }
    },
    "elements": {
      "imageWrapper": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".product-card__image-wrapper",
          "displayName": "Media Area",
          "data": {
            "image": { "dataType": "image", "displayName": "Image" }
          },
          "cssProperties": {
            "borderRadius": { "displayName": "Radius", "defaultValue": "8px 8px 0 0" },
            "display": { "display": { "displayValues": ["none", "block"] } }
          },
          "elements": {
            "badge": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".product-card__badge",
                "displayName": "Badge",
                "data": {
                  "badgeText": { "dataType": "text", "displayName": "Text" }
                },
                "cssProperties": {
                  "backgroundColor": { "displayName": "BG", "defaultValue": "#D1FFAE" },
                  "color": { "displayName": "Color", "defaultValue": "#000" },
                  "font": { "displayName": "Font", "defaultValue": "normal normal 600 12px/1.3em wix-madefor-display-v2" },
                  "display": { "display": { "displayValues": ["none", "block"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "contentArea": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".product-card__content",
          "displayName": "Content Area",
          "cssProperties": {
            "padding": { "displayName": "Padding", "defaultValue": "clamp(1.5rem,4vw,2rem)" },
            "gap": { "displayName": "Gap", "defaultValue": "0.75rem" },
            "display": { "display": { "displayValues": ["none", "flex"] } }
          },
          "elements": {
            "title": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".product-card__title",
                "displayName": "Title",
                "data": {
                  "titleText": { "dataType": "text", "displayName": "Text" }
                },
                "cssProperties": {
                  "font": { "displayName": "Font", "defaultValue": "normal normal 700 24px/1.2em wix-madefor-display-v2" },
                  "color": { "displayName": "Color", "defaultValue": "#000" },
                  "display": { "display": { "displayValues": ["none", "block"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            },
            "price": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".product-card__price",
                "displayName": "Price",
                "data": {
                  "priceAmount": { "dataType": "number", "displayName": "Price", "number": { "minimum": 0 } },
                  "currency": { "dataType": "text", "displayName": "Currency" }
                },
                "cssProperties": {
                  "font": { "displayName": "Font", "defaultValue": "normal normal 600 20px/1.2em wix-madefor-display-v2" },
                  "color": { "displayName": "Color", "defaultValue": "#000" },
                  "display": { "display": { "displayValues": ["none", "block"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            },
            "tags": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".product-card__tags",
                "displayName": "Tags",
                "data": {
                  "tags": {
                    "dataType": "arrayItems",
                    "displayName": "Tags",
                    "arrayItems": {
                      "dataItem": {
                        "dataType": "data",
                        "displayName": "Tag",
                        "data": {
                          "items": {
                            "label": { "dataType": "text", "displayName": "Label" }
                          }
                        }
                      },
                      "maxSize": 5
                    }
                  }
                },
                "cssProperties": {
                  "gap": { "displayName": "Gap", "defaultValue": "0.5rem" },
                  "display": { "display": { "displayValues": ["none", "flex"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            },
            "descriptionText": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".product-card__description",
                "displayName": "Description",
                "data": {
                  "descriptionText": { "dataType": "text", "displayName": "Text" }
                },
                "cssProperties": {
                  "font": { "displayName": "Font", "defaultValue": "normal normal 400 16px/1.5em wix-madefor-display-v2" },
                  "color": { "displayName": "Color", "defaultValue": "#000" },
                  "display": { "display": { "displayValues": ["none", "block"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            },
            "button": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".product-card__button",
                "displayName": "Button",
                "data": {
                  "buttonText": { "dataType": "text", "displayName": "Text" },
                  "buttonLink": { "dataType": "link", "displayName": "Link" },
                  "buttonDisabled": { "dataType": "booleanValue", "displayName": "Disabled" }
                },
                "cssProperties": {
                  "backgroundColor": { "displayName": "BG", "defaultValue": "#032262" },
                  "color": { "displayName": "Color", "defaultValue": "#FFF" },
                  "border": { "displayName": "Border", "defaultValue": "1px solid #032262" },
                  "display": { "display": { "displayValues": ["none", "inline_flex"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      }
    }
  }
}
```

---

## component.tsx

```tsx
import React from 'react';
import './style.css';
import { defaultProductImage } from './assets/defaultImages';
import type {
  Wix, Text, Link, Image, NumberType, BooleanValue, Direction,
} from '@wix/editor-react-types';

// RichText from @wix/editor-react-types is { text, html, linkList } — site components receive HTML string
type RichText = string;

type LeafComponent<TProps> = (props: TProps & { className: string }) => React.JSX.Element;

type ContainerComponent<TProps> = (
  props: TProps & {
    className: string;
    elementProps?: Record<string, any>;
    wix?: Wix;
  }
) => React.JSX.Element;

type RootComponent<TProps> = (
  props: TProps & {
    id?: string;
    className: string;
    elementProps?: Record<string, any>;
    wix?: Wix;
  }
) => React.JSX.Element;

// --- Leaf Components ---

const Badge: LeafComponent<{ badgeText?: Text }> = ({ className, badgeText }) => (
  <div className={className}>{badgeText || 'New'}</div>
);

const Title: LeafComponent<{ titleText?: Text }> = ({ className, titleText }) => (
  <h2 className={className}>{titleText || 'Product Title'}</h2>
);

const Price: LeafComponent<{ priceAmount?: NumberType; currency?: Text }> = ({
  className, priceAmount, currency
}) => {
  const amount = priceAmount ?? 99;
  const curr = currency || '$';
  return <p className={className}>{curr}{amount.toFixed(2)}</p>;
};

interface Tag { label?: Text; }

const Tags: LeafComponent<{ tags?: Tag[] }> = ({ className, tags }) => {
  const defaultTags: Tag[] = [{ label: 'AI' }, { label: 'Premium' }, { label: 'New' }];
  const displayTags = (tags?.length ?? 0) > 0 ? tags! : defaultTags;
  return (
    <div className={className}>
      {displayTags.map((tag, i) => (
        <span key={i} className="product-card__tag">{tag.label || 'Tag'}</span>
      ))}
    </div>
  );
};

const Description: LeafComponent<{ descriptionText?: Text }> = ({ className, descriptionText }) => (
  <p className={className}>{descriptionText || 'Unlock insights with AI.'}</p>
);

const Button: LeafComponent<{
  buttonText?: Text;
  buttonLink?: Link;
  buttonDisabled?: BooleanValue;
}> = ({ className, buttonText, buttonLink, buttonDisabled }) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    if (buttonDisabled || !buttonLink?.href || buttonLink.href === '#') {
      e.preventDefault();
    }
  };

  return (
    <a
      href={buttonLink?.href || '#'}
      target={buttonLink?.target}
      rel={buttonLink?.rel}
      onClick={handleClick}
      className={className}
      aria-disabled={buttonDisabled}
      style={{ pointerEvents: buttonDisabled ? 'none' : 'auto', opacity: buttonDisabled ? 0.5 : 1 }}
    >
      <span>{buttonText || 'Learn More'}</span>
    </a>
  );
};

// --- Container Components ---

const ImageWrapper: ContainerComponent<{ image?: Image }> = ({ className, image, elementProps, wix }) => {
  const removalState = wix?.elementsRemovalState || {};
  const imageUrl = image?.url || defaultProductImage;

  return (
    <div className={className}>
      {imageUrl && (
        <img className="product-card__image" src={imageUrl} alt={image?.name || 'Product Image'} loading="lazy" />
      )}
      {!removalState['badge'] && (
        <Badge className="product-card__badge" {...elementProps?.['badge']} />
      )}
    </div>
  );
};

const ContentArea: ContainerComponent<{}> = ({ className, elementProps, wix }) => {
  const removalState = wix?.elementsRemovalState || {};

  return (
    <div className={className}>
      {!removalState['title'] && (
        <Title className="product-card__title" {...elementProps?.['title']} />
      )}
      {!removalState['price'] && (
        <Price className="product-card__price" {...elementProps?.['price']} />
      )}
      {!removalState['tags'] && (
        <Tags className="product-card__tags" {...elementProps?.['tags']} />
      )}
      {!removalState['descriptionText'] && (
        <Description className="product-card__description" {...elementProps?.['descriptionText']} />
      )}
      {!removalState['button'] && (
        <Button className="product-card__button" {...elementProps?.['button']} />
      )}
    </div>
  );
};

// --- Root Component ---

const ProductCard: RootComponent<{ direction?: Direction }> = ({ className, id, wix, elementProps, direction }) => {
  const removalState = wix?.elementsRemovalState || {};

  return (
    <div className={`product-card ${className}`} id={id} dir={direction}>
      {!removalState['imageWrapper'] && (
        <ImageWrapper className="product-card__image-wrapper" {...elementProps?.['imageWrapper']} />
      )}
      {!removalState['contentArea'] && (
        <ContentArea className="product-card__content" {...elementProps?.['contentArea']} />
      )}
    </div>
  );
};

export default ProductCard;
```

---

## style.css

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

@keyframes contentAppear {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.product-card {
  --display: flex;
  width: 100%;
  background: #FFF;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(3, 34, 98, 0.08);
  transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
  display: var(--display);
  flex-direction: column;
  overflow: hidden;
}

.product-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(3, 34, 98, 0.12);
}

.product-card__image-wrapper {
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 8px 8px 0 0;
  position: relative;
  pointer-events: auto;
  opacity: 0;
  animation: contentAppear 700ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  animation-delay: 100ms;
}

.product-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.product-card:hover .product-card__image {
  transform: scale(1.05);
}

.product-card__badge {
  position: absolute;
  top: 1rem;
  left: 1rem;
  padding: 0.25rem 0.75rem;
  background: #D1FFAE;
  color: #000;
  font: normal normal 600 12px/1.3em wix-madefor-display-v2;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  pointer-events: auto;
}

.product-card__content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: clamp(1.5rem, 4vw, 2rem);
  flex-grow: 1;
  pointer-events: auto;
  opacity: 0;
  animation: contentAppear 700ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  animation-delay: 250ms;
}

.product-card__title {
  margin: 0;
  font: normal normal 700 24px/1.2em wix-madefor-display-v2;
  color: #000;
  pointer-events: auto;
}

.product-card__price {
  margin: 0;
  font: normal normal 600 20px/1.2em wix-madefor-display-v2;
  color: #000;
  pointer-events: auto;
}

.product-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.5rem 0;
  pointer-events: auto;
}

.product-card__tag {
  padding: 0.25rem 0.75rem;
  background: rgba(3, 34, 98, 0.08);
  color: #032262;
  font: normal normal 500 12px/1.3em wix-madefor-display-v2;
  border-radius: 16px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.product-card__description {
  margin: 0;
  font: normal normal 400 16px/1.5em wix-madefor-display-v2;
  color: #000;
  opacity: 0.7;
  flex-grow: 1;
  pointer-events: auto;
}

.product-card__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: #032262;
  color: #FFF;
  font: normal normal 500 16px/1.4em wix-madefor-display-v2;
  text-decoration: none;
  border: 1px solid #032262;
  border-radius: 15px;
  align-self: flex-start;
  margin-top: 1rem;
  pointer-events: auto;
  transition: background-color 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
              border-color 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.product-card__button:hover {
  background: #88C0FF;
  border-color: #88C0FF;
}

.product-card__button:focus-visible {
  outline: 2px solid #032262;
  outline-offset: 2px;
}

.product-card[dir="rtl"] {
  direction: rtl;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## types.ts

```typescript
import type {
  Wix, Link, Image, Text, NumberType, BooleanValue, Direction,
} from '@wix/editor-react-types';

export type { Wix, Link, Image, Text, NumberType, BooleanValue, Direction };

// RichText from @wix/editor-react-types is { text, html, linkList } — site components receive HTML string
export type RichText = string;
```

---

## Default Image Asset

```
<defaultProductImage>
{
  "description": "A high-tech product photograph featuring futuristic AI technology with sleek metallic surfaces and glowing blue circuit patterns",
  "width": 1024,
  "height": 896
}
</defaultProductImage>
```

---

## Key Patterns Demonstrated

### Nested Elements (2-level)
Root → imageWrapper → badge, Root → contentArea → title/price/tags/description/button

### Three Component Types
- **LeafComponent**: Badge, Title, Price, Tags, Description, Button — content only, no children
- **ContainerComponent**: ImageWrapper, ContentArea — render child sub-components via `elementProps`
- **RootComponent**: ProductCard — exported default, receives `id`, `className`, `elementProps`, `wix`

### Conditional Rendering
Each level checks its own `wix.elementsRemovalState`:
- Root checks `imageWrapper`, `contentArea`
- ImageWrapper checks `badge`
- ContentArea checks `title`, `price`, `tags`, `descriptionText`, `button`

### Data Types Covered
| Type | Element | Field |
|------|---------|-------|
| `text` | badge, title, description, button | badgeText, titleText, descriptionText, buttonText |
| `number` | price | priceAmount |
| `booleanValue` | button | buttonDisabled |
| `link` | button | buttonLink |
| `image` | imageWrapper | image |
| `arrayItems` | tags | tags (array of { label: text }) |
| `direction` | root | direction |

### Three-Way Sync
Every element: React `className` = CSS selector = manifest `selector`
- React: `className="product-card__badge"` → CSS: `.product-card__badge {}` → Manifest: `"selector": ".product-card__badge"`

### CSS Variable Integration
- Root `--display` variable for editor override: `display: var(--display)`
- All selectors declared once with `box-sizing: border-box`
- `pointer-events: auto` on all manifest elements

### Accessibility
- `aria-disabled` on buttons with disabled state
- `loading="lazy"` on images
- `focus-visible` outline for keyboard navigation
- `prefers-reduced-motion` media query
