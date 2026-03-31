# Site Component Example: Perfect Example

A complete production-ready site component demonstrating all key patterns: manifest configuration, React component architecture, CSS styling, and TypeScript types.

## Component Overview

This example showcases a versatile component with:
- Badge, title, subtitle text elements
- Tags with comma-separated parsing
- Counter with numeric value
- Button with link and disabled state
- Featured image with placeholder
- Social links (Facebook, Twitter, Instagram)

---

## File Structure

```
src/site/components/perfect-example/
├── manifest.json
├── component.tsx
├── style.css
├── types.ts
└── components/
    ├── index.ts
    ├── Badge.tsx
    ├── Button.tsx
    ├── Counter.tsx
    ├── FeaturedImage.tsx
    ├── SocialLinks.tsx
    ├── Subtitle.tsx
    ├── Tags.tsx
    └── Title.tsx
```

---

## manifest.json

```json
{
  "editorElement": {
    "selector": ".perfect-example",
    "displayName": "Perfect Example",
    "archetype": "Container",
    "interactions": {
      "triggers": ["viewEnter", "pageVisible", "animationEnd", "viewProgress", "pointerMove"],
      "effectGroups": ["UNKNOWN_EFFECT_GROUP"]
    },
    "layout": {
      "resizeDirection": "horizontalAndVertical",
      "contentResizeDirection": "vertical",
      "disableStretching": false,
      "disablePositioning": false
    },
    "data": {
      "direction": {
        "dataType": "direction",
        "displayName": "Text Direction"
      }
    },
    "cssProperties": {
      "backgroundColor": {
        "displayName": "Background",
        "defaultValue": "#ff6b6b"
      },
      "padding": {
        "displayName": "Padding",
        "defaultValue": "40px"
      },
      "borderRadius": {
        "displayName": "Border Radius",
        "defaultValue": "0"
      },
      "border": {
        "displayName": "Border",
        "defaultValue": "none"
      },
      "gap": {
        "displayName": "Gap",
        "defaultValue": "20px"
      },
      "boxShadow": {
        "displayName": "Shadow",
        "defaultValue": "none"
      },
      "opacity": {
        "displayName": "Opacity",
        "defaultValue": "1"
      },
      "display": {
        "displayName": "Display",
        "defaultValue": "flex",
        "display": {
          "displayValues": ["none", "flex", "block"]
        }
      },
      "flexDirection": {
        "displayName": "Direction",
        "defaultValue": "column"
      },
      "alignItems": {
        "displayName": "Align Items",
        "defaultValue": "center"
      },
      "justifyContent": {
        "displayName": "Justify",
        "defaultValue": "center"
      }
    },
    "elements": {
      "badge": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__badge",
          "displayName": "Badge",
          "archetype": "Text",
          "data": {
            "badgeText": {
              "dataType": "text",
              "displayName": "Badge Text",
              "text": { "maxLength": 30 }
            }
          },
          "cssProperties": {
            "backgroundColor": { "displayName": "Background", "defaultValue": "#ffffff" },
            "color": { "displayName": "Color", "defaultValue": "#ff6b6b" },
            "font": { "displayName": "Font", "defaultValue": "normal normal 600 12px/1.3em wix-madefor-display-v2" },
            "padding": { "displayName": "Padding", "defaultValue": "4px 12px" },
            "borderRadius": { "displayName": "Radius", "defaultValue": "20px" },
            "textTransform": { "displayName": "Transform", "defaultValue": "uppercase" },
            "letterSpacing": { "displayName": "Spacing", "defaultValue": "0.05em" },
            "display": {
              "displayName": "Display",
              "defaultValue": "inline-block",
              "display": { "displayValues": ["none", "inline_block"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "title": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__title",
          "displayName": "Title",
          "archetype": "Text",
          "data": {
            "titleText": {
              "dataType": "text",
              "displayName": "Title Text",
              "text": { "maxLength": 100 }
            }
          },
          "cssProperties": {
            "color": { "displayName": "Color", "defaultValue": "#ffffff" },
            "font": { "displayName": "Font", "defaultValue": "normal normal 700 48px/1.2em wix-madefor-display-v2" },
            "textAlign": { "displayName": "Align", "defaultValue": "center" },
            "textShadow": { "displayName": "Shadow", "defaultValue": "none" },
            "width": { "displayName": "Width", "defaultValue": "100%" },
            "display": {
              "displayName": "Display",
              "defaultValue": "block",
              "display": { "displayValues": ["none", "block"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "subtitle": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__subtitle",
          "displayName": "Subtitle",
          "archetype": "Text",
          "data": {
            "subtitleText": {
              "dataType": "text",
              "displayName": "Subtitle Text",
              "text": { "maxLength": 200 }
            }
          },
          "cssProperties": {
            "color": { "displayName": "Color", "defaultValue": "rgba(255, 255, 255, 0.9)" },
            "font": { "displayName": "Font", "defaultValue": "normal normal 400 18px/1.5em wix-madefor-display-v2" },
            "textAlign": { "displayName": "Align", "defaultValue": "center" },
            "width": { "displayName": "Width", "defaultValue": "100%" },
            "opacity": { "displayName": "Opacity", "defaultValue": "0.9" },
            "display": {
              "displayName": "Display",
              "defaultValue": "block",
              "display": { "displayValues": ["none", "block"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "tags": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__tags",
          "displayName": "Tags",
          "archetype": "Container",
          "data": {
            "tagsText": {
              "dataType": "text",
              "displayName": "Tags (comma separated)",
              "text": { "maxLength": 200 }
            }
          },
          "cssProperties": {
            "gap": { "displayName": "Gap", "defaultValue": "8px" },
            "width": { "displayName": "Width", "defaultValue": "auto" },
            "display": {
              "displayName": "Display",
              "defaultValue": "flex",
              "display": { "displayValues": ["none", "flex"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "counter": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__counter",
          "displayName": "Counter",
          "archetype": "Text",
          "data": {
            "counterValue": {
              "dataType": "number",
              "displayName": "Count",
              "number": { "minimum": 0, "maximum": 9999 }
            }
          },
          "cssProperties": {
            "color": { "displayName": "Color", "defaultValue": "#ffffff" },
            "font": { "displayName": "Font", "defaultValue": "normal normal 700 36px/1.2em wix-madefor-display-v2" },
            "display": {
              "displayName": "Display",
              "defaultValue": "flex",
              "display": { "displayValues": ["none", "flex"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "button": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__button",
          "displayName": "Button",
          "archetype": "Button",
          "data": {
            "buttonText": {
              "dataType": "text",
              "displayName": "Button Text",
              "text": { "maxLength": 50 }
            },
            "buttonLink": {
              "dataType": "link",
              "displayName": "Button Link",
              "link": {
                "linkTypes": ["externalLink", "pageLink", "anchorLink", "emailLink", "phoneLink"]
              }
            },
            "buttonDisabled": {
              "dataType": "booleanValue",
              "displayName": "Disabled"
            }
          },
          "cssProperties": {
            "backgroundColor": { "displayName": "Background", "defaultValue": "#ffffff" },
            "color": { "displayName": "Text Color", "defaultValue": "#ff6b6b" },
            "font": { "displayName": "Font", "defaultValue": "normal normal 600 16px/1.4em wix-madefor-display-v2" },
            "padding": { "displayName": "Padding", "defaultValue": "12px 32px" },
            "borderRadius": { "displayName": "Radius", "defaultValue": "50px" },
            "border": { "displayName": "Border", "defaultValue": "none" },
            "boxShadow": { "displayName": "Shadow", "defaultValue": "0 4px 15px rgba(0, 0, 0, 0.2)" },
            "opacity": { "displayName": "Opacity", "defaultValue": "1" },
            "display": {
              "displayName": "Display",
              "defaultValue": "inline-flex",
              "display": { "displayValues": ["none", "inline_flex"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "featuredImage": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__image",
          "displayName": "Featured Image",
          "archetype": "Image",
          "data": {
            "image": {
              "dataType": "image",
              "displayName": "Image"
            },
            "imageAlt": {
              "dataType": "text",
              "displayName": "Alt Text",
              "text": { "maxLength": 100 }
            }
          },
          "cssProperties": {
            "borderRadius": { "displayName": "Radius", "defaultValue": "12px" },
            "width": { "displayName": "Width", "defaultValue": "100%" },
            "height": { "displayName": "Height", "defaultValue": "auto" },
            "boxShadow": { "displayName": "Shadow", "defaultValue": "0 10px 40px rgba(0, 0, 0, 0.3)" },
            "objectFit": { "displayName": "Fit", "defaultValue": "cover" },
            "opacity": { "displayName": "Opacity", "defaultValue": "1" },
            "display": {
              "displayName": "Display",
              "defaultValue": "block",
              "display": { "displayValues": ["none", "block"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      },
      "socialLinks": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".perfect-example__social",
          "displayName": "Social Links",
          "archetype": "Social",
          "data": {
            "facebookUrl": {
              "dataType": "webUrl",
              "displayName": "Facebook URL"
            },
            "twitterUrl": {
              "dataType": "webUrl",
              "displayName": "Twitter URL"
            },
            "instagramUrl": {
              "dataType": "webUrl",
              "displayName": "Instagram URL"
            }
          },
          "cssProperties": {
            "gap": { "displayName": "Gap", "defaultValue": "16px" },
            "display": {
              "displayName": "Display",
              "defaultValue": "flex",
              "display": { "displayValues": ["none", "flex"] }
            }
          },
          "behaviors": { "selectable": true, "removable": true }
        }
      }
    },
    "actions": {
      "editContent": {
        "displayName": "Edit Content",
        "execution": {
          "actionType": "data",
          "data": { "dataItemKey": "titleText" }
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

import {
  Badge,
  Title,
  Subtitle,
  Tags,
  Counter,
  Button,
  FeaturedImage,
  SocialLinks,
} from './components';

import type {
  Text,
  RichText,
  NumberType,
  BooleanValue,
  WebUrl,
  Link,
  Image,
  Direction,
  Wix,
} from './types';

interface PerfectExampleProps {
  className: string;
  id: string;
  wix?: Wix;
  direction?: Direction;
  elementProps?: {
    badge?: {
      badgeText?: Text;
    };
    title?: {
      titleText?: Text;
    };
    subtitle?: {
      subtitleText?: Text;
    };
    tags?: {
      tagsText?: Text;
    };
    counter?: {
      counterValue?: NumberType;
      counterLabel?: Text;
    };
    button?: {
      buttonText?: Text;
      buttonLink?: Link;
      buttonDisabled?: BooleanValue;
    };
    featuredImage?: {
      image?: Image;
      imageAlt?: Text;
    };
    socialLinks?: {
      facebookUrl?: WebUrl;
      twitterUrl?: WebUrl;
      instagramUrl?: WebUrl;
    };
  };
}

const PerfectExample: React.FC<PerfectExampleProps> = ({
  className,
  id,
  wix,
  direction,
  elementProps,
}) => {
  const rm = wix?.elementsRemovalState || {};

  return (
    <div className={`perfect-example ${className}`} id={id} dir={direction}>
      {!rm['badge'] && (
        <Badge className="perfect-example__badge" {...elementProps?.badge} />
      )}

      {!rm['title'] && (
        <Title className="perfect-example__title" {...elementProps?.title} />
      )}

      {!rm['subtitle'] && (
        <Subtitle className="perfect-example__subtitle" {...elementProps?.subtitle} />
      )}

      {!rm['tags'] && (
        <Tags className="perfect-example__tags" {...elementProps?.tags} />
      )}

      {!rm['counter'] && (
        <Counter className="perfect-example__counter" {...elementProps?.counter} />
      )}

      <div className="perfect-example__buttons">
        {!rm['button'] && (
          <Button className="perfect-example__button" {...elementProps?.button} />
        )}
      </div>

      {!rm['featuredImage'] && (
        <FeaturedImage className="perfect-example__image" {...elementProps?.featuredImage} />
      )}

      {!rm['socialLinks'] && (
        <SocialLinks className="perfect-example__social" {...elementProps?.socialLinks} />
      )}
    </div>
  );
};

export default PerfectExample;
```

