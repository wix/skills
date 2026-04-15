
# Wix Site Component Builder

Creates production-quality React site components with editor manifests for Wix CLI applications. Site components are React components that integrate with the Wix Editor, allowing site owners to customize content, styling, and behavior through a visual interface.

**Prerequisite:** Install `@wix/editor-react-types` as a dev dependency before writing any files.

## Architecture

Site components consist of **four required files**:

### 1. Component Manifest (`manifest.json`)

Defines the contract between the React component and Wix ecosystem:

- **editorElement**: Root element configuration (selector, displayName, archetype, layout)
- **cssProperties**: CSS API for styling customization
- **data**: Data API for content configuration
- **elements**: Nested element definitions for granular editing
- **behaviors**: Editor interaction behaviors

### 2. React Component (`component.tsx`)

Production-ready React functional component:

- Implements props interface matching manifest data structure
- Applies className and id to root element
- Handles element removal state via `wix.elementsRemovalState`
- Uses sub-component pattern for nested elements
- Includes proper TypeScript typing and error handling

### 3. CSS Styles (`style.css`)

Modern CSS with responsive design:

- Synced selectors with manifest and React classNames
- CSS variables for dynamic styling
- Responsive design without media queries (flexbox, grid, clamp)
- Pointer events enabled for editor elements
- No inline styles for static values
- Each selector once only, `box-sizing: border-box` all elements
- NO `transition: all`, NO media queries (except `prefers-reduced-motion`)
- Root display: Declare `--display: [value]` CSS variable, then use `display: var(--display)` on root

### 4. TypeScript Types (`types.ts`)

Strict type definitions:

- Import types: `import type { Wix, Link, Image, Text, NumberType, BooleanValue, WebUrl, Direction } from '@wix/editor-react-types'` — do NOT define these locally (installed in Prerequisites)
- Exception: `RichText` — define locally as `type RichText = string` (the `@wix/editor-react-types` version is `{ text, html, linkList }`, not a plain string)
- Props interfaces for all components
- Element props structure with optional chaining

## Component Manifest Structure

**You MUST read [MANIFEST_GUIDELINES.md](site-component/MANIFEST_GUIDELINES.md) before implementing a site component.** It contains the complete manifest structure, all data types, element configurations, and required patterns.

The manifest defines the editor contract using these key sections:

### installation (Initial Placement)

```json
{
  "installation": {
    "staticContainer": "HOMEPAGE",
    "initialSize": {
      "width": { "sizingType": "pixels", "pixels": 400 },
      "height": { "sizingType": "pixels", "pixels": 300 }
    }
  }
}
```

- **staticContainer**: Use `"HOMEPAGE"` for automatic installation on Harmony editor
- **initialSize**: Defines initial dimensions with `sizingType` options:
  - `"content"` - Auto-size based on content
  - `"stretched"` - Fill available space
  - `"pixels"` - Fixed pixel dimension (requires `pixels` property)

### editorElement (Root Configuration)

```json
{
  "selector": ".component-name",
  "displayName": "Component Name",
  "archetype": "Container",
  "layout": {
    "resizeDirection": "horizontalAndVertical",
    "contentResizeDirection": "horizontal"
  },
  "cssProperties": {
    "backgroundColor": {
      "displayName": "Background Color",
      "defaultValue": "#ffffff"
    }
  },
  "data": {
    "columns": {
      "dataType": "number",
      "displayName": "Number of Columns",
      "number": { "minimum": 1, "maximum": 4 }
    }
  },
  "elements": {
    "title": {
      "elementType": "inlineElement",
      "inlineElement": {
        "selector": ".component-name__title",
        "displayName": "Title",
        "data": {
          "titleText": {
            "dataType": "text",
            "displayName": "Title Text"
          }
        },
        "behaviors": {
          "selectable": true,
          "removable": true
        }
      }
    }
  }
}
```

### Data Types Reference

All runtime types are from `@wix/editor-react-types`.

| Manifest `dataType` | TypeScript type | Use Case |
|---------------------|----------------|----------|
| `text` | `Text` | Names, titles, descriptions |
| `textEnum` | `TextEnum` | Predefined options |
| `number` | `NumberType` | Quantities, dimensions |
| `booleanValue` | `BooleanValue` | Toggles, flags |
| `a11y` | `A11y` | Accessibility attributes |
| `link` | `Link` | Navigation links |
| `image` | `Image` | Images |
| `video` | `Video` | Media content |
| `audio` | `Audio` | Audio content |
| `vectorArt` | `VectorArt` | Icons, graphics |
| `localDate` | `LocalDate` (string, YYYY-MM-DD) | Date values |
| `localTime` | `LocalTime` (string, hh:mm[:ss][.sss]) | Time values |
| `localDateTime` | `LocalDateTime` (string, YYYY-MM-DDThh:mm[:ss][.sss]) | Date + time values |
| `webUrl` | `WebUrl` (string) | External URLs |
| `richText` | `RichText` (define locally as `string`) | Formatted content |
| `arrayItems` | `ArrayItems` | Collections, lists |
| `direction` | `Direction` | HTML dir attribute |
| `menuItems` | `MenuItems` | Navigation menus |

