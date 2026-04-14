# Site Component Example: Profile Card

Complete production-ready site component demonstrating nested elements, all key data types, three component types (Leaf, Container, Root), conditional rendering, and three-way synchronization.

## Component Overview

- **8 elements** with 2-level nesting (photoSection > statusBadge, infoSection > name/experience/skills/bio/contactButton)
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
    "selector": ".profile-card",
    "displayName": "Profile Card",
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
      "photoSection": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".profile-card__photo-section",
          "displayName": "Photo Area",
          "data": {
            "image": { "dataType": "image", "displayName": "Photo" }
          },
          "cssProperties": {
            "borderRadius": { "displayName": "Radius", "defaultValue": "8px 8px 0 0" },
            "display": { "display": { "displayValues": ["none", "block"] } }
          },
          "elements": {
            "statusBadge": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".profile-card__status-badge",
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
      "infoSection": {
        "elementType": "inlineElement",
        "inlineElement": {
          "selector": ".profile-card__info",
          "displayName": "Info Area",
          "cssProperties": {
            "padding": { "displayName": "Padding", "defaultValue": "clamp(1.5rem,4vw,2rem)" },
            "gap": { "displayName": "Gap", "defaultValue": "0.75rem" },
            "display": { "display": { "displayValues": ["none", "flex"] } }
          },
          "elements": {
            "name": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".profile-card__name",
                "displayName": "Name",
                "data": {
                  "nameText": { "dataType": "text", "displayName": "Text" }
                },
                "cssProperties": {
                  "font": { "displayName": "Font", "defaultValue": "normal normal 700 24px/1.2em wix-madefor-display-v2" },
                  "color": { "displayName": "Color", "defaultValue": "#000" },
                  "display": { "display": { "displayValues": ["none", "block"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            },
            "experience": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".profile-card__experience",
                "displayName": "Experience",
                "data": {
                  "yearsExperience": { "dataType": "number", "displayName": "Years", "number": { "minimum": 0 } },
                  "experienceLabel": { "dataType": "text", "displayName": "Label" }
                },
                "cssProperties": {
                  "font": { "displayName": "Font", "defaultValue": "normal normal 600 20px/1.2em wix-madefor-display-v2" },
                  "color": { "displayName": "Color", "defaultValue": "#000" },
                  "display": { "display": { "displayValues": ["none", "block"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            },
            "skills": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".profile-card__skills",
                "displayName": "Skills",
                "data": {
                  "skills": {
                    "dataType": "arrayItems",
                    "displayName": "Skills",
                    "arrayItems": {
                      "dataItem": {
                        "dataType": "data",
                        "displayName": "Skill",
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
            "bio": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".profile-card__bio",
                "displayName": "Bio",
                "data": {
                  "bioText": { "dataType": "text", "displayName": "Text" }
                },
                "cssProperties": {
                  "font": { "displayName": "Font", "defaultValue": "normal normal 400 16px/1.5em wix-madefor-display-v2" },
                  "color": { "displayName": "Color", "defaultValue": "#000" },
                  "display": { "display": { "displayValues": ["none", "block"] } }
                },
                "behaviors": { "selectable": true, "removable": true }
              }
            },
            "contactButton": {
              "elementType": "inlineElement",
              "inlineElement": {
                "selector": ".profile-card__button",
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
import { defaultProfilePhoto } from './assets/defaultImages';
import type { Wix, Text, Link, Image, NumberType, BooleanValue, Direction } from './types';

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

const StatusBadge: LeafComponent<{ badgeText?: Text }> = ({ className, badgeText }) => (
  <div className={className}>{badgeText || 'Available'}</div>
);

const Name: LeafComponent<{ nameText?: Text }> = ({ className, nameText }) => (
  <h2 className={className}>{nameText || 'Team Member'}</h2>
);

const Experience: LeafComponent<{ yearsExperience?: NumberType; experienceLabel?: Text }> = ({
  className, yearsExperience, experienceLabel
}) => {
  const years = yearsExperience ?? 5;
  const label = experienceLabel || 'years experience';
  return <p className={className}>{years} {label}</p>;
};

interface Skill { label?: Text; }

const Skills: LeafComponent<{ skills?: Skill[] }> = ({ className, skills }) => {
  const defaultSkills: Skill[] = [{ label: 'Design' }, { label: 'Strategy' }, { label: 'Leadership' }];
  const displaySkills = (skills?.length ?? 0) > 0 ? skills! : defaultSkills;
  return (
    <div className={className}>
      {displaySkills.map((skill, i) => (
        <span key={i} className="profile-card__skill">{skill.label || 'Skill'}</span>
      ))}
    </div>
  );
};

const Bio: LeafComponent<{ bioText?: Text }> = ({ className, bioText }) => (
  <p className={className}>{bioText || 'Passionate about creating meaningful experiences.'}</p>
);

const ContactButton: LeafComponent<{
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
      <span>{buttonText || 'Get in Touch'}</span>
    </a>
  );
};

// --- Container Components ---

const PhotoSection: ContainerComponent<{ image?: Image }> = ({ className, image, elementProps, wix }) => {
  const removalState = wix?.elementsRemovalState || {};
  const imageUrl = image?.url || defaultProfilePhoto;

  return (
    <div className={className}>
      {imageUrl && (
        <img className="profile-card__photo" src={imageUrl} alt={image?.name || 'Profile photo'} loading="lazy" />
      )}
      {!removalState['statusBadge'] && (
        <StatusBadge className="profile-card__status-badge" {...elementProps?.['statusBadge']} />
      )}
    </div>
  );
};

const InfoSection: ContainerComponent<{}> = ({ className, elementProps, wix }) => {
  const removalState = wix?.elementsRemovalState || {};

  return (
    <div className={className}>
      {!removalState['name'] && (
        <Name className="profile-card__name" {...elementProps?.['name']} />
      )}
      {!removalState['experience'] && (
        <Experience className="profile-card__experience" {...elementProps?.['experience']} />
      )}
      {!removalState['skills'] && (
        <Skills className="profile-card__skills" {...elementProps?.['skills']} />
      )}
      {!removalState['bio'] && (
        <Bio className="profile-card__bio" {...elementProps?.['bio']} />
      )}
      {!removalState['contactButton'] && (
        <ContactButton className="profile-card__button" {...elementProps?.['contactButton']} />
      )}
    </div>
  );
};

// --- Root Component ---

const ProfileCard: RootComponent<{ direction?: Direction }> = ({ className, id, wix, elementProps, direction }) => {
  const removalState = wix?.elementsRemovalState || {};

  return (
    <div className={`profile-card ${className}`} id={id} dir={direction}>
      {!removalState['photoSection'] && (
        <PhotoSection className="profile-card__photo-section" {...elementProps?.['photoSection']} />
      )}
      {!removalState['infoSection'] && (
        <InfoSection className="profile-card__info" {...elementProps?.['infoSection']} />
      )}
    </div>
  );
};

export default ProfileCard;
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

.profile-card {
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

.profile-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(3, 34, 98, 0.12);
}

.profile-card__photo-section {
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

.profile-card__photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.profile-card:hover .profile-card__photo {
  transform: scale(1.05);
}

.profile-card__status-badge {
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

.profile-card__info {
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

.profile-card__name {
  margin: 0;
  font: normal normal 700 24px/1.2em wix-madefor-display-v2;
  color: #000;
  pointer-events: auto;
}

.profile-card__experience {
  margin: 0;
  font: normal normal 600 20px/1.2em wix-madefor-display-v2;
  color: #000;
  pointer-events: auto;
}

.profile-card__skills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.5rem 0;
  pointer-events: auto;
}

.profile-card__skill {
  padding: 0.25rem 0.75rem;
  background: rgba(3, 34, 98, 0.08);
  color: #032262;
  font: normal normal 500 12px/1.3em wix-madefor-display-v2;
  border-radius: 16px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.profile-card__bio {
  margin: 0;
  font: normal normal 400 16px/1.5em wix-madefor-display-v2;
  color: #000;
  opacity: 0.7;
  flex-grow: 1;
  pointer-events: auto;
}

.profile-card__button {
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

.profile-card__button:hover {
  background: #88C0FF;
  border-color: #88C0FF;
}

.profile-card__button:focus-visible {
  outline: 2px solid #032262;
  outline-offset: 2px;
}

.profile-card[dir="rtl"] {
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
<defaultProfilePhoto>
{
  "description": "A professional headshot portrait with a clean neutral background, warm lighting, and friendly expression",
  "width": 1024,
  "height": 896
}
</defaultProfilePhoto>
```

---

## Key Patterns Demonstrated

### Nested Elements (2-level)
Root → photoSection → statusBadge, Root → infoSection → name/experience/skills/bio/contactButton

### Three Component Types
- **LeafComponent**: StatusBadge, Name, Experience, Skills, Bio, ContactButton — content only, no children
- **ContainerComponent**: PhotoSection, InfoSection — render child sub-components via `elementProps`
- **RootComponent**: ProfileCard — exported default, receives `id`, `className`, `elementProps`, `wix`

### Conditional Rendering
Each level checks its own `wix.elementsRemovalState`:
- Root checks `photoSection`, `infoSection`
- PhotoSection checks `statusBadge`
- InfoSection checks `name`, `experience`, `skills`, `bio`, `contactButton`

### Data Types Covered
| Type | Element | Field |
|------|---------|-------|
| `text` | statusBadge, name, bio, contactButton | badgeText, nameText, bioText, buttonText |
| `number` | experience | yearsExperience |
| `booleanValue` | contactButton | buttonDisabled |
| `link` | contactButton | buttonLink |
| `image` | photoSection | image |
| `arrayItems` | skills | skills (array of { label: text }) |
| `direction` | root | direction |

### Three-Way Sync
Every element: React `className` = CSS selector = manifest `selector`
- React: `className="profile-card__status-badge"` → CSS: `.profile-card__status-badge {}` → Manifest: `"selector": ".profile-card__status-badge"`

### CSS Variable Integration
- Root `--display` variable for editor override: `display: var(--display)`
- All selectors declared once with `box-sizing: border-box`
- `pointer-events: auto` on all manifest elements

### Accessibility
- `aria-disabled` on buttons with disabled state
- `loading="lazy"` on images
- `focus-visible` outline for keyboard navigation
- `prefers-reduced-motion` media query