---

## style.css

```css
.perfect-example {
  box-sizing: border-box;
  width: 100%;
  min-height: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 40px;
  background-color: #ff6b6b;
  text-align: center;
}

.perfect-example *,
.perfect-example *::before,
.perfect-example *::after {
  box-sizing: border-box;
}

.perfect-example__badge {
  display: inline-block;
  padding: 4px 12px;
  background-color: #ffffff;
  color: #ff6b6b;
  font: normal normal 600 12px/1.3em wix-madefor-display-v2;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-radius: 20px;
}

.perfect-example__title {
  margin: 0;
  color: #ffffff;
  font: normal normal 700 48px/1.2em wix-madefor-display-v2;
  text-align: center;
}

.perfect-example__subtitle {
  margin: 0;
  color: rgba(255, 255, 255, 0.9);
  font: normal normal 400 18px/1.5em wix-madefor-display-v2;
  text-align: center;
  max-width: 600px;
}

.perfect-example__tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.perfect-example__tag {
  display: inline-block;
  padding: 6px 14px;
  background-color: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  font: normal normal 500 13px/1.3em wix-madefor-display-v2;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.perfect-example__counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: #ffffff;
}

.perfect-example__counter-label {
  font: normal normal 400 14px/1.4em wix-madefor-display-v2;
  opacity: 0.8;
}

.perfect-example__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}

.perfect-example__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 32px;
  background-color: #ffffff;
  color: #ff6b6b;
  font: normal normal 600 16px/1.4em wix-madefor-display-v2;
  text-decoration: none;
  border: none;
  border-radius: 50px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.perfect-example__button:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.perfect-example__image-wrapper {
  width: 100%;
  max-width: 400px;
}

.perfect-example__image {
  width: 100%;
  height: auto;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  object-fit: cover;
}

.perfect-example__image--placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 200px;
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
  font: normal normal 500 14px/1.4em wix-madefor-display-v2;
  border: 2px dashed rgba(255, 255, 255, 0.3);
}

.perfect-example__social {
  display: flex;
  gap: 16px;
}

.perfect-example__social-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background-color: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  border-radius: 50%;
  text-decoration: none;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.perfect-example__social-link:hover {
  background-color: rgba(255, 255, 255, 0.25);
  transform: scale(1.1);
}

.perfect-example[dir="rtl"] {
  direction: rtl;
}

@media (prefers-reduced-motion: reduce) {
  .perfect-example *,
  .perfect-example *::before,
  .perfect-example *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## types.ts

```typescript
export type Text = string;
export type RichText = string;
export type NumberType = number;
export type BooleanValue = boolean;
export type WebUrl = string;
export type Direction = 'rtl' | 'ltr' | 'auto';