### CSS Properties Reference

Common CSS properties for styling customization:

- **Layout**: `display`, `gap`, `padding`, `margin`, `width`, `height`
- **Typography**: `font`, `fontSize`, `fontWeight`, `textAlign`, `color`
- **Background**: `backgroundColor`, `backgroundImage`
- **Border**: `border`, `borderRadius`, `boxShadow`
- **Positioning**: `alignItems`, `justifyContent`, `flexDirection`

**Complete CSS properties reference:** See [CSS_GUIDELINES.md](site-component/CSS_GUIDELINES.md) for all CSS properties, variable patterns, and styling best practices.

## React Component Patterns

**For components using hooks, effects, or callbacks:** See [REACT_PATTERNS.md](site-component/REACT_PATTERNS.md) — read this when your component uses `useEffect`, `useCallback`, complex state, or async operations. Contains complete patterns for hooks, arrays, refs, and SSR-safe data fetching.

### Props Structure

```typescript
import type { Wix, Link, Image } from '@wix/editor-react-types'; // also: Text, NumberType, BooleanValue, WebUrl, Direction

interface ComponentProps {
  // Standard props (always present)
  className: string;
  id: string;
  wix?: Wix;

  // Component-level data (from editorElement.data)
  columns?: number;
  layout?: string;

  // Element props (from elements definitions)
  elementProps?: {
    title?: {
      titleText?: string;
      wix?: Wix;
    };
    button?: {
      buttonText?: string;
      buttonLink?: Link;
      wix?: Wix;
    };
  };
}
```

### Sub-Component Pattern

Extract every distinct UI element into a named sub-component. Each sub-component receives a `className` prop matching the manifest selector plus its own data props:

```typescript
const Title: FC<{ titleText?: string; className: string }> = ({
  titleText = "Default Title", className
}) => <h2 className={className}>{titleText}</h2>;

const MyComponent: FC<MyComponentProps> = ({ className, id, elementProps, wix }) => {
  const removalState = wix?.elementsRemovalState || {};
  return (
    <div className={`my-component ${className}`} id={id}>
      {!removalState['title'] && <Title className="my-component__title" {...elementProps?.title} />}
    </div>
  );
};
```

See [REACT_PATTERNS.md](site-component/REACT_PATTERNS.md) for full sub-component architecture, array handling, and TypeScript patterns.

### Conditional Rendering

Conditionally render ALL elements per `wix.elementsRemovalState`: `{!removalState['elementKey'] && <Element />}` where `removalState = wix?.elementsRemovalState || {}`.

## CSS Guidelines

### Responsive Design Strategy

Components live in user-resizable containers (300-1200px) within varying viewports:

- **Root element**: `width: 100%; height: 100%`
- **Layout structure**: Use CSS Grid and Flexbox for fluid responsiveness
- **Typography**: Use `clamp()` for fluid scaling
- **Spacing**: Fixed or tight clamp spacing (≤50% variation)

### CSS Variables for Dynamic Styling

```css
.component {
  --display: block;
  --background-color: #ffffff;
  --text-color: #333333;

  display: var(--display);
  background-color: var(--background-color);
  color: var(--text-color);
  pointer-events: auto;
}
```

### Selector Synchronization

**CRITICAL**: CSS selectors must match manifest selectors and React classNames exactly:

- React: `className="profile-card__name"`
- CSS: `.profile-card__name { ... }`
- Manifest: `"selector": ".profile-card__name"`

## Design Guidelines

**Complete reference:** See [DESIGN_SYSTEM.md](site-component/DESIGN_SYSTEM.md) for visual design principles, creative guidelines, and aesthetic best practices.

### Spacing as Communication

| Relationship | Value | Use Case |
|---|---|---|
| Tight (icon + label) | 0.25-0.5rem (4-8px) | Clustering related items |
| Same category | 1-1.5rem (16-24px) | Card sections, form fields |
| Different sections | 2-3rem (32-48px) | Major content blocks |
| Emphasis/Drama | 4rem+ (64px+) | Hero content, luxury feel |

### Visual Consistency

- **Corner Radius**: All similar elements share same radius (0-4px sharp, 6-12px rounded)
- **Shadow Levels**: Max 3 levels (rest, hover, floating)
- **Element Heights**: Consistent heights for similar elements
- **Color Strategy**: Use full palette purposefully for hierarchy and zones