export type Link = {
  href: string;
  target?: string;
  rel?: string;
};

export type Image = {
  uri: string;
  url: string;
  name?: string;
  alt?: string;
  width?: number;
  height?: number;
};

export interface Wix {
  elementsRemovalState?: Record<string, 'REMOVED'>;
}

export interface BadgeProps {
  badgeText?: Text;
}

export interface TitleProps {
  titleText?: Text;
}

export interface SubtitleProps {
  subtitleText?: Text;
}

export interface DescriptionProps {
  descriptionContent?: RichText;
}

export interface TagsProps {
  tagsText?: Text;
}

export interface CounterProps {
  counterValue?: NumberType;
  counterLabel?: Text;
}

export interface ButtonProps {
  buttonText?: Text;
  buttonLink?: Link;
  buttonDisabled?: BooleanValue;
}

export interface FeaturedImageProps {
  image?: Image;
  imageAlt?: Text;
}

export interface SocialLinksProps {
  facebookUrl?: WebUrl;
  twitterUrl?: WebUrl;
  instagramUrl?: WebUrl;
}
```

---

## Sub-Components

### components/index.ts

```typescript
export { Badge } from './Badge';
export { Title } from './Title';
export { Subtitle } from './Subtitle';
export { Tags } from './Tags';
export { Counter } from './Counter';
export { Button } from './Button';
export { FeaturedImage } from './FeaturedImage';
export { SocialLinks } from './SocialLinks';
```

### components/Badge.tsx

```tsx
import React from 'react';
import type { Text } from '../types';

interface BadgeComponentProps {
  className: string;
  badgeText?: Text;
}

export const Badge: React.FC<BadgeComponentProps> = ({ className, badgeText }) => (
  <span className={className}>
    {badgeText || 'New'}
  </span>
);
```

### components/Title.tsx

```tsx
import React from 'react';
import type { Text } from '../types';

interface TitleComponentProps {
  className: string;
  titleText?: Text;
}

export const Title: React.FC<TitleComponentProps> = ({ className, titleText }) => (
  <h1 className={className}>{titleText || 'Perfect Example'}</h1>
);
```

### components/Subtitle.tsx

```tsx
import React from 'react';
import type { Text } from '../types';

interface SubtitleComponentProps {
  className: string;
  subtitleText?: Text;
}

export const Subtitle: React.FC<SubtitleComponentProps> = ({ className, subtitleText }) => (
  <p className={className}>{subtitleText || 'The ultimate React component builder showcase'}</p>
);
```

### components/Tags.tsx

```tsx
import React from 'react';
import type { Text } from '../types';

interface TagsComponentProps {
  className: string;
  tagsText?: Text;
}

const DEFAULT_TAGS = 'React, Builder, Wix';

export const Tags: React.FC<TagsComponentProps> = ({ className, tagsText }) => {
  const tagsString = tagsText || DEFAULT_TAGS;
  const tags = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

  return (
    <div className={className}>
      {tags.map((tag, index) => (
        <span key={index} className="perfect-example__tag">
          {tag}
        </span>
      ))}
    </div>
  );
};
```

### components/Counter.tsx

```tsx
import React from 'react';
import type { NumberType } from '../types';