### Creative Exploration

Push beyond obvious solutions:

- **Cards**: Asymmetric grids, overlapping elements, thick accent borders
- **Lists**: Alternating styles, spotlight patterns, color rhythm
- **Interactive Elements**: Split buttons, colored icon circles, smooth transitions
- **Content Hierarchy**: Large numbers for stats, quote callouts, whitespace dividers

## Component Elements Guidelines

### One Element = One Manifest Entry

Each distinct visual part requires a separate manifest element:

- ✅ 3 buttons → 3 separate elements
- ✅ Image + text → 2 separate elements
- ❌ Multiple items grouped as one element

### Data Scoping Rules

**editorElement.data** - Component-wide configuration only:
- ✅ Layout enums, numbers (columns: 3, speed: 500)
- ❌ Text, links, images (belongs to elements)
- ❌ show/hide booleans (use removable: true instead)

**elements[key].data** - Content for that specific element:
- ✅ Element-specific content (title text, button link, image)

## Asset Requirements

When components need default images, use this format:

```typescript
// Import in component
import { heroImage } from './assets/defaultImages';

// Usage
<img src={heroImage} alt="Hero" />
```

Asset specification format:
```
<imageUrlName>
{ "description": "Modern cityscape at sunset", "width": 1920, "height": 1088 }
</imageUrlName>
```

**Rules:**
- Import as named export from `'./assets/defaultImages'`
- Width/height: multiples of 64, between 128-2048px
- NEVER use external URLs

## Output Structure

```
src/extensions/site/components/
└── {component-name}/
    ├── manifest.json        # Component manifest
    ├── component.tsx        # React component
    ├── style.css           # CSS styles
    ├── types.ts            # TypeScript types
    └── assets/             # Optional assets
        └── defaultImages.ts
```

## Examples

**Complete working example:** See [EXAMPLE.md](site-component/EXAMPLE.md) for a profile card with nested elements, all data types, and three component types (Leaf, Container, Root). **Read this when building a complex multi-element component, when you want to verify you have all patterns right, or when you need a cross-reference. For components with ≤5 elements, the patterns documented in this file are sufficient — EXAMPLE.md is not required reading.**

### Profile Card Component

**Request:** "Create a team member profile card with photo, name, experience, and contact button"

**Output:**
- Manifest with 8 elements in 2-level nesting (photo section, info section)
- React component with Leaf, Container, and Root sub-components
- CSS with responsive layout and hover effects
- TypeScript types for all props and data structures

### Hero Section Component

**Request:** "Build a hero section with background image, headline, subtitle, and CTA button"

**Output:**
- Manifest with background image CSS property and 3 text elements
- React component with overlay design and typography hierarchy
- CSS with responsive text scaling and dramatic spacing
- Asset specifications for default hero images

### Feature List Component

**Request:** "Create a features component with configurable number of items"

**Output:**
- Manifest with arrayItems data type for feature collection
- React component mapping over features array with safety checks
- CSS with flexible grid layout adapting to item count
- Sub-components for feature icons, titles, and descriptions

## Extension Registration

**Extension registration is MANDATORY and has TWO required steps.**

### Step 1: Create Component-Specific Extension File

Each site component requires an `extensions.ts` file in its folder:

```typescript
import { extensions } from "@wix/astro/builders";
import manifest from "./manifest.json";

export const sitecomponentMyComponent = extensions.siteComponent({
  ...manifest,
  id: "{{GENERATE_UUID}}",
  description: "My Component",
  type: "<CODE_IDENTIFIER>.MyComponent",
  resources: {
    client: {
      component: "./extensions/site/components/my-component/component.tsx",
      componentUrl: "./extensions/site/components/my-component/component.tsx",
    },
  },
});
```

**CRITICAL: Type Naming Convention**

The `type` field uses the format `{CODE_IDENTIFIER}.{PascalCaseFolderName}`:
- Folder `my-component` → `type: "<CODE_IDENTIFIER>.MyComponent"`
- Folder `profile-card` → `type: "<CODE_IDENTIFIER>.ProfileCard"`
- Folder `hero-section` → `type: "<CODE_IDENTIFIER>.HeroSection"`

The folder name is converted to PascalCase (hyphens removed, each word capitalized).

**CODE_IDENTIFIER Requirement:**
The Code Identifier is a required value that cannot be guessed. Every Wix app has one automatically.

**If Code Identifier is provided in the prompt:**
- Use it as the type prefix: `<actual-code-identifier>.ComponentName`

**If Code Identifier is NOT provided:**
- Use the placeholder `<CODE_IDENTIFIER>` in the type field: `<CODE_IDENTIFIER>.ComponentName`
- Add to Manual Action Items: "Replace `<CODE_IDENTIFIER>` with your actual Code Identifier from Wix Dev Center"