interface CounterComponentProps {
  className: string;
  counterValue?: NumberType;
}

export const Counter: React.FC<CounterComponentProps> = ({ className, counterValue }) => (
  <div className={className}>
    <span className="perfect-example__counter-value">{counterValue ?? 100}</span>
  </div>
);
```

### components/Button.tsx

```tsx
import React from 'react';
import type { Text, Link, BooleanValue } from '../types';

interface ButtonComponentProps {
  className: string;
  buttonText?: Text;
  buttonLink?: Link;
  buttonDisabled?: BooleanValue;
}

export const Button: React.FC<ButtonComponentProps> = ({ className, buttonText, buttonLink, buttonDisabled }) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
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
      {buttonText || 'Get Started'}
    </a>
  );
};
```

### components/FeaturedImage.tsx

```tsx
import React from 'react';
import type { Image, Text } from '../types';

interface FeaturedImageComponentProps {
  className: string;
  image?: Image;
  imageAlt?: Text;
}

export const FeaturedImage: React.FC<FeaturedImageComponentProps> = ({ className, image, imageAlt }) => (
  <div className="perfect-example__image-wrapper">
    {image?.url ? (
      <img
        className={className}
        src={image.url}
        alt={imageAlt || image.alt || 'Featured image'}
        loading="lazy"
      />
    ) : (
      <div className={`${className} perfect-example__image--placeholder`}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span>Add Image</span>
      </div>
    )}
  </div>
);
```

### components/SocialLinks.tsx

```tsx
import React from 'react';
import type { WebUrl } from '../types';

interface SocialLinksComponentProps {
  className: string;
  facebookUrl?: WebUrl;
  twitterUrl?: WebUrl;
  instagramUrl?: WebUrl;
}

const SocialIcon: React.FC<{ type: 'facebook' | 'twitter' | 'instagram' }> = ({ type }) => {
  const paths: Record<string, string> = {
    facebook: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z',
    twitter: 'M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z',
    instagram: 'M16 4H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4zm-4 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm4.5-7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z',
  };

  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[type]} />
    </svg>
  );
};

export const SocialLinks: React.FC<SocialLinksComponentProps> = ({
  className,
  facebookUrl,
  twitterUrl,
  instagramUrl
}) => {
  const links = [
    { type: 'facebook' as const, url: facebookUrl },
    { type: 'twitter' as const, url: twitterUrl },
    { type: 'instagram' as const, url: instagramUrl },
  ].filter(link => link.url);

  const displayLinks = links.length > 0 ? links : [
    { type: 'facebook' as const, url: '#' },
    { type: 'twitter' as const, url: '#' },
    { type: 'instagram' as const, url: '#' },
  ];

  return (
    <div className={className}>
      {displayLinks.map(({ type, url }) => (
        <a
          key={type}
          href={url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="perfect-example__social-link"
          aria-label={type}
          onClick={(e) => { if (!url || url === '#') e.preventDefault(); }}
        >
          <SocialIcon type={type} />
        </a>
      ))}
    </div>
  );
};
```

---

## Key Patterns Demonstrated

### 1. Manifest-to-React Alignment

- Each manifest element key (`badge`, `title`, etc.) matches the React removal state check
- CSS selectors match manifest selectors exactly (`.perfect-example__badge`)
- Data types in manifest match TypeScript types (`text` → `Text`, `number` → `NumberType`)

### 2. Sub-Component Architecture

- Each visual element is a separate sub-component
- Sub-components receive `className` prop for CSS styling
- Props spread pattern: `{...elementProps?.badge}`

### 3. Removal State Handling

```tsx
const rm = wix?.elementsRemovalState || {};
{!rm['badge'] && <Badge ... />}
```

### 4. CSS Variable Integration

- Root element uses CSS variables for dynamic styling
- `display` property configurable via manifest
- All selectors declared once with `box-sizing: border-box`

### 5. Accessibility

- Proper `aria-disabled` on buttons
- `loading="lazy"` on images
- `aria-label` on icon-only links
- Reduced motion media query support