**CRITICAL: UUID Generation**

The `id` must be a unique, static UUID v4 string. Generate a fresh UUID for each extension - do NOT use `randomUUID()` or copy UUIDs from examples.

### Step 2: Register in Main Extensions File

**CRITICAL:** After creating the component-specific extension file, you MUST read [Extension Registration reference](EXTENSION_REGISTRATION.md) and follow the "App Registration" section to update `src/extensions.ts`.

**Without completing Step 2, the site component will not be available in the Wix Editor.**

## Code Quality Requirements

**Complete reference:** See [TYPESCRIPT_QUALITY.md](site-component/TYPESCRIPT_QUALITY.md) for strict TypeScript configuration and code quality standards.

### TypeScript Standards

- Strict TypeScript with no `any` types
- ALL data props must be optional (use `?`)
- Explicit return types for all functions
- Proper null/undefined handling with optional chaining
- No `@ts-ignore` or `@ts-expect-error` comments

### React Best Practices

- React 16 compatible — no React 18+ features (`useId`, `useDeferredValue`, `useTransition`, etc.)
- Functional components with hooks
- Proper dependency arrays in useEffect
- Component must react to prop changes
- SSR-safe code (no browser APIs at module scope)

### ESLint Compliance

1. No unused vars/params/imports (`@typescript-eslint/no-unused-vars`)
2. No external images: `img` `src` not `https://...` (allowed: local imports, `wixstatic.com`, variables)
3. SSR-safe: No `window`/`document` at module scope/constructor, guard browser APIs in `useEffect`/handlers
4. No `dangerouslySetInnerHTML` or inline `<style>` tags - use CSS variables or inline `style` prop for dynamic values
5. No `window.fetch` (`no-restricted-properties`)
6. Hooks `exhaustive-deps`: ALL values from component scope used inside `useEffect`/`useCallback` MUST be in dependency array
7. Use `const`/`let` (no `var`), no unknown JSX properties

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| CSS selector doesn't match manifest | Editor can't apply styles to the element | Ensure manifest `selector`, React `className`, and CSS selector are identical |
| Putting content text in `editorElement.data` | Content belongs to specific elements, not root | Move text/image/link data into `elements[key].data` |
| Using `display: flex` directly on root | Breaks editor override mechanism | Use `--display: flex` CSS variable, then `display: var(--display)` |
| Missing `removable: true` on elements | Site owner can't hide the element | Add `behaviors: { selectable: true, removable: true }` to all elements |
| `arrayItems` without `data`/`dataItem`/`dynamicItems` | Deploy validation fails | The `arrayItems` object must include one of: `data`, `dataItem`, or `dynamicItems` |
| Using `window`/`document` at module scope | SSR fails during build | Guard browser APIs inside `useEffect` or event handlers |
| Importing from `@wix/design-system` | Not available in site components | Use plain HTML/CSS or custom components only |
| `import { FC } from 'react'` | `verbatimModuleSyntax` in Astro tsconfig requires type-only imports | Use `import { type FC }` or `import type { FC }` from React |

## Hard Constraints

- Do NOT invent or assume new types, modules, functions, props, events, or imports
- Use only entities explicitly present in the provided references or standard libraries already used in this project
- Do NOT add dependencies; do NOT use `@wix/design-system` or `@wix/wix-ui-icons-common`
- All user-facing content must come from props (no hardcoded text)
- Links/media from manifest only, never hardcode URLs
- NEVER use mocks, placeholders, or TODOs in any code
- ALWAYS implement complete, production-ready functionality

## Reference Documentation

| File | When to read |
|------|-------------|
| [MANIFEST_GUIDELINES.md](site-component/MANIFEST_GUIDELINES.md) | **Always** — manifest structure, element rules, CSS properties, sync |
| [MANIFEST_ADVANCED.md](site-component/MANIFEST_ADVANCED.md) | When using arrayItems, link constraints, richText abilities, or non-default installation sizing |
| [REACT_PATTERNS.md](site-component/REACT_PATTERNS.md) | When using hooks (`useEffect`, `useCallback`), complex state, or arrays |
| [EXAMPLE.md](site-component/EXAMPLE.md) | When building complex (5+ element) components, or to cross-check all patterns |
| [CSS_GUIDELINES.md](site-component/CSS_GUIDELINES.md) | When you need advanced CSS patterns or animations |
| [DESIGN_SYSTEM.md](site-component/DESIGN_SYSTEM.md) | When building visually rich/branded components |
| [TYPESCRIPT_QUALITY.md](site-component/TYPESCRIPT_QUALITY.md) | When you need strict TypeScript configuration and props interface patterns |
